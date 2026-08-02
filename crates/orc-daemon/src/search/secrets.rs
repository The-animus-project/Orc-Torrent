//! Secure storage for Torznab API keys.
//!
//! Secrets must never be written to `config.json`, returned by GET endpoints,
//! or included in logs / error messages.

use std::{
    collections::HashMap,
    fs::OpenOptions,
    io::{Read, Write},
    path::{Path, PathBuf},
    sync::Arc,
};

use aes_gcm::{
    aead::{Aead, KeyInit},
    Aes256Gcm, Nonce,
};
use anyhow::{anyhow, Context, Result};
use async_trait::async_trait;
use base64::{engine::general_purpose::STANDARD as B64, Engine};
use rand::RngCore;
use serde::{Deserialize, Serialize};
use tokio::sync::RwLock;
use tracing::warn;

pub const SEARCH_SECRET_SERVICE: &str = "OrcTorrent";
pub const MAX_API_KEY_LEN: usize = 512;

#[async_trait]
pub trait SearchSecretStore: Send + Sync {
    async fn set_secret(&self, reference: &str, value: &str) -> Result<()>;
    async fn get_secret(&self, reference: &str) -> Result<Option<String>>;
    async fn delete_secret(&self, reference: &str) -> Result<()>;
    async fn has_secret(&self, reference: &str) -> Result<bool> {
        Ok(self.get_secret(reference).await?.is_some())
    }
}

/// In-memory store for unit tests. Never used for production persistence.
#[derive(Default)]
pub struct InMemorySearchSecretStore {
    inner: RwLock<HashMap<String, String>>,
}

impl InMemorySearchSecretStore {
    pub fn new() -> Self {
        Self::default()
    }
}

impl std::fmt::Debug for InMemorySearchSecretStore {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("InMemorySearchSecretStore { /* redacted */ }")
    }
}

#[async_trait]
impl SearchSecretStore for InMemorySearchSecretStore {
    async fn set_secret(&self, reference: &str, value: &str) -> Result<()> {
        validate_reference(reference)?;
        validate_api_key(value)?;
        self.inner
            .write()
            .await
            .insert(reference.to_string(), value.to_string());
        Ok(())
    }

    async fn get_secret(&self, reference: &str) -> Result<Option<String>> {
        validate_reference(reference)?;
        Ok(self.inner.read().await.get(reference).cloned())
    }

    async fn delete_secret(&self, reference: &str) -> Result<()> {
        validate_reference(reference)?;
        self.inner.write().await.remove(reference);
        Ok(())
    }
}

/// OS credential-store backend (macOS Keychain, Windows Credential Manager, Linux Secret Service).
pub struct OsKeyringSearchSecretStore {
    service: String,
}

impl OsKeyringSearchSecretStore {
    pub fn new() -> Self {
        Self {
            service: SEARCH_SECRET_SERVICE.to_string(),
        }
    }

    fn entry(&self, reference: &str) -> Result<keyring::Entry> {
        keyring::Entry::new(&self.service, reference).context("failed to open OS credential entry")
    }

    /// Probe whether the keyring backend accepts a write/read cycle for a throwaway account.
    pub fn is_usable(&self) -> bool {
        let probe_ref = "__orc_torrent_keyring_probe__";
        let Ok(entry) = self.entry(probe_ref) else {
            return false;
        };
        if entry.set_password("probe").is_err() {
            return false;
        }
        let ok = entry.get_password().ok().as_deref() == Some("probe");
        let _ = entry.delete_credential();
        ok
    }
}

impl std::fmt::Debug for OsKeyringSearchSecretStore {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("OsKeyringSearchSecretStore")
            .field("service", &self.service)
            .finish()
    }
}

#[async_trait]
impl SearchSecretStore for OsKeyringSearchSecretStore {
    async fn set_secret(&self, reference: &str, value: &str) -> Result<()> {
        validate_reference(reference)?;
        validate_api_key(value)?;
        let entry = self.entry(reference)?;
        entry
            .set_password(value)
            .map_err(|_| anyhow!("failed to store provider credential"))
    }

    async fn get_secret(&self, reference: &str) -> Result<Option<String>> {
        validate_reference(reference)?;
        let entry = self.entry(reference)?;
        match entry.get_password() {
            Ok(value) => Ok(Some(value)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(_) => Err(anyhow!("failed to read provider credential")),
        }
    }

    async fn delete_secret(&self, reference: &str) -> Result<()> {
        validate_reference(reference)?;
        let entry = self.entry(reference)?;
        match entry.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(_) => Err(anyhow!("failed to delete provider credential")),
        }
    }
}

