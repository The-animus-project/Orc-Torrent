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
use std::path::{Component, Path, PathBuf};

use crate::search::{apply_edition_search_defaults, SearchSettings};

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

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WatchFolderSettings {
    #[serde(default)]
    pub enabled: bool,
    #[serde(default)]
    pub folders: Vec<WatchFolderEntry>,
}

impl Default for WatchFolderSettings {
    fn default() -> Self {
        Self {
            enabled: false,
            folders: Vec::new(),
        }
    }
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
const MAX_PORT: u16 = 65535;

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

/// Load configuration from file, or return default if file doesn't exist
pub async fn load_config() -> Result<DaemonConfig> {
    let config_file = config_path()?;

    if !config_file.exists() {
        let mut config = DaemonConfig::default();
        apply_edition_search_defaults(&mut config.search);
        save_config(&config).await?;
        return Ok(config);
    }

    let content = tokio::fs::read_to_string(&config_file)
        .await
        .context("Failed to read config file")?;

    let mut config: DaemonConfig =
        serde_json::from_str(&content).context("Failed to parse config file")?;

    if apply_edition_search_defaults(&mut config.search) {
        validate_config(&config)?;
        save_config(&config).await?;
        return Ok(config);
    }

    validate_config(&config)?;

    Ok(config)
}

/// Save configuration to file
pub async fn save_config(config: &DaemonConfig) -> Result<()> {
    let config_file = config_path()?;
    if let Some(parent) = config_file.parent() {
        tokio::fs::create_dir_all(parent)
            .await
            .context("Failed to create config directory")?;
    }

    let content = serde_json::to_string_pretty(config).context("Failed to serialize config")?;

    tokio::fs::write(&config_file, content)
        .await
        .context("Failed to write config file")?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mut perms = tokio::fs::metadata(&config_file)
            .await
            .context("Failed to get config file metadata")?
            .permissions();
        perms.set_mode(0o600);
        tokio::fs::set_permissions(&config_file, perms)
            .await
            .context("Failed to set config file permissions")?;
    }

    Ok(())
}

const MAX_GRACE_PERIOD: u64 = 3600;

fn validate_config(config: &DaemonConfig) -> Result<()> {
    if config.listen_port < MIN_PORT || config.listen_port > MAX_PORT {
        return Err(anyhow::anyhow!(
            "Invalid listen_port: {} (must be between {} and {})",
            config.listen_port,
            MIN_PORT,
            MAX_PORT
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

        let mut config = DaemonConfig::default();
        config.policy = Some(DesiredPolicy {
            anonymous_mode: false,
            peer_encryption: TriState::Prefer,
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
        });

        let json = serde_json::to_string(&config).unwrap();
        let parsed: DaemonConfig = serde_json::from_str(&json).unwrap();
        let policy = parsed.policy.unwrap();
        assert!(policy.ip_blocklist);
        assert!(policy.kill_switch);
        assert!(!policy.upnp_natpmp_enabled);
        assert_eq!(policy.profile, Some(PolicyProfile::Hardened));
    }

    #[test]
    fn config_round_trip() {
        let config = DaemonConfig::default();
        let json = serde_json::to_string(&config).unwrap();
        let parsed: DaemonConfig = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed.listen_port, config.listen_port);
        assert!(!parsed.watch_folders.enabled);
    }
}
