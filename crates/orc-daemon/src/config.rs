//! Configuration file management for ORC daemon
//! Stores settings like listen port in platform-specific config directories:
//! - Windows: %APPDATA%\OrcTorrent\config.json
//! - macOS: ~/Library/Application Support/OrcTorrent/config.json
//! - Linux: ~/.config/OrcTorrent/config.json

use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DaemonConfig {
    #[serde(default = "default_listen_port")]
    pub listen_port: u16,
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
        }
    }
}

/// Get the config file path using platform-specific directories.
///
/// Returns:
/// - Windows: `%APPDATA%\OrcTorrent\config.json`
/// - macOS: `~/Library/Application Support/OrcTorrent/config.json`
/// - Linux: `~/.config/OrcTorrent/config.json`
pub fn config_path() -> Result<PathBuf> {
    let config_dir = if cfg!(target_os = "windows") {
        let appdata = std::env::var("APPDATA")
            .context("APPDATA environment variable not set")?;
        PathBuf::from(appdata).join("OrcTorrent")
    } else if cfg!(target_os = "macos") {
        let home = std::env::var("HOME")
            .context("HOME environment variable not set")?;
        PathBuf::from(home).join("Library").join("Application Support").join("OrcTorrent")
    } else {
        let home = std::env::var("HOME")
            .context("HOME environment variable not set")?;
        PathBuf::from(home).join(".config").join("OrcTorrent")
    };
    
    Ok(config_dir.join("config.json"))
}

/// Load configuration from file, or return default if file doesn't exist
pub async fn load_config() -> Result<DaemonConfig> {
    let config_file = config_path()?;
    
    if !config_file.exists() {
        let config = DaemonConfig::default();
        save_config(&config).await?;
        return Ok(config);
    }
    
    let content = tokio::fs::read_to_string(&config_file)
        .await
        .context("Failed to read config file")?;
    
    let config: DaemonConfig = serde_json::from_str(&content)
        .context("Failed to parse config file")?;
    
    // Security: Validate config values
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
    
    let content = serde_json::to_string_pretty(config)
        .context("Failed to serialize config")?;
    
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

fn validate_config(config: &DaemonConfig) -> Result<()> {
    if config.listen_port < MIN_PORT || config.listen_port > MAX_PORT {
        return Err(anyhow::anyhow!(
            "Invalid listen_port: {} (must be between {} and {})",
            config.listen_port,
            MIN_PORT,
            MAX_PORT
        ));
    }
    
    Ok(())
}