#[derive(Serialize, Deserialize, Default)]
struct EncryptedSecretPayload {
    secrets: HashMap<String, String>,
}

/// AES-GCM encrypted secret file under the daemon config directory.
///
/// Used when the OS keyring is unavailable. The master key is stored separately
/// with restrictive permissions and is never written into `config.json`.
pub struct EncryptedFileSearchSecretStore {
    secrets_path: PathBuf,
    key_path: PathBuf,
    cipher: Aes256Gcm,
    inner: RwLock<HashMap<String, String>>,
}

impl EncryptedFileSearchSecretStore {
    pub fn open(config_dir: &Path) -> Result<Self> {
        std::fs::create_dir_all(config_dir).context("failed to create config directory")?;
        let key_path = config_dir.join("search-secrets.key");
        let secrets_path = config_dir.join("search-secrets.bin");
        let key = load_or_create_key(&key_path)?;
        let cipher = Aes256Gcm::new_from_slice(&key)
            .map_err(|_| anyhow!("invalid secret-store key material"))?;
        let secrets = if secrets_path.exists() {
            decrypt_payload(&cipher, &secrets_path)?
        } else {
            HashMap::new()
        };
        Ok(Self {
            secrets_path,
            key_path,
            cipher,
            inner: RwLock::new(secrets),
        })
    }

    async fn persist(&self, secrets: &HashMap<String, String>) -> Result<()> {
        let payload = EncryptedSecretPayload {
            secrets: secrets.clone(),
        };
        let plaintext =
            serde_json::to_vec(&payload).context("failed to serialise search secrets")?;
        let mut nonce_bytes = [0u8; 12];
        rand::thread_rng().fill_bytes(&mut nonce_bytes);
        let nonce = Nonce::from_slice(&nonce_bytes);
        let ciphertext = self
            .cipher
            .encrypt(nonce, plaintext.as_ref())
            .map_err(|_| anyhow!("failed to encrypt search secrets"))?;
        let mut blob = Vec::with_capacity(12 + ciphertext.len());
        blob.extend_from_slice(&nonce_bytes);
        blob.extend_from_slice(&ciphertext);
        let encoded = B64.encode(blob);
        write_restricted(&self.secrets_path, encoded.as_bytes())?;
        // Ensure key file permissions remain restrictive after rewrite.
        restrict_permissions(&self.key_path)?;
        Ok(())
    }
}

impl std::fmt::Debug for EncryptedFileSearchSecretStore {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("EncryptedFileSearchSecretStore")
            .field("secrets_path", &self.secrets_path)
            .finish_non_exhaustive()
    }
}

#[async_trait]
impl SearchSecretStore for EncryptedFileSearchSecretStore {
    async fn set_secret(&self, reference: &str, value: &str) -> Result<()> {
        validate_reference(reference)?;
        validate_api_key(value)?;
        let mut guard = self.inner.write().await;
        guard.insert(reference.to_string(), value.to_string());
        self.persist(&guard).await
    }

    async fn get_secret(&self, reference: &str) -> Result<Option<String>> {
        validate_reference(reference)?;
        Ok(self.inner.read().await.get(reference).cloned())
    }

    async fn delete_secret(&self, reference: &str) -> Result<()> {
        validate_reference(reference)?;
        let mut guard = self.inner.write().await;
        guard.remove(reference);
        self.persist(&guard).await
    }
}

/// Prefer OS keyring; fall back to encrypted file store when keyring is unusable.
pub fn create_default_secret_store(config_dir: &Path) -> Arc<dyn SearchSecretStore> {
    let keyring = OsKeyringSearchSecretStore::new();
    if keyring.is_usable() {
        Arc::new(keyring)
    } else {
        warn!(
            "OS keyring unavailable for search credentials; using encrypted file store under config directory"
        );
        match EncryptedFileSearchSecretStore::open(config_dir) {
            Ok(store) => Arc::new(store),
            Err(err) => {
                warn!(
                    "encrypted file secret store failed to open ({err}); using in-memory store (credentials will not persist across restarts)"
                );
                Arc::new(InMemorySearchSecretStore::new())
            }
        }
    }
}

pub fn credential_ref_for_provider(name: &str) -> String {
    format!("search-provider:{name}")
}

