//! Configuration file management for ORC daemon
//! Stores settings like listen port in platform-specific config directories:
//! - Windows: %APPDATA%\{OrcTorrent|OrcTorrent-AnimUS}\config.json
//! - macOS: ~/Library/Application Support/{OrcTorrent|OrcTorrent-AnimUS}/config.json
//! - Linux: ~/.config/{OrcTorrent|OrcTorrent-AnimUS}/config.json

use anyhow::{Context, Result};
use orc_core::{
    BandwidthSettings, DesiredPolicy, KillSwitchStoredSettings, NetPostureStoredSettings,
    SeedingSettings,
};
use serde::{Deserialize, Serialize};
use std::io::Write;
use std::path::{Component, Path, PathBuf};

use crate::search::{remove_legacy_builtin_providers, SearchSettings};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WatchFolderEntry {
    pub id: String,
    pub enabled: bool,
    pub folder_path: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub default_save_path: Option<String>,
    #[serde(default)]
    pub auto_start: bool,
    #[serde(default)]
    pub delete_after_import: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub archive_folder: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct WatchFolderSettings {
    #[serde(default)]
    pub enabled: bool,
    #[serde(default)]
    pub folders: Vec<WatchFolderEntry>,
}

impl WatchFolderSettings {
    pub fn validate(&self) -> Result<()> {
        for entry in &self.folders {
            validate_folder_path(&entry.folder_path)?;
            if let Some(ref save) = entry.default_save_path {
                if !save.trim().is_empty() {
                    validate_folder_path(save)?;
                }
            }
            if let Some(ref archive) = entry.archive_folder {
                if !archive.trim().is_empty() {
                    validate_folder_path(archive)?;
                }
            }
            if entry.delete_after_import && entry.archive_folder.is_some() {
                anyhow::bail!("cannot set both delete_after_import and archive_folder");
            }
        }
        Ok(())
    }
}

/// Reject path traversal and require non-empty path.
pub fn validate_folder_path(path: &str) -> Result<()> {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        anyhow::bail!("folder path cannot be empty");
    }
    let p = Path::new(trimmed);
    for component in p.components() {
        if matches!(component, Component::ParentDir) {
            anyhow::bail!("path must not contain '..'");
        }
    }
    Ok(())
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DaemonConfig {
    #[serde(default = "default_listen_port")]
    pub listen_port: u16,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub kill_switch: Option<KillSwitchStoredSettings>,
    #[serde(default)]
    pub search: SearchSettings,
    #[serde(default)]
    pub watch_folders: WatchFolderSettings,
    #[serde(default)]
    pub seeding: SeedingSettings,
    #[serde(default)]
    pub bandwidth: BandwidthSettings,
    #[serde(default)]
    pub net_posture: NetPostureStoredSettings,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub policy: Option<DesiredPolicy>,
}

fn default_listen_port() -> u16 {
    49000
}

const MIN_PORT: u16 = 1024;

impl Default for DaemonConfig {
    fn default() -> Self {
        Self {
            listen_port: default_listen_port(),
            kill_switch: None,
            search: SearchSettings::default(),
            watch_folders: WatchFolderSettings::default(),
            seeding: SeedingSettings::default(),
            bandwidth: BandwidthSettings::default(),
            net_posture: NetPostureStoredSettings::default(),
            policy: None,
        }
    }
}

/// Get the config file path using platform-specific directories.
pub fn config_path() -> Result<PathBuf> {
    if let Ok(explicit_dir) = std::env::var("ORC_CONFIG_DIR") {
        let trimmed = explicit_dir.trim();
        if !trimmed.is_empty() {
            return Ok(PathBuf::from(trimmed).join("config.json"));
        }
    }

    let folder_name = config_folder_name();
    let config_dir = if cfg!(target_os = "windows") {
        let appdata = std::env::var("APPDATA").context("APPDATA environment variable not set")?;
        PathBuf::from(appdata).join(&folder_name)
    } else if cfg!(target_os = "macos") {
        let home = std::env::var("HOME").context("HOME environment variable not set")?;
        PathBuf::from(home)
            .join("Library")
            .join("Application Support")
            .join(&folder_name)
    } else {
        let home = std::env::var("HOME").context("HOME environment variable not set")?;
        PathBuf::from(home).join(".config").join(&folder_name)
    };

    Ok(config_dir.join("config.json"))
}

fn config_folder_name() -> String {
    match std::env::var("ORC_TORRENT_EDITION") {
        Ok(edition) if edition.trim().eq_ignore_ascii_case("animus") => {
            "OrcTorrent-AnimUS".to_string()
        }
        _ => "OrcTorrent".to_string(),
    }
}

pub async fn load_config_from(config_file: &Path) -> Result<DaemonConfig> {
    if !config_file.exists() {
        for generation in 1..=CONFIG_BACKUP_GENERATIONS {
            let backup = backup_path(config_file, generation);
            if let Ok((config, _)) = read_valid_config(&backup).await {
                tracing::warn!(
                    "Primary daemon configuration is missing; restoring generation {generation} backup"
                );
                save_config_to(&config, config_file).await?;
                return Ok(config);
            }
        }
        let mut config = DaemonConfig::default();
        remove_legacy_builtin_providers(&mut config.search);
        save_config_to(&config, config_file).await?;
        return Ok(config);
    }

    let (config, migrated) = match read_valid_config(config_file).await {
        Ok(result) => result,
        Err(primary_error) => {
            let mut recovered = None;
            for generation in 1..=CONFIG_BACKUP_GENERATIONS {
                let backup = backup_path(config_file, generation);
                if let Ok((config, _)) = read_valid_config(&backup).await {
                    recovered = Some((generation, config));
                    break;
                }
            }
            let Some((generation, config)) = recovered else {
                return Err(primary_error).context(
                    "Primary daemon configuration is invalid and no valid last-known-good backup exists",
                );
            };
            tracing::warn!(
                "Primary daemon configuration is invalid; restoring generation {generation} backup"
            );
            save_config_to(&config, config_file).await?;
            return Ok(config);
        }
    };

    // Persist migration (e.g. stripping legacy builtin search providers) so the
    // next launch does not re-apply the same rewrite.
    if migrated {
        save_config_to(&config, config_file).await?;
    }

    Ok(config)
}

const CONFIG_BACKUP_GENERATIONS: usize = 3;

fn backup_path(config_file: &Path, generation: usize) -> PathBuf {
    let filename = config_file
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("config.json");
    config_file.with_file_name(format!("{filename}.bak.{generation}"))
}

async fn read_config_raw(config_file: &Path) -> Result<DaemonConfig> {
    let content = tokio::fs::read_to_string(config_file)
        .await
        .with_context(|| format!("Failed to read config file {}", config_file.display()))?;
    let config: DaemonConfig = serde_json::from_str(&content)
        .with_context(|| format!("Failed to parse config file {}", config_file.display()))?;
    Ok(config)
}

/// Parse config, migrate legacy search providers, then validate.
/// Returns `(config, migrated)` so callers can persist migration rewrites.
async fn read_valid_config(config_file: &Path) -> Result<(DaemonConfig, bool)> {
    let mut config = read_config_raw(config_file).await?;
    // Must run before validate: older builds stored builtin provider names without
    // feed_url, which now fails validation as custom providers.
    let migrated = remove_legacy_builtin_providers(&mut config.search);
    validate_config(&config)
        .with_context(|| format!("Invalid config file {}", config_file.display()))?;
    Ok((config, migrated))
}

pub async fn save_config_to(config: &DaemonConfig, config_file: &Path) -> Result<()> {
    validate_config(config).context("Refusing to persist invalid daemon configuration")?;
    if let Some(parent) = config_file.parent() {
        tokio::fs::create_dir_all(parent)
            .await
            .context("Failed to create config directory")?;
    }

    let content = serde_json::to_string_pretty(config).context("Failed to serialize config")?;
    let target = config_file.to_path_buf();
    tokio::task::spawn_blocking(move || atomic_replace_with_backups(&target, content.as_bytes()))
        .await
        .context("Configuration writer task failed")??;
    Ok(())
}

fn sync_file(path: &Path) -> Result<()> {
    std::fs::File::open(path)
        .with_context(|| format!("Failed to open {} for sync", path.display()))?
        .sync_all()
        .with_context(|| format!("Failed to sync {}", path.display()))
}

fn atomic_replace_with_backups(config_file: &Path, content: &[u8]) -> Result<()> {
    let parent = config_file
        .parent()
        .ok_or_else(|| anyhow::anyhow!("Configuration path has no parent"))?;
    let filename = config_file
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("config.json");
    let temp_path = parent.join(format!(".{filename}.{}.tmp", rand::random::<u64>()));

    let write_result = (|| -> Result<()> {
        let mut options = std::fs::OpenOptions::new();
        options.write(true).create_new(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        let mut file = options
            .open(&temp_path)
            .with_context(|| format!("Failed to create {}", temp_path.display()))?;
        file.write_all(content)
            .context("Failed to write temporary configuration")?;
        file.flush()
            .context("Failed to flush temporary configuration")?;
        file.sync_all()
            .context("Failed to sync temporary configuration")?;
        drop(file);

        for generation in (2..=CONFIG_BACKUP_GENERATIONS).rev() {
            let source = backup_path(config_file, generation - 1);
            let destination = backup_path(config_file, generation);
            if source.exists() {
                std::fs::copy(&source, &destination).with_context(|| {
                    format!(
                        "Failed to rotate config backup {} to {}",
                        source.display(),
                        destination.display()
                    )
                })?;
                sync_file(&destination)?;
            }
        }
        if config_file.exists() {
            let newest_backup = backup_path(config_file, 1);
            std::fs::copy(config_file, &newest_backup).with_context(|| {
                format!(
                    "Failed to create last-known-good config backup {}",
                    newest_backup.display()
                )
            })?;
            sync_file(&newest_backup)?;
        }

        #[cfg(windows)]
        if config_file.exists() {
            // Windows rename does not replace an existing file. A synced generation-1
            // backup is already present and load_config_from restores it after a crash.
            std::fs::remove_file(config_file).context("Failed to replace configuration")?;
        }
        std::fs::rename(&temp_path, config_file)
            .context("Failed to atomically replace configuration")?;

        #[cfg(unix)]
        std::fs::File::open(parent)
            .context("Failed to open configuration directory for sync")?
            .sync_all()
            .context("Failed to sync configuration directory")?;
        Ok(())
    })();

    if write_result.is_err() {
        let _ = std::fs::remove_file(&temp_path);
    }
    write_result
}

const MAX_GRACE_PERIOD: u64 = 3600;

fn validate_config(config: &DaemonConfig) -> Result<()> {
    if config.listen_port < MIN_PORT {
        return Err(anyhow::anyhow!(
            "Invalid listen_port: {} (must be between {} and {})",
            config.listen_port,
            MIN_PORT,
            u16::MAX
        ));
    }
    if let Some(ref ks) = config.kill_switch {
        if ks.grace_period_sec > MAX_GRACE_PERIOD {
            return Err(anyhow::anyhow!(
                "Invalid kill_switch.grace_period_sec: {} (max {})",
                ks.grace_period_sec,
                MAX_GRACE_PERIOD
            ));
        }
    }
    config.search.validate()?;
    config.watch_folders.validate()?;
    config.seeding.validate()?;
    config.bandwidth.validate()?;
    if let Some(ref policy) = config.policy {
        policy.validate()?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_parent_dir_in_path() {
        assert!(validate_folder_path("/foo/../bar").is_err());
    }

    #[test]
    fn accepts_normal_path() {
        assert!(validate_folder_path("/home/user/watch").is_ok());
    }

    #[test]
    fn rejects_empty_path() {
        assert!(validate_folder_path("").is_err());
        assert!(validate_folder_path("   ").is_err());
    }

    #[test]
    fn watch_folder_settings_rejects_delete_and_archive() {
        let settings = WatchFolderSettings {
            enabled: true,
            folders: vec![WatchFolderEntry {
                id: "1".into(),
                enabled: true,
                folder_path: "/tmp/watch".into(),
                default_save_path: None,
                auto_start: true,
                delete_after_import: true,
                archive_folder: Some("/tmp/archive".into()),
            }],
        };
        assert!(settings.validate().is_err());
    }

    #[test]
    fn config_round_trip_includes_watch_and_net_posture() {
        let mut config = DaemonConfig::default();
        config.watch_folders.enabled = true;
        config.watch_folders.folders.push(WatchFolderEntry {
            id: "wf-1".into(),
            enabled: true,
            folder_path: "/home/user/watch".into(),
            default_save_path: Some("/home/user/downloads".into()),
            auto_start: false,
            delete_after_import: true,
            archive_folder: None,
        });
        config.net_posture.bind_interface = Some("utun4".into());
        config.net_posture.leak_proof_enabled = true;

        let json = serde_json::to_string(&config).unwrap();
        let parsed: DaemonConfig = serde_json::from_str(&json).unwrap();
        assert!(parsed.watch_folders.enabled);
        assert_eq!(parsed.watch_folders.folders.len(), 1);
        assert!(!parsed.watch_folders.folders[0].auto_start);
        assert!(parsed.watch_folders.folders[0].delete_after_import);
        assert_eq!(parsed.net_posture.bind_interface.as_deref(), Some("utun4"));
        assert!(parsed.net_posture.leak_proof_enabled);
    }

    #[test]
    fn config_round_trip_includes_policy() {
        use orc_core::{DesiredPolicy, PaddingLevel, PolicyProfile, TriState};

        let config = DaemonConfig {
            policy: Some(DesiredPolicy {
                engine: orc_engine::EngineNetworkPolicy::default(),
                anonymous_mode: false,
                peer_encryption: TriState::Prefer,
                peer_encryption_opt_in: true,
                dht_hardening: true,
                enforce_private_torrents: false,
                ip_blocklist: true,
                kill_switch: true,
                bind_interface_only: true,
                overlay_padding: PaddingLevel::Off,
                sybil_resistance: false,
                relay_pow_required: false,
                relay_subnet_diversity: false,
                relay_reputation_weighting: false,
                ipv6_enabled: true,
                upnp_natpmp_enabled: false,
                circuit_rotation_enabled: false,
                deny_direct_exits: false,
                minimize_fingerprinting: false,
                profile: Some(PolicyProfile::Hardened),
            }),
            ..Default::default()
        };

        let json = serde_json::to_string(&config).unwrap();
        let parsed: DaemonConfig = serde_json::from_str(&json).unwrap();
        let policy = parsed.policy.unwrap();
        assert!(policy.ip_blocklist);
        assert!(policy.kill_switch);
        assert!(!policy.upnp_natpmp_enabled);
        assert_eq!(policy.profile, Some(PolicyProfile::Hardened));
    }

    #[test]
    fn legacy_policy_without_engine_uses_beta_auto_defaults() {
        use orc_core::{PaddingLevel, PolicyProfile, TriState};

        let config = DaemonConfig {
            policy: Some(DesiredPolicy {
                engine: orc_engine::EngineNetworkPolicy::default(),
                anonymous_mode: false,
                peer_encryption: TriState::Off,
                peer_encryption_opt_in: false,
                dht_hardening: false,
                enforce_private_torrents: false,
                ip_blocklist: false,
                kill_switch: false,
                bind_interface_only: false,
                overlay_padding: PaddingLevel::Off,
                sybil_resistance: false,
                relay_pow_required: false,
                relay_subnet_diversity: false,
                relay_reputation_weighting: false,
                ipv6_enabled: false,
                upnp_natpmp_enabled: false,
                circuit_rotation_enabled: false,
                deny_direct_exits: false,
                minimize_fingerprinting: false,
                profile: Some(PolicyProfile::Standard),
            }),
            ..Default::default()
        };
        let mut value = serde_json::to_value(config).expect("serialize old config");
        value["policy"]
            .as_object_mut()
            .expect("policy object")
            .remove("engine");
        value["policy"]
            .as_object_mut()
            .expect("policy object")
            .remove("peer_encryption_opt_in");

        let parsed: DaemonConfig = serde_json::from_value(value).expect("legacy config");
        let policy = parsed.policy.expect("policy");
        assert!(!policy.peer_encryption_opt_in);
        let engine = policy.engine.resolve_beta();
        assert_eq!(engine.mode, orc_engine::EngineMode::Auto);
        assert!(engine.transports.tcp);
        assert!(!engine.transports.utp);
        assert!(!engine.transports.ipv6);
        assert!(!engine.discovery.lsd);
    }

    #[test]
    fn config_round_trip() {
        let config = DaemonConfig::default();
        let json = serde_json::to_string(&config).unwrap();
        let parsed: DaemonConfig = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed.listen_port, config.listen_port);
        assert!(!parsed.watch_folders.enabled);
    }

    #[tokio::test]
    async fn corrupt_primary_restores_last_known_good_backup() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("config.json");
        let first = DaemonConfig {
            listen_port: 49_001,
            ..Default::default()
        };
        save_config_to(&first, &path).await.unwrap();

        let mut second = first.clone();
        second.listen_port = 49_002;
        save_config_to(&second, &path).await.unwrap();
        tokio::fs::write(&path, b"{not-json").await.unwrap();

        let recovered = load_config_from(&path).await.unwrap();
        assert_eq!(recovered.listen_port, first.listen_port);
        let (durable, _) = read_valid_config(&path).await.unwrap();
        assert_eq!(durable.listen_port, first.listen_port);
    }

    #[tokio::test]
    async fn corrupt_primary_without_backup_fails_closed() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("config.json");
        tokio::fs::write(&path, b"{not-json").await.unwrap();

        let error = load_config_from(&path).await.unwrap_err();
        assert!(error
            .to_string()
            .contains("no valid last-known-good backup"));
    }

    #[tokio::test]
    async fn invalid_config_is_rejected_before_replacing_active_file() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("config.json");
        let valid = DaemonConfig::default();
        save_config_to(&valid, &path).await.unwrap();

        let mut invalid = valid.clone();
        invalid.listen_port = 80;
        assert!(save_config_to(&invalid, &path).await.is_err());
        assert_eq!(
            read_valid_config(&path).await.unwrap().0.listen_port,
            valid.listen_port
        );
    }

    #[tokio::test]
    async fn legacy_builtin_search_providers_are_migrated_before_validate() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("config.json");
        // Mirrors configs written by older builds that auto-bundled providers.
        tokio::fs::write(
            &path,
            r#"{
              "listen_port": 49000,
              "search": {
                "enabled": true,
                "default_provider": "internet_archive",
                "default_result_limit": 25,
                "allow_private_remote_urls": false,
                "providers": [
                  { "name": "yts", "enabled": true, "format": "open_content_json" },
                  { "name": "tpb_movies", "enabled": true, "format": "open_content_json" },
                  { "name": "x1337_movies", "enabled": true, "format": "open_content_json" }
                ]
              }
            }"#,
        )
        .await
        .unwrap();

        let loaded = load_config_from(&path)
            .await
            .expect("legacy config should migrate");
        assert!(!loaded.search.enabled);
        assert!(loaded.search.default_provider.is_none());
        assert!(loaded.search.providers.is_empty());

        let durable = tokio::fs::read_to_string(&path).await.unwrap();
        let persisted: DaemonConfig = serde_json::from_str(&durable).unwrap();
        assert!(persisted.search.providers.is_empty());
        assert!(!persisted.search.enabled);
    }
}