pub fn validate_api_key(value: &str) -> Result<()> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Err(anyhow!("api_key cannot be empty"));
    }
    if trimmed.len() > MAX_API_KEY_LEN {
        return Err(anyhow!(
            "api_key cannot exceed {} characters",
            MAX_API_KEY_LEN
        ));
    }
    Ok(())
}

fn validate_reference(reference: &str) -> Result<()> {
    let trimmed = reference.trim();
    if trimmed.is_empty() || trimmed.len() > 128 {
        return Err(anyhow!("invalid credential reference"));
    }
    if !trimmed
        .chars()
        .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, ':' | '_' | '-' | '.'))
    {
        return Err(anyhow!("invalid credential reference"));
    }
    Ok(())
}

fn load_or_create_key(path: &Path) -> Result<[u8; 32]> {
    if path.exists() {
        let mut file = OpenOptions::new()
            .read(true)
            .open(path)
            .context("failed to open search secrets key")?;
        let mut encoded = String::new();
        file.read_to_string(&mut encoded)
            .context("failed to read search secrets key")?;
        let bytes = B64
            .decode(encoded.trim())
            .context("search secrets key is corrupt")?;
        if bytes.len() != 32 {
            return Err(anyhow!("search secrets key has invalid length"));
        }
        let mut key = [0u8; 32];
        key.copy_from_slice(&bytes);
        return Ok(key);
    }

    let mut key = [0u8; 32];
    rand::thread_rng().fill_bytes(&mut key);
    write_restricted(path, B64.encode(key).as_bytes())?;
    Ok(key)
}

fn decrypt_payload(cipher: &Aes256Gcm, path: &Path) -> Result<HashMap<String, String>> {
    let encoded = std::fs::read_to_string(path).context("failed to read encrypted secrets")?;
    let blob = B64
        .decode(encoded.trim())
        .context("encrypted secrets are corrupt")?;
    if blob.len() < 12 {
        return Err(anyhow!("encrypted secrets are corrupt"));
    }
    let (nonce_bytes, ciphertext) = blob.split_at(12);
    let nonce = Nonce::from_slice(nonce_bytes);
    let plaintext = cipher
        .decrypt(nonce, ciphertext)
        .map_err(|_| anyhow!("failed to decrypt search secrets"))?;
    let payload: EncryptedSecretPayload =
        serde_json::from_slice(&plaintext).context("encrypted secrets payload is invalid")?;
    Ok(payload.secrets)
}

fn write_restricted(path: &Path, bytes: &[u8]) -> Result<()> {
    {
        let mut file = OpenOptions::new()
            .create(true)
            .write(true)
            .truncate(true)
            .open(path)
            .with_context(|| format!("failed to write {}", path.display()))?;
        file.write_all(bytes)
            .with_context(|| format!("failed to write {}", path.display()))?;
        file.sync_all()
            .with_context(|| format!("failed to sync {}", path.display()))?;
    }
    restrict_permissions(path)?;
    Ok(())
}

fn restrict_permissions(path: &Path) -> Result<()> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let perms = std::fs::Permissions::from_mode(0o600);
        std::fs::set_permissions(path, perms)
            .with_context(|| format!("failed to set permissions on {}", path.display()))?;
    }
    let _ = path;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[tokio::test]
    async fn in_memory_round_trip() {
        let store = InMemorySearchSecretStore::new();
        store
            .set_secret("search-provider:jackett", "secret-key")
            .await
            .unwrap();
        assert_eq!(
            store
                .get_secret("search-provider:jackett")
                .await
                .unwrap()
                .as_deref(),
            Some("secret-key")
        );
        store
            .delete_secret("search-provider:jackett")
            .await
            .unwrap();
        assert!(store
            .get_secret("search-provider:jackett")
            .await
            .unwrap()
            .is_none());
    }

    #[tokio::test]
    async fn rejects_empty_api_key() {
        let store = InMemorySearchSecretStore::new();
        assert!(store.set_secret("search-provider:x", "  ").await.is_err());
    }

    #[tokio::test]
    async fn encrypted_file_round_trip() {
        let dir = tempdir().unwrap();
        let store = EncryptedFileSearchSecretStore::open(dir.path()).unwrap();
        store
            .set_secret("search-provider:local", "abc123")
            .await
            .unwrap();
        drop(store);
        let reopened = EncryptedFileSearchSecretStore::open(dir.path()).unwrap();
        assert_eq!(
            reopened
                .get_secret("search-provider:local")
                .await
                .unwrap()
                .as_deref(),
            Some("abc123")
        );
    }
}
