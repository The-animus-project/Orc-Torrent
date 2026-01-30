//! ORC Core: shared types + in-memory state used by the Orc Torrent daemon.
//!
//! This now embeds a real BitTorrent runtime (rqbit via `librqbit`) behind the existing API.

use std::{
    collections::{HashMap, HashSet},
    path::PathBuf,
    sync::Arc,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
    net::IpAddr,
};

use anyhow::{anyhow, Context, Result};
use serde::{Deserialize, Serialize};
use tracing::info;
use uuid::Uuid;
use base64::{engine::general_purpose, Engine as _};
use sha1::{Sha1, Digest};
use hex;
use regex::Regex;
use network_interface::{NetworkInterface, NetworkInterfaceConfig};
use maxminddb::{Reader, geoip2::Country};

use librqbit::Session;
use librqbit::api::{Api as RqbitApi, ApiAddTorrentResponse, TorrentIdOrHash};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TorrentMode {
    Standard,
    Private,
    Anonymous,
    TorAssist,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TorrentProfile {
    pub mode: TorrentMode,
    pub hops: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Torrent {
    pub id: String,
    pub name: String,
    pub added_at_ms: u64,
    pub running: bool,
    pub profile: TorrentProfile,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub info_hash_hex: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub save_path: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TorrentState {
    Stopped,
    Downloading,
    Seeding,
    Checking,
    Error,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TorrentStatus {
    pub id: String,
    pub state: TorrentState,
    pub progress: f64,
    pub down_rate_bps: u64,
    pub up_rate_bps: u64,
    pub eta_sec: u64,
    pub total_bytes: u64,
    pub downloaded_bytes: u64,
    pub peers_seen: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TorrentRowSnapshot {
    pub progress: f64,
    pub state: TorrentState,
    pub pieces_bins: Vec<PieceBin>,
    pub heartbeat_samples: Vec<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PieceBin {
    pub have_ratio: f64,
    pub min_avail: u32,
    pub pieces_in_bin: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WalletStatus {
    pub allowance_bytes_remaining: u64,
    pub balance_credits: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Circuit {
    pub id: String,
    pub hops: u32,
    pub healthy: bool,
    pub rtt_ms: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OverlayStatus {
    pub enabled: bool,
    pub circuits: Vec<Circuit>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum VpnPostureState {
    Connected,
    Disconnected,
    Unknown,
    Checking,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum KillSwitchState {
    Disarmed,
    Armed,
    Engaged,
    Releasing,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum KillSwitchScope {
    TorrentOnly,
    AppLevel,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VpnSignals {
    pub adapter_match: bool,
    pub default_route_match: bool,
    pub dns_match: bool,
    pub public_ip_match: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ConnectionType {
    Vpn,
    Tor,
    I2p,
    NonVpn,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VpnStatus {
    pub posture: VpnPostureState,
    #[serde(rename = "interface")]
    pub interface_name: Option<String>,
    pub default_route_interface: Option<String>,
    pub dns_servers: Vec<String>,
    pub signals: VpnSignals,
    pub last_check_ms: u64,
    pub connection_type: ConnectionType,
    pub public_ip: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub detected: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub interface_name_legacy: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VpnSource {
    pub auto_detect: bool,
    pub allowed_adapters: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KillSwitchTriggers {
    pub pause_all_torrents: bool,
    pub stop_seeding: bool,
    pub disable_dht_pex_lpd: bool,
    pub block_outbound: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KillSwitchConfig {
    pub enabled: bool,
    pub scope: KillSwitchScope,
    pub vpn_source: VpnSource,
    pub grace_period_sec: u64,
    pub triggers: KillSwitchTriggers,
    pub enforcement_state: KillSwitchState,
    pub last_enforcement_ms: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NetPosture {
    pub bind_interface: Option<String>,
    pub leak_proof_enabled: bool,
    pub state: NetPostureState,
    pub last_change_ms: u64,
    pub vpn_status: VpnStatus,
    pub kill_switch: KillSwitchConfig,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum NetPostureState {
    Unconfigured,
    Protected,
    LeakRisk,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Health {
    pub ok: bool,
    pub uptime_sec: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Version {
    pub version: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TorrentListResponse {
    pub items: Vec<Torrent>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TriState {
    Off,
    Prefer,
    Require,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PaddingLevel {
    Off,
    Low,
    High,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PolicyProfile {
    Standard,
    Hardened,
    Anonymous,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DesiredPolicy {
    pub anonymous_mode: bool,
    pub peer_encryption: TriState,
    pub dht_hardening: bool,
    pub enforce_private_torrents: bool,
    pub ip_blocklist: bool,
    pub kill_switch: bool,
    pub bind_interface_only: bool,
    pub overlay_padding: PaddingLevel,
    pub sybil_resistance: bool,
    pub relay_pow_required: bool,
    pub relay_subnet_diversity: bool,
    pub relay_reputation_weighting: bool,
    // Max Privacy settings
    pub ipv6_enabled: bool,
    pub upnp_natpmp_enabled: bool,
    pub circuit_rotation_enabled: bool,
    pub deny_direct_exits: bool,
    pub minimize_fingerprinting: bool,
    pub profile: Option<PolicyProfile>,
}

impl DesiredPolicy {
    pub fn validate(&self) -> Result<()> {
        Ok(())
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EffectivePolicy {
    pub anonymous_mode: bool,
    pub peer_encryption: TriState,
    pub dht_hardening: bool,
    pub enforce_private_torrents: bool,
    pub ip_blocklist: bool,
    pub kill_switch: bool,
    pub bind_interface_only: bool,
    pub overlay_padding: PaddingLevel,
    pub sybil_resistance: bool,
    pub relay_pow_required: bool,
    pub relay_subnet_diversity: bool,
    pub relay_reputation_weighting: bool,
    pub ipv6_enabled: bool,
    pub upnp_natpmp_enabled: bool,
    pub circuit_rotation_enabled: bool,
    pub deny_direct_exits: bool,
    pub minimize_fingerprinting: bool,
    pub profile: Option<PolicyProfile>,
    pub network_allowed: bool,
    pub discovery_allowed: bool,
    pub direct_peer_allowed: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PolicyWarning {
    pub code: String,
    pub message: String,
    pub severity: PolicyWarningSeverity,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PolicyWarningSeverity {
    Info,
    Warn,
    Block,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToggleDisabled {
    pub disabled: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PolicyState {
    pub desired: DesiredPolicy,
    pub effective: EffectivePolicy,
    pub warnings: Vec<PolicyWarning>,
    pub disabled: HashMap<String, ToggleDisabled>,
    pub version: u64,
    #[serde(rename = "lastUpdatedMs")]
    pub last_updated_ms: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TorrentContent {
    pub files: Vec<TorrentFileEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TorrentFileEntry {
    pub path: Vec<String>,
    pub size: u64,
    pub priority: String,
    pub downloaded: bool,
}


#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PeersResponse {
    pub peers: Vec<PeerRow>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PeerRow {
    /// Stable row identifier (typically "ip:port").
    pub id: String,

    pub ip: String,
    pub port: u16,

    /// Download rate in bytes/sec as observed by the runtime (best-effort).
    pub down_rate: i64,
    /// Upload rate in bytes/sec as observed by the runtime (best-effort).
    pub up_rate: i64,

    /// Total bytes downloaded from this peer (best-effort).
    pub downloaded: u64,
    /// Total bytes uploaded to this peer (best-effort).
    pub uploaded: u64,

    /// Peer client string (best-effort).
    pub client: Option<String>,
    /// Flags similar to qBittorrent (best-effort, not a 1:1 map).
    pub flags: Option<String>,

    /// Per-peer progress in [0..1] (often unknown).
    pub progress: Option<f32>,

    /// Protocol-ish booleans (best-effort).
    pub snubbed: bool,
    pub choked: bool,
    pub interested: Option<bool>,
    pub optimistic: Option<bool>,
    pub incoming: Option<bool>,
    pub encrypted: Option<bool>,

    /// Round-trip time in ms (often unknown).
    pub rtt_ms: Option<u32>,

    /// Country code/name (often unknown).
    pub country: Option<String>,

    /// When we last saw this peer (ms since epoch).
    pub last_seen_ms: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TrackersResponse {
    pub trackers: Vec<TrackerRow>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TrackerRow {
    pub url: String,
    pub tier: Option<u32>,
    pub status: String,
    pub seeders: Option<u32>,
    pub leechers: Option<u32>,
    pub last_announce_ms: Option<u64>,
    pub next_announce_ms: Option<u64>,
    pub error: Option<String>,
    pub announce_count: Option<u32>,
    pub scrape_count: Option<u32>,
}

#[derive(Debug, Clone)]
#[allow(dead_code)]
struct PeerSample {
    downloaded: u64,
    uploaded: u64,
    last_seen_ms: u64,
    at: Instant,
}

#[derive(Debug, Clone, Default)]
struct TrackerRuntimeState {
    last_announce_ms: Option<u64>,
    next_announce_ms: Option<u64>,
    announce_count: u32,
    scrape_count: u32,
    last_error: Option<String>,
}

#[derive(Debug, Clone)]
struct StateOverride {
    until: Instant,
    state: TorrentState,
}

#[derive(Debug, Clone)]
struct TorrentRuntime {
    rqbit_id: usize,
    total_bytes: u64,
    downloaded_bytes: u64,
    uploaded_bytes: u64,
    running: bool,
    state: TorrentState,
    down_rate_bps: u64,
    up_rate_bps: u64,
    peers_seen: u32,
    files: Vec<TorrentFileEntry>,
    last_error: Option<String>,

    trackers: Vec<String>,
    tracker_state: HashMap<String, TrackerRuntimeState>,

    #[allow(dead_code)]
    peer_samples: HashMap<String, PeerSample>,

    state_override: Option<StateOverride>,

    last_sample: Instant,
    last_downloaded_bytes: u64,
    last_uploaded_bytes: u64,

    heartbeat_samples: Vec<u64>,
    heartbeat_last_sample: Instant,
    heartbeat_last_bytes: u64,

    total_pieces_estimate: u32,
    piece_availability: Vec<u32>,
    #[allow(dead_code)]
    peer_progress_cache: HashMap<String, f32>,
}

#[derive(Debug, Clone)]
struct TorrentRecord {
    torrent: Torrent,
    runtime: TorrentRuntime,
}

pub const MAX_TORRENTS: usize = 10000;
pub const MAX_PEER_SAMPLES_PER_TORRENT: usize = 1000;

pub struct OrcState {
    started_at: Instant,
    #[allow(dead_code)]
    download_dir: String,
    #[allow(dead_code)]
    download_dir_path: PathBuf,
    rqbit: RqbitApi,
    torrents: HashMap<String, TorrentRecord>,
    policy: PolicyState,
    kill_switch: KillSwitchConfig,
    #[allow(dead_code)]
    geoip_reader: Option<Reader<Vec<u8>>>,
}

impl OrcState {
    /// Default download directory path (canonical). Used when adding torrents without a custom save_path.
    pub fn download_dir_path(&self) -> &PathBuf {
        &self.download_dir_path
    }
}

pub type SharedState = Arc<tokio::sync::Mutex<OrcState>>;

pub fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or(Duration::from_secs(0))
        .as_millis() as u64
}

fn load_geoip_database() -> Option<Reader<Vec<u8>>> {
    let possible_paths = vec![
        PathBuf::from("assets/GeoLite2-Country.mmdb"),
        PathBuf::from("../../assets/GeoLite2-Country.mmdb"),
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .and_then(|p| p.parent())
            .map(|p| p.join("assets/GeoLite2-Country.mmdb"))
            .unwrap_or_default(),
    ];

    for path in possible_paths {
        if let Ok(data) = std::fs::read(&path) {
            match Reader::from_source(data) {
                Ok(reader) => {
                    info!("Loaded GeoIP database from: {:?}", path);
                    return Some(reader);
                }
                Err(e) => {
                    tracing::warn!("Failed to parse GeoIP database at {:?}: {}", path, e);
                }
            }
        }
    }

    tracing::warn!("GeoIP database not found. Peer country information will not be available.");
    None
}

#[allow(dead_code)]
fn lookup_country(reader: &Reader<Vec<u8>>, ip: &str) -> Option<String> {
    let ip_addr: IpAddr = ip.parse().ok()?;
    if is_private_ip(&ip_addr) {
        return None;
    }
    let country: Country = reader.lookup(ip_addr).ok()?;
    country
        .country
        .and_then(|c| c.iso_code)
        .map(|code| code.to_string())
}

#[allow(dead_code)]
fn is_private_ip(ip: &IpAddr) -> bool {
    match ip {
        IpAddr::V4(ipv4) => {
            ipv4.is_private() || ipv4.is_loopback() || ipv4.is_link_local() || ipv4.is_broadcast()
        }
        IpAddr::V6(ipv6) => {
            ipv6.is_loopback() || ipv6.is_multicast()
        }
    }
}

pub async fn new_state(download_dir: String, listen_port: u16) -> Result<SharedState> {
    let download_path = PathBuf::from(download_dir.clone());
    let download_dir_canonical = download_path
        .canonicalize()
        .or_else(|_| {
            // If path doesn't exist yet, create it and then canonicalize
            std::fs::create_dir_all(&download_path)?;
            download_path.canonicalize()
        })
        .context("Failed to canonicalize download directory")?;
    std::env::set_var("RQBIT_TCP_LISTEN_PORT", listen_port.to_string());
    std::env::set_var("RQBIT_UDP_LISTEN_PORT", listen_port.to_string());
    
    let session = Session::new(download_dir_canonical.clone())
        .await
        .context("Failed to initialize rqbit session")?;
    let rqbit = RqbitApi::new(session, None);

    let desired = DesiredPolicy {
        anonymous_mode: false,
        peer_encryption: TriState::Prefer,
        dht_hardening: true,
        enforce_private_torrents: false,
        ip_blocklist: false,
        kill_switch: false,
        bind_interface_only: false,
        overlay_padding: PaddingLevel::Off,
        sybil_resistance: false,
        relay_pow_required: false,
        relay_subnet_diversity: false,
        relay_reputation_weighting: false,
        ipv6_enabled: true,
        upnp_natpmp_enabled: true,
        circuit_rotation_enabled: false,
        deny_direct_exits: false,
        minimize_fingerprinting: false,
        profile: Some(PolicyProfile::Standard),
    };

    let effective = EffectivePolicy {
        anonymous_mode: desired.anonymous_mode,
        peer_encryption: desired.peer_encryption.clone(),
        dht_hardening: desired.dht_hardening,
        enforce_private_torrents: desired.enforce_private_torrents,
        ip_blocklist: desired.ip_blocklist,
        kill_switch: desired.kill_switch,
        bind_interface_only: desired.bind_interface_only,
        overlay_padding: desired.overlay_padding.clone(),
        sybil_resistance: desired.sybil_resistance,
        relay_pow_required: desired.relay_pow_required,
        relay_subnet_diversity: desired.relay_subnet_diversity,
        relay_reputation_weighting: desired.relay_reputation_weighting,
        ipv6_enabled: desired.ipv6_enabled,
        upnp_natpmp_enabled: desired.upnp_natpmp_enabled,
        circuit_rotation_enabled: desired.circuit_rotation_enabled,
        deny_direct_exits: desired.deny_direct_exits,
        minimize_fingerprinting: desired.minimize_fingerprinting,
        profile: desired.profile.clone(),
        network_allowed: true,
        discovery_allowed: true,
        direct_peer_allowed: true,
    };

    let mut disabled: HashMap<String, ToggleDisabled> = HashMap::new();
    for k in [
        "anonymous_mode",
        "peer_encryption",
        "dht_hardening",
        "enforce_private_torrents",
        "ip_blocklist",
        "kill_switch",
        "bind_interface_only",
        "overlay_padding",
        "sybil_resistance",
        "relay_pow_required",
        "relay_subnet_diversity",
        "relay_reputation_weighting",
        "ipv6_enabled",
        "upnp_natpmp_enabled",
        "circuit_rotation_enabled",
        "deny_direct_exits",
        "minimize_fingerprinting",
        "profile",
    ] {
        disabled.insert(
            k.to_string(),
            ToggleDisabled {
                disabled: false,
                reason: None,
            },
        );
    }

    let policy = PolicyState {
        desired: desired.clone(),
        effective,
        warnings: vec![],
        disabled,
        version: 1,
        last_updated_ms: now_ms(),
    };

    let kill_switch = KillSwitchConfig {
        enabled: false,
        scope: KillSwitchScope::TorrentOnly,
        vpn_source: VpnSource {
            auto_detect: true,
            allowed_adapters: vec![],
        },
        grace_period_sec: 10,
        triggers: KillSwitchTriggers {
            pause_all_torrents: true,
            stop_seeding: false,
            disable_dht_pex_lpd: false,
            block_outbound: false,
        },
        enforcement_state: KillSwitchState::Disarmed,
        last_enforcement_ms: None,
    };

    let geoip_reader = load_geoip_database();

    Ok(Arc::new(tokio::sync::Mutex::new(OrcState {
        started_at: Instant::now(),
        download_dir,
        download_dir_path: download_dir_canonical,
        rqbit,
        torrents: HashMap::new(),
        policy,
        kill_switch,
        geoip_reader,
    })))
}

#[derive(Debug, Clone, Deserialize)]
pub struct AddTorrentRequest {
    pub magnet: Option<String>,
    pub torrent_b64: Option<String>,
    pub name_hint: Option<String>,
    /// Optional save path (folder) for this torrent. Use for seeding from an existing folder
    /// or to choose where to download. Must be an absolute path. If omitted, uses default download folder.
    pub save_path: Option<String>,
}

impl AddTorrentRequest {
    pub fn validate(&self) -> Result<()> {
        if let Some(ref hint) = self.name_hint {
            const MAX_NAME_HINT_LENGTH: usize = 1000;
            if hint.len() > MAX_NAME_HINT_LENGTH {
                return Err(anyhow!("Name hint too long (max {} chars)", MAX_NAME_HINT_LENGTH));
            }
        }
        if let Some(ref path) = self.save_path {
            let trimmed = path.trim();
            if trimmed.is_empty() {
                return Err(anyhow!("save_path cannot be empty"));
            }
            const MAX_SAVE_PATH_LENGTH: usize = 4096;
            if trimmed.len() > MAX_SAVE_PATH_LENGTH {
                return Err(anyhow!("save_path too long (max {} chars)", MAX_SAVE_PATH_LENGTH));
            }
            if trimmed.contains('\0') {
                return Err(anyhow!("save_path cannot contain null bytes"));
            }
        }
        let has_magnet = self.magnet.is_some();
        let has_torrent = self.torrent_b64.is_some();

        if !has_magnet && !has_torrent {
            return Err(anyhow!("Must provide either magnet or torrent_b64"));
        }

        if has_magnet && has_torrent {
            return Err(anyhow!("Cannot provide both magnet and torrent_b64"));
        }

        Ok(())
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct AddTorrentResponse {
    pub id: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct PatchTorrentProfileRequest {
    pub mode: TorrentMode,
    pub hops: u32,
}

impl PatchTorrentProfileRequest {
    pub fn validate(&self) -> Result<()> {
        const MAX_HOPS: u32 = 10;
        if self.hops > MAX_HOPS {
            return Err(anyhow!("Hops value too large (max {})", MAX_HOPS));
        }
        Ok(())
    }
}

#[derive(Debug, Clone, Deserialize)]
pub struct PatchFilePriorityRequest {
    pub paths: Vec<Vec<String>>,
    pub priority: String,
}

impl PatchFilePriorityRequest {
    pub fn validate(&self) -> Result<()> {
        const MAX_PATHS: usize = 10000;
        if self.paths.len() > MAX_PATHS {
            return Err(anyhow!("Too many paths (max {})", MAX_PATHS));
        }
        const VALID_PRIORITIES: &[&str] = &["skip", "low", "normal", "high"];
        if !VALID_PRIORITIES.contains(&self.priority.as_str()) {
            return Err(anyhow!("Invalid priority: must be one of {:?}", VALID_PRIORITIES));
        }
        const MAX_PATH_DEPTH: usize = 100;
        for path in &self.paths {
            if path.len() > MAX_PATH_DEPTH {
                return Err(anyhow!("Path depth too large (max {} components)", MAX_PATH_DEPTH));
            }
            for component in path {
                if component.len() > 255 {
                    return Err(anyhow!("Path component too long (max 255 chars)"));
                }
            }
        }
        
        Ok(())
    }
}

#[derive(Debug, Clone, Deserialize)]
pub struct PatchKillSwitchRequest {
    pub enabled: Option<bool>,
    pub scope: Option<KillSwitchScope>,
    pub grace_period_sec: Option<u64>,
    pub triggers: Option<KillSwitchTriggers>,
}

impl PatchKillSwitchRequest {
    pub fn validate(&self) -> Result<()> {
        if let Some(gp) = self.grace_period_sec {
            const MAX_GRACE_PERIOD: u64 = 3600;
            if gp > MAX_GRACE_PERIOD {
                return Err(anyhow!("Grace period too large (max {} seconds)", MAX_GRACE_PERIOD));
            }
        }
        Ok(())
    }
}

pub fn health(state: &OrcState) -> Health {
    Health {
        ok: true,
        uptime_sec: state.started_at.elapsed().as_secs(),
    }
}

pub fn version() -> Version {
    Version {
        version: env!("CARGO_PKG_VERSION").to_string(),
    }
}

pub fn wallet_status() -> WalletStatus {
    WalletStatus {
        allowance_bytes_remaining: 50 * 1024 * 1024 * 1024,
        balance_credits: 1_000,
    }
}

pub fn overlay_status() -> OverlayStatus {
    OverlayStatus {
        enabled: false,
        circuits: vec![],
    }
}

/// Detect VPN interfaces by matching common VPN interface name patterns.
///
/// This function scans network interfaces and matches them against known VPN patterns:
/// - VPN provider names (NordVPN, Mullvad, Proton, etc.)
/// - Protocol names (OpenVPN, WireGuard)
/// - TUN/TAP interface patterns (tun0, tap0, wg0, etc.)
///
/// The function excludes common non-VPN interfaces (loopback, ethernet, wifi, etc.)
/// and only returns interfaces that have active addresses.
///
/// **Note**: Regex patterns use `.unwrap()` but are compile-time constants, so panics
/// would occur at startup if invalid. This is acceptable for static patterns.
///
/// # Returns
/// - `None` if no VPN interface is detected
/// - `Some((interface_name, ConnectionType::Vpn))` if a VPN interface is found
fn detect_vpn_interface() -> Option<(String, ConnectionType)> {
    let interfaces = match NetworkInterface::show() {
        Ok(interfaces) => interfaces,
        Err(_) => return None,
    };

    // VPN interface name patterns - using specific patterns to avoid false positives
    // Patterns are ordered from most specific to least specific
    let vpn_patterns = vec![
        // Specific VPN provider patterns (most reliable)
        (Regex::new(r"(?i)^(nordlynx|nordvpn|mullvad|proton|expressvpn|surfshark|cyberghost|tailscale|wintun)").unwrap(), ConnectionType::Vpn),
        (Regex::new(r"(?i)(private.*internet|pia\b)").unwrap(), ConnectionType::Vpn),
        // Protocol-specific patterns
        (Regex::new(r"(?i)^(openvpn|wireguard)").unwrap(), ConnectionType::Vpn),
        // TUN/TAP interface patterns (common VPN interfaces)
        (Regex::new(r"^tun\d+").unwrap(), ConnectionType::Vpn),
        (Regex::new(r"^tap\d+").unwrap(), ConnectionType::Vpn),
        (Regex::new(r"^wg\d+").unwrap(), ConnectionType::Vpn),
        (Regex::new(r"^utun\d+").unwrap(), ConnectionType::Vpn),
        // Tunnel interfaces (but be careful - some non-VPN tunnels exist)
        (Regex::new(r"(?i)^.*tunnel.*$").unwrap(), ConnectionType::Vpn),
        // PPP interfaces (often used by VPNs, but can be other things too)
        (Regex::new(r"^ppp\d+").unwrap(), ConnectionType::Vpn),
    ];

    // Exclude common non-VPN interfaces that might match patterns
    let exclude_patterns = vec![
        Regex::new(r"(?i)^(lo|loopback|eth|wlan|wifi|ethernet|local|bridge|docker|veth)").unwrap(),
        Regex::new(r"(?i)(bluetooth|pan|wwan)").unwrap(),
    ];

    for interface in interfaces {
        let name = interface.name.to_lowercase();
        let is_excluded = exclude_patterns.iter().any(|pattern| pattern.is_match(&name));
        if is_excluded {
            continue;
        }
        for (pattern, conn_type) in &vpn_patterns {
            if pattern.is_match(&name) {
                if !interface.addr.is_empty() {
                    return Some((interface.name, conn_type.clone()));
                }
            }
        }
        #[cfg(target_os = "windows")]
        {
            let lower_name = &name;
            if (lower_name.contains("tap") || lower_name.contains("tun") || lower_name.contains("wintun")) &&
               !lower_name.contains("ethernet") && !lower_name.contains("adapter") {
                if !interface.addr.is_empty() {
                    return Some((interface.name, ConnectionType::Vpn));
                }
            }
            if lower_name.contains("mullvad") || lower_name.contains("nordvpn") ||
               lower_name.contains("wireguard") || lower_name.contains("openvpn") ||
               lower_name.contains("proton") || lower_name.contains("expressvpn") {
                if !interface.addr.is_empty() {
                    return Some((interface.name, ConnectionType::Vpn));
                }
            }
        }
    }

    None
}

pub fn vpn_status() -> VpnStatus {
    let now = now_ms();
    if let Some((interface_name, connection_type)) = detect_vpn_interface() {
        VpnStatus {
            posture: VpnPostureState::Connected,
            interface_name: Some(interface_name.clone()),
            default_route_interface: Some(interface_name.clone()),
            dns_servers: vec![],
            signals: VpnSignals {
                adapter_match: true,
                default_route_match: true,
                dns_match: false,
                public_ip_match: None,
            },
            last_check_ms: now,
            connection_type,
            public_ip: None,
            detected: Some(true),
            interface_name_legacy: Some(interface_name),
        }
    } else {
        VpnStatus {
            posture: VpnPostureState::Disconnected,
            interface_name: None,
            default_route_interface: None,
            dns_servers: vec![],
            signals: VpnSignals {
                adapter_match: false,
                default_route_match: false,
                dns_match: false,
                public_ip_match: None,
            },
            last_check_ms: now,
            connection_type: ConnectionType::NonVpn,
            public_ip: None,
            detected: Some(false),
            interface_name_legacy: None,
        }
    }
}

pub fn net_posture(state: &OrcState) -> NetPosture {
    NetPosture {
        bind_interface: None,
        leak_proof_enabled: false,
        state: NetPostureState::Unconfigured,
        last_change_ms: now_ms(),
        vpn_status: vpn_status(),
        kill_switch: state.kill_switch.clone(),
    }
}

pub fn list_torrents(state: &OrcState) -> TorrentListResponse {
    TorrentListResponse {
        items: state
            .torrents
            .values()
            .map(|r| r.torrent.clone())
            .collect(),
    }
}

pub fn get_torrent(state: &OrcState, id: &str) -> Option<Torrent> {
    state.torrents.get(id).map(|r| r.torrent.clone())
}

pub fn get_status(state: &OrcState, id: &str) -> Option<TorrentStatus> {
    state.torrents.get(id).map(|r| torrent_status_from_record(r))
}

#[allow(dead_code)]
fn update_piece_availability_from_peers(rec: &mut TorrentRecord, peer_progress: f32, peer_id: &str) {
    let total_pieces = rec.runtime.total_pieces_estimate as usize;
    if total_pieces == 0 {
        return;
    }
    
    if rec.runtime.piece_availability.len() != total_pieces {
        rec.runtime.piece_availability.resize(total_pieces, 0);
    }
    if let Some(old_progress) = rec.runtime.peer_progress_cache.get(peer_id) {
        let old_pieces = (*old_progress * total_pieces as f32).ceil() as usize;
        for i in 0..old_pieces.min(total_pieces) {
            rec.runtime.piece_availability[i] = rec.runtime.piece_availability[i].saturating_sub(1);
        }
    }
    let pieces_peer_has = (peer_progress * total_pieces as f32).ceil() as usize;
    for i in 0..pieces_peer_has.min(total_pieces) {
        rec.runtime.piece_availability[i] = rec.runtime.piece_availability[i].saturating_add(1);
    }
    rec.runtime.peer_progress_cache.insert(peer_id.to_string(), peer_progress);
}

#[allow(dead_code)]
fn remove_peer_from_availability(rec: &mut TorrentRecord, peer_id: &str) {
    if let Some(progress) = rec.runtime.peer_progress_cache.remove(peer_id) {
        let total_pieces = rec.runtime.total_pieces_estimate as usize;
        if rec.runtime.piece_availability.len() == total_pieces {
            let pieces_peer_had = (progress * total_pieces as f32).ceil() as usize;
            for i in 0..pieces_peer_had.min(total_pieces) {
                rec.runtime.piece_availability[i] = rec.runtime.piece_availability[i].saturating_sub(1);
            }
        }
    }
}

pub fn get_row_snapshot(state: &OrcState, id: &str) -> Option<TorrentRowSnapshot> {
    let rec = state.torrents.get(id)?;
    let progress = if rec.runtime.total_bytes == 0 {
        0.0
    } else {
        (rec.runtime.downloaded_bytes as f64 / rec.runtime.total_bytes as f64)
            .clamp(0.0, 1.0)
    };

    const BINS: usize = 200;
    let total_pieces = rec.runtime.total_pieces_estimate.max(1) as usize;
    let pieces_per_bin = (total_pieces as f64 / BINS as f64).ceil() as usize;
    let completed_pieces = (progress * total_pieces as f64).floor() as usize;
    
    let mut pieces_bins = Vec::with_capacity(BINS);
    for bin_idx in 0..BINS {
        let start_piece = bin_idx * pieces_per_bin;
        let end_piece = ((bin_idx + 1) * pieces_per_bin).min(total_pieces);
        
        if start_piece >= total_pieces {
            pieces_bins.push(PieceBin {
                have_ratio: 0.0,
                min_avail: 0,
                pieces_in_bin: 0,
            });
            continue;
        }
        
        let pieces_in_bin = end_piece - start_piece;
        let have_count = completed_pieces.saturating_sub(start_piece).min(pieces_in_bin);
        let have_ratio = if pieces_in_bin > 0 {
            have_count as f64 / pieces_in_bin as f64
        } else {
            0.0
        };
        let min_avail = if have_ratio >= 1.0 {
            u32::MAX
        } else {
            let mut min_avail_in_bin = u32::MAX;
            for piece_idx in start_piece..end_piece {
                if piece_idx < rec.runtime.piece_availability.len() {
                    let avail = rec.runtime.piece_availability[piece_idx];
                    if piece_idx >= completed_pieces {
                        min_avail_in_bin = min_avail_in_bin.min(avail);
                    }
                }
            }
            if min_avail_in_bin == u32::MAX {
                0
            } else {
                min_avail_in_bin
            }
        };
        
        pieces_bins.push(PieceBin {
            have_ratio,
            min_avail,
            pieces_in_bin: pieces_in_bin as u32,
        });
    }
    let heartbeat_samples = rec.runtime.heartbeat_samples.clone();

    Some(TorrentRowSnapshot {
        progress,
        state: rec.runtime.state.clone(),
        pieces_bins,
        heartbeat_samples,
    })
}

pub fn get_content(state: &OrcState, id: &str) -> Option<TorrentContent> {
    state.torrents.get(id).map(|r| TorrentContent {
        files: r.runtime.files.clone(),
    })
}

pub fn rqbit_api(state: &OrcState) -> RqbitApi {
    state.rqbit.clone()
}

pub fn rqbit_id_for(state: &OrcState, id: &str) -> Option<usize> {
    state.torrents.get(id).map(|r| r.runtime.rqbit_id)
}

pub fn find_torrent_by_info_hash(state: &OrcState, info_hash: &str) -> Option<(String, bool, bool)> {
    state.torrents.iter()
        .find(|(_, rec)| rec.torrent.info_hash_hex
            .as_ref()
            .map(|h| h.eq_ignore_ascii_case(info_hash))
            .unwrap_or(false))
        .map(|(id, rec)| {
            let is_complete = rec.runtime.downloaded_bytes >= rec.runtime.total_bytes && rec.runtime.total_bytes > 0;
            (id.clone(), is_complete, rec.runtime.running)
        })
}

pub fn only_files_for(state: &OrcState, id: &str) -> Option<HashSet<usize>> {
    let rec = state.torrents.get(id)?;
    let mut set = HashSet::new();
    for (idx, f) in rec.runtime.files.iter().enumerate() {
        if f.priority != "skip" {
            set.insert(idx);
        }
    }
    Some(set)
}

fn torrent_status_from_record(r: &TorrentRecord) -> TorrentStatus {
    let progress = if r.runtime.total_bytes == 0 {
        0.0
    } else {
        (r.runtime.downloaded_bytes as f64 / r.runtime.total_bytes as f64)
            .clamp(0.0, 1.0)
    };

    let remaining = r.runtime.total_bytes.saturating_sub(r.runtime.downloaded_bytes);
    let eta_sec = if r.runtime.down_rate_bps > 0 {
        (remaining / r.runtime.down_rate_bps).min(u64::MAX)
    } else {
        0
    };

    TorrentStatus {
        id: r.torrent.id.clone(),
        state: r.runtime.state.clone(),
        progress,
        down_rate_bps: r.runtime.down_rate_bps,
        up_rate_bps: r.runtime.up_rate_bps,
        eta_sec,
        total_bytes: r.runtime.total_bytes,
        downloaded_bytes: r.runtime.downloaded_bytes,
        peers_seen: r.runtime.peers_seen,
        error: r.runtime.last_error.clone(),
    }
}

#[derive(Debug, Clone)]
pub enum AddTorrentInput {
    Url(String),
    TorrentBytes(Vec<u8>),
}

pub fn extract_info_hash_from_magnet(magnet: &str) -> Option<String> {
    if !magnet.starts_with("magnet:?") {
        return None;
    }
    const MAX_MAGNET_LENGTH: usize = 8192;
    if magnet.len() > MAX_MAGNET_LENGTH {
        return None;
    }
    if let Some(xt_start) = magnet.find("xt=urn:btih:") {
        let hash_start = xt_start + 12; // "xt=urn:btih:".len()
        let hash_end = magnet[hash_start..]
            .find('&')
            .map(|i| hash_start + i)
            .unwrap_or(magnet.len());
        
        let hash = &magnet[hash_start..hash_end];
        if hash.len() == 40 && hash.chars().all(|c| c.is_ascii_hexdigit()) {
            return Some(hash.to_lowercase());
        }
    }
    
    None
}

pub fn extract_info_hash_from_torrent_bytes(bytes: &[u8]) -> Result<Option<String>> {
    let info_marker = b"4:info";
    let mut info_start = None;
    
    for i in 0..=bytes.len().saturating_sub(info_marker.len()) {
        if bytes[i..i + info_marker.len()] == *info_marker {
            info_start = Some(i + info_marker.len());
            break;
        }
    }
    
    let info_start = match info_start {
        Some(pos) => pos,
        None => return Ok(None),
    };
    if info_start >= bytes.len() || bytes[info_start] != b'd' {
        return Ok(None);
    }
    
    let dict_start = info_start;
    let mut depth = 0;
    let mut in_string = false;
    let mut string_len = 0;
    let mut string_pos = 0;
    let mut dict_end = None;
    
    for i in dict_start..bytes.len() {
        if in_string {
            string_pos += 1;
            if string_pos >= string_len {
                in_string = false;
                string_pos = 0;
                string_len = 0;
            }
            continue;
        }
        
        let b = bytes[i];
        if b.is_ascii_digit() {
            let mut len_str = String::new();
            let mut j = i;
            while j < bytes.len() && bytes[j].is_ascii_digit() {
                len_str.push(bytes[j] as char);
                j += 1;
            }
            if j < bytes.len() && bytes[j] == b':' {
                if let Ok(len) = len_str.parse::<usize>() {
                    string_len = len;
                    string_pos = 0;
                    in_string = true;
                    continue;
                }
            }
        }
        if b == b'd' {
            depth += 1;
        } else if b == b'l' {
            depth += 1;
        } else if b == b'e' {
            depth -= 1;
            if depth == 0 {
                dict_end = Some(i + 1);
                break;
            }
        }
    }
    
    let dict_end = match dict_end {
        Some(pos) => pos,
        None => return Ok(None),
    };
    let info_dict_bytes = &bytes[dict_start..dict_end];
    let mut hasher = Sha1::new();
    hasher.update(info_dict_bytes);
    let hash = hasher.finalize();
    
    Ok(Some(hex::encode(hash)))
}

pub fn prepare_add_input(req: &AddTorrentRequest) -> Result<AddTorrentInput> {
    if let Some(b64) = req.torrent_b64.as_deref() {
        const MAX_BASE64_SIZE: usize = 13 * 1024 * 1024;
        if b64.len() > MAX_BASE64_SIZE {
            return Err(anyhow!("Torrent file too large (max 10MB)"));
        }
        
        let bytes = general_purpose::STANDARD.decode(b64).context("Invalid base64 torrent")?;
        const MAX_DECODED_SIZE: usize = 10 * 1024 * 1024;
        if bytes.len() > MAX_DECODED_SIZE {
            return Err(anyhow!("Decoded torrent file too large (max 10MB)"));
        }
        
        return Ok(AddTorrentInput::TorrentBytes(bytes));
    }
    if let Some(m) = req.magnet.as_deref() {
        const MAX_MAGNET_LENGTH: usize = 8192;
        if m.len() > MAX_MAGNET_LENGTH {
            return Err(anyhow!("Magnet link too long"));
        }
        if !m.starts_with("magnet:?") {
            return Err(anyhow!("Invalid magnet link format"));
        }
        
        return Ok(AddTorrentInput::Url(m.to_string()));
    }
    Err(anyhow!("Missing magnet or torrent_b64"))
}

pub fn integrate_added_torrent(
    state: &mut OrcState,
    req: &AddTorrentRequest,
    rqbit_resp: ApiAddTorrentResponse,
) -> Result<AddTorrentResponse> {
    if state.torrents.len() >= MAX_TORRENTS {
        return Err(anyhow!("Maximum number of torrents ({}) reached", MAX_TORRENTS));
    }
    let rqbit_id = rqbit_resp
        .id
        .ok_or_else(|| anyhow!("rqbit did not return a torrent id"))?;

    let details = rqbit_resp.details;

    let id = Uuid::new_v4().to_string();
    let added_at_ms = now_ms();

    let name = req
        .name_hint
        .clone()
        .filter(|s| !s.trim().is_empty())
        .or_else(|| {
            details.name.clone().filter(|n| !n.trim().is_empty())
        })
        .unwrap_or_else(|| format!("torrent-{}", details.info_hash.chars().take(8).collect::<String>()));

    let files = details
        .files
        .unwrap_or_default()
        .into_iter()
        .map(|f| TorrentFileEntry {
            path: split_path_components(&f.name),
            size: f.length,
            priority: "normal".to_string(),
            downloaded: false,
        })
        .collect::<Vec<_>>();

    let torrent = Torrent {
        id: id.clone(),
        name: name.clone(),
        added_at_ms,
        running: true,
        profile: TorrentProfile {
            mode: TorrentMode::Standard,
            hops: 0,
        },
        info_hash_hex: Some(details.info_hash.clone()),
        save_path: Some(details.output_folder.clone()),
    };

    let now = Instant::now();
    let mut trackers = Vec::new();
    if let Some(m) = &req.magnet {
        trackers.extend(parse_trackers_from_magnet(m));
    }
    if let Some(b64) = &req.torrent_b64 {
        if let Ok(bytes) = general_purpose::STANDARD.decode(b64) {
            trackers.extend(parse_trackers_from_torrent_bytes(&bytes));
        }
    }
    trackers = dedup_preserve(trackers);

    let tracker_state = trackers
        .iter()
        .map(|u| (u.clone(), TrackerRuntimeState::default()))
        .collect::<HashMap<_, _>>();

    let total_bytes = files.iter().map(|f| f.size).sum();
    const VERY_LARGE_TORRENT_THRESHOLD: u64 = 4 * 1024 * 1024 * 1024;
    const LARGE_TORRENT_THRESHOLD: u64 = 500 * 1024 * 1024;
    const MEDIUM_TORRENT_THRESHOLD: u64 = 50 * 1024 * 1024;
    const VERY_LARGE_PIECE_SIZE: u64 = 4 * 1024 * 1024;
    const LARGE_PIECE_SIZE: u64 = 2 * 1024 * 1024;
    const MEDIUM_PIECE_SIZE: u64 = 512 * 1024;
    const DEFAULT_PIECE_SIZE: u64 = 256 * 1024;
    
    let piece_size = if total_bytes > VERY_LARGE_TORRENT_THRESHOLD {
        VERY_LARGE_PIECE_SIZE
    } else if total_bytes > LARGE_TORRENT_THRESHOLD {
        LARGE_PIECE_SIZE
    } else if total_bytes > MEDIUM_TORRENT_THRESHOLD {
        MEDIUM_PIECE_SIZE
    } else {
        DEFAULT_PIECE_SIZE
    };
    let total_pieces_estimate = if piece_size > 0 {
        let pieces: u64 = total_bytes / piece_size;
        (pieces.max(1u64)).min(u32::MAX as u64) as u32
    } else {
        100
    };
    
    let runtime = TorrentRuntime {
        rqbit_id,
        total_bytes,
        downloaded_bytes: 0,
        uploaded_bytes: 0,
        running: true,
        state: TorrentState::Checking,
        down_rate_bps: 0,
        up_rate_bps: 0,
        peers_seen: 0,
        files,
        last_error: None,
        trackers,
        tracker_state,
        peer_samples: HashMap::new(),
        state_override: None,
        last_sample: now,
        last_downloaded_bytes: 0,
        last_uploaded_bytes: 0,
        heartbeat_samples: Vec::new(),
        heartbeat_last_sample: now,
        heartbeat_last_bytes: 0,
        total_pieces_estimate,
        piece_availability: vec![0; total_pieces_estimate as usize],
        peer_progress_cache: HashMap::new(),
    };

    state.torrents.insert(
        id.clone(),
        TorrentRecord {
            torrent,
            runtime,
        },
    );

    info!("Added torrent id={} name=\"{}\" rqbit_id={}", id, name, rqbit_id);
    Ok(AddTorrentResponse { id })
}

pub fn set_running(state: &mut OrcState, id: &str, running: bool) -> Result<()> {
    let rec = state.torrents.get_mut(id).ok_or_else(|| anyhow!("Not found"))?;
    rec.torrent.running = running;
    rec.runtime.running = running;
    rec.runtime.state = if running {
        if rec.runtime.downloaded_bytes >= rec.runtime.total_bytes {
            TorrentState::Seeding
        } else {
            TorrentState::Downloading
        }
    } else {
        rec.runtime.down_rate_bps = 0;
        rec.runtime.up_rate_bps = 0;
        TorrentState::Stopped
    };
    Ok(())
}

pub fn remove_torrent(state: &mut OrcState, id: &str) -> Result<()> {
    state.torrents.remove(id).ok_or_else(|| anyhow!("Not found"))?;
    Ok(())
}

pub fn set_profile(state: &mut OrcState, id: &str, profile: TorrentProfile) -> Result<Torrent> {
    let rec = state.torrents.get_mut(id).ok_or_else(|| anyhow!("Not found"))?;
    rec.torrent.profile = profile;
    Ok(rec.torrent.clone())
}

pub fn set_file_priority(state: &mut OrcState, id: &str, req: PatchFilePriorityRequest) -> Result<()> {
    let rec = state.torrents.get_mut(id).ok_or_else(|| anyhow!("Not found"))?;
    if rec.runtime.files.is_empty() {
        return Ok(());
    }

    for p in req.paths {
        for f in rec.runtime.files.iter_mut() {
            if f.path == p {
                f.priority = req.priority.clone();
            }
        }
    }
    Ok(())
}

pub fn patch_kill_switch(state: &mut OrcState, req: PatchKillSwitchRequest) -> KillSwitchConfig {
    if let Some(enabled) = req.enabled {
        state.kill_switch.enabled = enabled;
        state.kill_switch.enforcement_state = if enabled {
            KillSwitchState::Armed
        } else {
            KillSwitchState::Disarmed
        };
        state.kill_switch.last_enforcement_ms = Some(now_ms());
    }
    if let Some(scope) = req.scope {
        state.kill_switch.scope = scope;
    }
    if let Some(gp) = req.grace_period_sec {
        state.kill_switch.grace_period_sec = gp;
    }
    if let Some(tr) = req.triggers {
        state.kill_switch.triggers = tr;
    }
    state.kill_switch.clone()
}

pub fn get_policy(state: &OrcState) -> PolicyState {
    state.policy.clone()
}

pub fn get_kill_switch(state: &OrcState) -> KillSwitchConfig {
    state.kill_switch.clone()
}

#[derive(Debug, Clone, Deserialize)]
pub struct PatchPolicyRequest {
    #[serde(rename = "desired_patch")]
    pub desired_patch: DesiredPolicy,
}

pub fn patch_policy(state: &mut OrcState, desired: DesiredPolicy) -> PolicyState {
    let mut warnings = Vec::new();
    let network_allowed = if state.kill_switch.enabled {
        let vpn_connected = is_vpn_connected();
        vpn_connected
    } else {
        true
    };
    if desired.anonymous_mode && desired.upnp_natpmp_enabled {
        warnings.push(PolicyWarning {
            code: "anon_upnp".to_string(),
            message: "Anonymous mode is enabled while UPnP/NAT-PMP is enabled. Consider disabling port mapping.".to_string(),
            severity: PolicyWarningSeverity::Warn,
        });
    }

    let effective = EffectivePolicy {
        anonymous_mode: desired.anonymous_mode,
        peer_encryption: desired.peer_encryption.clone(),
        dht_hardening: desired.dht_hardening,
        enforce_private_torrents: desired.enforce_private_torrents,
        ip_blocklist: desired.ip_blocklist,
        kill_switch: desired.kill_switch,
        bind_interface_only: desired.bind_interface_only,
        overlay_padding: desired.overlay_padding.clone(),
        sybil_resistance: desired.sybil_resistance,
        relay_pow_required: desired.relay_pow_required,
        relay_subnet_diversity: desired.relay_subnet_diversity,
        relay_reputation_weighting: desired.relay_reputation_weighting,
        ipv6_enabled: desired.ipv6_enabled,
        upnp_natpmp_enabled: desired.upnp_natpmp_enabled,
        circuit_rotation_enabled: desired.circuit_rotation_enabled,
        deny_direct_exits: desired.deny_direct_exits,
        minimize_fingerprinting: desired.minimize_fingerprinting,
        profile: desired.profile.clone(),
        network_allowed,
        discovery_allowed: !desired.enforce_private_torrents,
        direct_peer_allowed: !desired.anonymous_mode,
    };

    state.policy.desired = desired;
    state.policy.effective = effective;
    state.policy.warnings = warnings;
    state.policy.version += 1;
    state.policy.last_updated_ms = now_ms();

    state.policy.clone()
}

fn is_vpn_connected() -> bool {
    let vpn = vpn_status();
    matches!(vpn.posture, VpnPostureState::Connected) &&
        matches!(vpn.connection_type, ConnectionType::Vpn) &&
        vpn.detected != Some(false)
}

pub fn tick(state: &mut OrcState) {
    let now = Instant::now();
    const HEARTBEAT_SAMPLE_INTERVAL_MS: u64 = 200;
    const HEARTBEAT_MAX_SAMPLES: usize = 120;
    for rec in state.torrents.values_mut() {
        let elapsed_ms = rec.runtime.heartbeat_last_sample.elapsed().as_millis() as u64;
        if elapsed_ms >= HEARTBEAT_SAMPLE_INTERVAL_MS {
            if rec.runtime.running {
                let bytes_delta = rec.runtime.downloaded_bytes.saturating_sub(rec.runtime.heartbeat_last_bytes);
                let elapsed_sec = elapsed_ms as f64 / 1000.0;
                let bytes_per_sec = if elapsed_sec > 0.0 {
                    (bytes_delta as f64 / elapsed_sec) as u64
                } else {
                    0
                };
                rec.runtime.heartbeat_samples.push(bytes_per_sec);
                if rec.runtime.heartbeat_samples.len() > HEARTBEAT_MAX_SAMPLES {
                    rec.runtime.heartbeat_samples.remove(0);
                }
                
                rec.runtime.heartbeat_last_sample = now;
                rec.runtime.heartbeat_last_bytes = rec.runtime.downloaded_bytes;
            } else {
                rec.runtime.heartbeat_samples.push(0);
                if rec.runtime.heartbeat_samples.len() > HEARTBEAT_MAX_SAMPLES {
                    rec.runtime.heartbeat_samples.remove(0);
                }
                rec.runtime.heartbeat_last_sample = now;
            }
        }
    }
    if state.kill_switch.enabled {
        let vpn_connected = is_vpn_connected();
        let current_state = &state.kill_switch.enforcement_state;
        
        match current_state {
            KillSwitchState::Armed => {
                if !vpn_connected {
                    state.kill_switch.enforcement_state = KillSwitchState::Engaged;
                    state.kill_switch.last_enforcement_ms = Some(now_ms());
                    info!("Kill switch engaged: VPN disconnected");
                    for rec in state.torrents.values_mut() {
                        if rec.runtime.running {
                            rec.runtime.running = false;
                            rec.torrent.running = false;
                            rec.runtime.state = TorrentState::Stopped;
                            rec.runtime.down_rate_bps = 0;
                            rec.runtime.up_rate_bps = 0;
                        }
                    }
                }
            }
            KillSwitchState::Engaged => {
                if vpn_connected {
                    state.kill_switch.enforcement_state = KillSwitchState::Armed;
                    state.kill_switch.last_enforcement_ms = Some(now_ms());
                    info!("Kill switch released: VPN reconnected");
                }
            }
            KillSwitchState::Releasing => {
                if vpn_connected {
                    state.kill_switch.enforcement_state = KillSwitchState::Armed;
                    state.kill_switch.last_enforcement_ms = Some(now_ms());
                }
            }
            KillSwitchState::Disarmed => {
                if vpn_connected {
                    state.kill_switch.enforcement_state = KillSwitchState::Armed;
                    state.kill_switch.last_enforcement_ms = Some(now_ms());
                }
            }
        }
        let network_allowed = vpn_connected;
        if state.policy.effective.network_allowed != network_allowed {
            state.policy.effective.network_allowed = network_allowed;
            state.policy.version += 1;
            state.policy.last_updated_ms = now_ms();
        }
    } else {
        if !state.policy.effective.network_allowed {
            state.policy.effective.network_allowed = true;
            state.policy.version += 1;
            state.policy.last_updated_ms = now_ms();
        }
    }

    for rec in state.torrents.values_mut() {
        let tid = TorrentIdOrHash::Id(rec.runtime.rqbit_id);

        let stats = match state.rqbit.api_stats_v1(tid) {
            Ok(s) => s,
            Err(e) => {
                rec.runtime.last_error = Some(e.to_string());
                rec.runtime.state = TorrentState::Error;
                rec.runtime.running = false;
                rec.runtime.down_rate_bps = 0;
                rec.runtime.up_rate_bps = 0;
                continue;
            }
        };
        let v = match serde_json::to_value(&stats) {
            Ok(v) => v,
            Err(e) => {
                tracing::debug!("Failed to serialize stats for torrent {}: {}", rec.runtime.rqbit_id, e);
                continue;
            }
        };

        let total_bytes = v.get("total_bytes").and_then(|x| x.as_u64()).unwrap_or(0);
        let progress_bytes = v
            .get("progress_bytes")
            .and_then(|x| x.as_u64())
            .or_else(|| v.get("downloaded_bytes").and_then(|x| x.as_u64()))
            .unwrap_or(0);
        let uploaded_bytes = v.get("uploaded_bytes").and_then(|x| x.as_u64()).unwrap_or(0);
        let finished = v.get("finished").and_then(|x| x.as_bool()).unwrap_or(false);
        let state_str = v.get("state").and_then(|x| x.as_str()).unwrap_or("error");
        let err = v.get("error").and_then(|x| x.as_str()).map(|s| s.to_string());
        let dt = now
            .duration_since(rec.runtime.last_sample)
            .as_secs_f64()
            .max(0.001);
        let down_delta = progress_bytes.saturating_sub(rec.runtime.last_downloaded_bytes);
        let up_delta = uploaded_bytes.saturating_sub(rec.runtime.last_uploaded_bytes);
        rec.runtime.down_rate_bps = (down_delta as f64 / dt) as u64;
        rec.runtime.up_rate_bps = (up_delta as f64 / dt) as u64;
        rec.runtime.last_sample = now;
        rec.runtime.last_downloaded_bytes = progress_bytes;
        rec.runtime.last_uploaded_bytes = uploaded_bytes;

        rec.runtime.total_bytes = total_bytes;
        rec.runtime.downloaded_bytes = progress_bytes;
        rec.runtime.uploaded_bytes = uploaded_bytes;
        rec.runtime.last_error = err;

        rec.runtime.state = match state_str {
            "paused" => TorrentState::Stopped,
            "initializing" => TorrentState::Checking,
            "error" => TorrentState::Error,
            "live" => {
                if finished {
                    TorrentState::Seeding
                } else {
                    TorrentState::Downloading
                }
            }
            _ => {
                if finished {
                    TorrentState::Seeding
                } else {
                    TorrentState::Downloading
                }
            }
        };
        if let Some(ov) = &rec.runtime.state_override {
            if now < ov.until {
                rec.runtime.state = ov.state.clone();
            } else {
                rec.runtime.state_override = None;
            }
        }

        rec.runtime.running = !matches!(rec.runtime.state, TorrentState::Stopped | TorrentState::Error);
        rec.torrent.running = rec.runtime.running;
        if let Some(arr) = v.get("file_progress").and_then(|x| x.as_array()) {
            for (i, fp) in arr.iter().enumerate() {
                if let Some(f) = rec.runtime.files.get_mut(i) {
                    let p = fp.as_u64().unwrap_or(0);
                    f.downloaded = p >= f.size && f.priority != "skip";
                }
            }
        } else if finished {
            for f in rec.runtime.files.iter_mut() {
                if f.priority != "skip" {
                    f.downloaded = true;
                }
            }
        }
    }
}

#[allow(dead_code)]
fn sanitize_fs_name(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for ch in s.chars() {
        match ch {
            '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|' => out.push('_'),
            c if c.is_control() => out.push('_'),
            c => out.push(c),
        }
    }
    out.trim().to_string()
}

fn split_path_components(name: &str) -> Vec<String> {
    const MAX_PATH_DEPTH: usize = 100;
    let parts = name
        .split(|c| c == '/' || c == '\\')
        .filter(|p| !p.is_empty())
        .filter(|p| *p != "." && *p != "..")
        .map(|p| sanitize_path_component(p))
        .filter(|p| !p.is_empty())
        .take(MAX_PATH_DEPTH)
        .collect::<Vec<_>>();
    
    if parts.is_empty() {
        vec!["file".to_string()]
    } else {
        parts
    }
}

fn sanitize_path_component(component: &str) -> String {
    component
        .chars()
        .filter(|c| {
            c.is_alphanumeric() ||
            matches!(c, ' ' | '.' | '-' | '_' | '(' | ')' | '[' | ']' | '&' | '#' | '@' | '!' | '%' | '+' | '=')
        })
        .take(255)
        .collect::<String>()
        .trim()
        .to_string()
}

#[derive(Debug, Clone)]
#[allow(dead_code)]
struct TorrentMeta {
    name: Option<String>,
    total_bytes: u64,
    files: Vec<TorrentFileEntry>,
}

#[derive(Debug, Clone)]
enum BVal {
    #[allow(dead_code)]
    Int(i64),
    Bytes(Vec<u8>),
    List(Vec<BVal>),
    Dict(Vec<(Vec<u8>, BVal)>),
}

#[allow(dead_code)]
fn parse_torrent_metainfo(bytes: &[u8]) -> Result<TorrentMeta> {
    let (v, consumed) = parse_bencode(bytes, 0).context("bencode parse")?;
    if consumed == 0 {
        return Err(anyhow!("Empty torrent"));
    }

    let root = match v {
        BVal::Dict(d) => d,
        _ => return Err(anyhow!("torrent root is not a dict")),
    };

    let info = get_dict_value(&root, b"info")
        .and_then(|v| match v { BVal::Dict(d) => Some(d), _ => None })
        .ok_or_else(|| anyhow!("missing info dict"))?;

    let name = get_bytes(&info, b"name.utf-8")
        .or_else(|| get_bytes(&info, b"name"))
        .map(|b| String::from_utf8_lossy(&b).to_string());
    let mut files_out = Vec::new();
    let mut total: u64 = 0;

    if let Some(len) = get_int(&info, b"length") {
        let size = len.max(0) as u64;
        total = size;
        files_out.push(TorrentFileEntry {
            path: vec![name.clone().unwrap_or_else(|| "file".to_string())],
            size,
            priority: "normal".to_string(),
            downloaded: false,
        });
    } else if let Some(BVal::List(files)) = get_dict_value(&info, b"files") {
        for f in files {
            if let BVal::Dict(fd) = f {
                let len = get_int(&fd, b"length").unwrap_or(0).max(0) as u64;
                let path_list = get_dict_value(&fd, b"path.utf-8")
                    .or_else(|| get_dict_value(&fd, b"path"));

                let mut path = Vec::new();
                if let Some(BVal::List(parts)) = path_list {
                    for p in parts {
                        if let BVal::Bytes(b) = p {
                            path.push(String::from_utf8_lossy(&b).to_string());
                        }
                    }
                }
                if path.is_empty() {
                    path.push("file".to_string());
                }

                total = total.saturating_add(len);
                files_out.push(TorrentFileEntry {
                    path,
                    size: len,
                    priority: "normal".to_string(),
                    downloaded: false,
                });
            }
        }
    }

    Ok(TorrentMeta {
        name,
        total_bytes: total,
        files: files_out,
    })
}

fn get_dict_value<'a>(dict: &'a [(Vec<u8>, BVal)], key: &[u8]) -> Option<&'a BVal> {
    dict.iter().find(|(k, _)| k.as_slice() == key).map(|(_, v)| v)
}

#[allow(dead_code)]
fn get_int(dict: &[(Vec<u8>, BVal)], key: &[u8]) -> Option<i64> {
    get_dict_value(dict, key).and_then(|v| match v { BVal::Int(i) => Some(*i), _ => None })
}

#[allow(dead_code)]
fn get_bytes(dict: &[(Vec<u8>, BVal)], key: &[u8]) -> Option<Vec<u8>> {
    get_dict_value(dict, key).and_then(|v| match v { BVal::Bytes(b) => Some(b.clone()), _ => None })
}

const MAX_BENCODE_DEPTH: usize = 100;
const MAX_BENCODE_SIZE: usize = 100 * 1024 * 1024;

fn parse_bencode(input: &[u8], i: usize) -> Result<(BVal, usize)> {
    parse_bencode_with_depth(input, i, 0)
}

fn parse_bencode_with_depth(input: &[u8], mut i: usize, depth: usize) -> Result<(BVal, usize)> {
    if depth > MAX_BENCODE_DEPTH {
        return Err(anyhow!("bencode nesting too deep (max {})", MAX_BENCODE_DEPTH));
    }
    if input.len() > MAX_BENCODE_SIZE {
        return Err(anyhow!("bencode input too large (max {} bytes)", MAX_BENCODE_SIZE));
    }
    
    if i >= input.len() {
        return Err(anyhow!("eof"));
    }
    match input[i] {
        b'i' => {
            i += 1;
            let start = i;
            let max_int_len = 20;
            let mut int_len = 0;
            while i < input.len() && input[i] != b'e' && int_len < max_int_len {
                i += 1;
                int_len += 1;
            }
            if i >= input.len() {
                return Err(anyhow!("unterminated int"));
            }
            if int_len >= max_int_len && input[i] != b'e' {
                return Err(anyhow!("integer too long"));
            }
            let n = std::str::from_utf8(&input[start..i])?.parse::<i64>()?;
            i += 1;
            Ok((BVal::Int(n), i))
        }
        b'l' => {
            i += 1;
            let mut items = Vec::new();
            const MAX_LIST_ITEMS: usize = 100000;
            while i < input.len() && input[i] != b'e' {
                if items.len() >= MAX_LIST_ITEMS {
                    return Err(anyhow!("list too large (max {} items)", MAX_LIST_ITEMS));
                }
                let (v, ni) = parse_bencode_with_depth(input, i, depth + 1)?;
                i = ni;
                items.push(v);
            }
            if i >= input.len() {
                return Err(anyhow!("unterminated list"));
            }
            i += 1;
            Ok((BVal::List(items), i))
        }
        b'd' => {
            i += 1;
            let mut items = Vec::new();
            const MAX_DICT_ITEMS: usize = 100000;
            while i < input.len() && input[i] != b'e' {
                if items.len() >= MAX_DICT_ITEMS {
                    return Err(anyhow!("dict too large (max {} items)", MAX_DICT_ITEMS));
                }
                let (k, ni) = parse_bencode_with_depth(input, i, depth + 1)?;
                i = ni;
                let key = match k {
                    BVal::Bytes(b) => b,
                    _ => return Err(anyhow!("dict key is not bytes")),
                };
                let (v, ni2) = parse_bencode_with_depth(input, i, depth + 1)?;
                i = ni2;
                items.push((key, v));
            }
            if i >= input.len() {
                return Err(anyhow!("unterminated dict"));
            }
            i += 1;
            Ok((BVal::Dict(items), i))
        }
        b'0'..=b'9' => {
            let start = i;
            let max_len_str = 10;
            let mut len_str_len = 0;
            while i < input.len() && input[i] != b':' && len_str_len < max_len_str {
                i += 1;
                len_str_len += 1;
            }
            if i >= input.len() {
                return Err(anyhow!("invalid bytes length"));
            }
            if len_str_len >= max_len_str && input[i] != b':' {
                return Err(anyhow!("bytes length string too long"));
            }
            let len = std::str::from_utf8(&input[start..i])?.parse::<usize>()?;
            const MAX_BYTE_STRING_SIZE: usize = 10 * 1024 * 1024;
            if len > MAX_BYTE_STRING_SIZE {
                return Err(anyhow!("byte string too large (max {} bytes)", MAX_BYTE_STRING_SIZE));
            }
            i += 1;
            let end = i + len;
            if end > input.len() {
                return Err(anyhow!("bytes out of range"));
            }
            let b = input[i..end].to_vec();
            Ok((BVal::Bytes(b), end))
        }
        _ => Err(anyhow!("invalid bencode prefix")),
    }
}


pub fn force_checking(state: &mut OrcState, id: &str) -> Result<()> {
    let rec = state
        .torrents
        .get_mut(id)
        .ok_or_else(|| anyhow!("torrent not found"))?;
    rec.runtime.state_override = Some(StateOverride {
        until: Instant::now() + Duration::from_secs(4),
        state: TorrentState::Checking,
    });
    Ok(())
}

pub fn mark_announce(state: &mut OrcState, id: &str) -> Result<()> {
    let rec = state
        .torrents
        .get_mut(id)
        .ok_or_else(|| anyhow!("torrent not found"))?;

    let now = now_ms();
    for t in rec.runtime.trackers.iter() {
        let st = rec.runtime.tracker_state.entry(t.clone()).or_default();
        st.last_announce_ms = Some(now);
        st.next_announce_ms = Some(now + 30 * 60 * 1000);
        st.announce_count = st.announce_count.saturating_add(1);
    }
    Ok(())
}

pub fn peers_for(state: &mut OrcState, id: &str) -> Result<PeersResponse> {
    let rec = state
        .torrents
        .get_mut(id)
        .ok_or_else(|| anyhow!("torrent not found"))?;

    let tid = TorrentIdOrHash::Id(rec.runtime.rqbit_id);

    use librqbit::api::PeerStatsFilter;
    let snapshot = match state.rqbit.api_peer_stats(tid, PeerStatsFilter::default()) {
        Ok(s) => s,
        Err(e) => {
            rec.runtime.last_error = Some(e.to_string());
            return Ok(PeersResponse { peers: vec![] });
        }
    };

    let v = serde_json::to_value(&snapshot).unwrap_or(serde_json::Value::Null);
    let entries = peer_entries_from_snapshot(&v);

    let now_i = Instant::now();
    let now_ms_epoch = now_ms();

    let mut seen = HashSet::new();
    let mut out = Vec::new();

    for (addr, pv) in entries {
        let (ip, port) = split_addr(&addr);

        let downloaded = pick_u64(&pv, &["downloaded", "downloaded_bytes", "total_downloaded", "dl_bytes"])
            .unwrap_or(0);
        let uploaded = pick_u64(&pv, &["uploaded", "uploaded_bytes", "total_uploaded", "ul_bytes"])
            .unwrap_or(0);

        let client = pick_str(&pv, &["client", "client_name", "user_agent", "client_id"]);

        let flags = pick_str(&pv, &["flags"])
            .unwrap_or_else(|| synth_peer_flags(&pv));

        // Rate sampling.
        let key = addr.clone();
        seen.insert(key.clone());

        let (down_rate, up_rate, last_seen_ms) = match rec.runtime.peer_samples.get(&key) {
            Some(prev) => {
                let dt = now_i.duration_since(prev.at).as_secs_f64().max(0.25);
                let dd = downloaded.saturating_sub(prev.downloaded) as f64;
                let du = uploaded.saturating_sub(prev.uploaded) as f64;
                (
                    (dd / dt) as i64,
                    (du / dt) as i64,
                    now_ms_epoch,
                )
            }
            None => (0, 0, now_ms_epoch),
        };

        rec.runtime.peer_samples.insert(
            key,
            PeerSample {
                downloaded,
                uploaded,
                last_seen_ms,
                at: now_i,
            },
        );

        // Lookup country code using GeoIP database (if available)
        let country = pick_str(&pv, &["country", "country_code"])
            .or_else(|| {
                // If peer data doesn't include country, lookup using GeoIP
                state.geoip_reader.as_ref()
                    .and_then(|reader| lookup_country(reader, &ip))
            });

        out.push(PeerRow {
            id: addr.clone(),
            ip,
            port,
            down_rate,
            up_rate,
            downloaded,
            uploaded,
            client,
            flags: Some(flags),
            progress: pick_f32(&pv, &["progress", "peer_progress"]),
            snubbed: pick_bool(&pv, &["snubbed", "is_snubbed"]).unwrap_or(false),
            choked: pick_bool(&pv, &["choked", "is_choked"]).unwrap_or(false),
            interested: pick_bool(&pv, &["interested", "is_interested"]),
            optimistic: pick_bool(&pv, &["optimistic"]).or_else(|| pick_bool(&pv, &["optimistic_unchoke"])),
            incoming: pick_bool(&pv, &["incoming", "is_incoming"]),
            encrypted: pick_bool(&pv, &["encrypted", "is_encrypted"]),
            rtt_ms: pick_u64(&pv, &["rtt_ms", "rtt", "ping_ms"]).map(|x| x.min(u32::MAX as u64) as u32),
            country,
            last_seen_ms,
        });
    }

    // Update piece availability from peer progress
    for peer in &out {
        if let Some(progress) = peer.progress {
            update_piece_availability_from_peers(rec, progress, &peer.id);
        }
    }
    
    // Remove disconnected peers from availability
    let current_peer_ids: HashSet<String> = out.iter().map(|p| p.id.clone()).collect();
    let cached_peer_ids: Vec<String> = rec.runtime.peer_progress_cache.keys().cloned().collect();
    for peer_id in cached_peer_ids {
        if !current_peer_ids.contains(&peer_id) {
            remove_peer_from_availability(rec, &peer_id);
        }
    }
    
    // Security: Prune stale peers to avoid unbounded growth
    rec.runtime.peer_samples.retain(|k, _| seen.contains(k));
    
    // Security: Enforce maximum peer samples per torrent
    if rec.runtime.peer_samples.len() > MAX_PEER_SAMPLES_PER_TORRENT {
        // Remove oldest entries (by last_seen_ms); collect keys first so we don't hold a borrow.
        let keys_to_remove: Vec<String> = {
            let mut samples: Vec<_> = rec.runtime.peer_samples.iter().collect();
            samples.sort_by_key(|(_, s)| s.last_seen_ms);
            let to_remove = samples.len() - MAX_PEER_SAMPLES_PER_TORRENT;
            samples.iter().take(to_remove).map(|(k, _)| (*k).clone()).collect()
        };
        for key in keys_to_remove {
            rec.runtime.peer_samples.remove(key.as_str());
        }
    }

    // Keep the list useful: sort by download rate (desc), then uploaded (desc).
    out.sort_by(|a, b| {
        b.down_rate
            .cmp(&a.down_rate)
            .then_with(|| b.uploaded.cmp(&a.uploaded))
    });

    Ok(PeersResponse { peers: out })
}

pub fn trackers_for(state: &mut OrcState, id: &str) -> Result<TrackersResponse> {
    let rec = state
        .torrents
        .get_mut(id)
        .ok_or_else(|| anyhow!("torrent not found"))?;

    // Ensure tracker state exists for current trackers.
    for t in rec.runtime.trackers.iter() {
        rec.runtime.tracker_state.entry(t.clone()).or_default();
    }

    let running = rec.runtime.running && !matches!(rec.runtime.state, TorrentState::Stopped | TorrentState::Error);
    let mut rows = Vec::new();
    rows.push(TrackerRow {
        url: "** DHT **".to_string(),
        tier: Some(0),
        status: if running { "working" } else { "disabled" }.to_string(),
        seeders: None,
        leechers: None,
        last_announce_ms: None,
        next_announce_ms: None,
        error: None,
        announce_count: None,
        scrape_count: None,
    });
    rows.push(TrackerRow {
        url: "** PeX **".to_string(),
        tier: Some(0),
        status: if running { "working" } else { "disabled" }.to_string(),
        seeders: None,
        leechers: None,
        last_announce_ms: None,
        next_announce_ms: None,
        error: None,
        announce_count: None,
        scrape_count: None,
    });
    rows.push(TrackerRow {
        url: "** LSD **".to_string(),
        tier: Some(0),
        status: if running { "working" } else { "disabled" }.to_string(),
        seeders: None,
        leechers: None,
        last_announce_ms: None,
        next_announce_ms: None,
        error: None,
        announce_count: None,
        scrape_count: None,
    });

    for (i, url) in rec.runtime.trackers.iter().enumerate() {
        let st = rec.runtime.tracker_state.get(url).cloned().unwrap_or_default();

        let status = if let Some(err) = &st.last_error {
            let _ = err; // keep for future mapping
            "not_working"
        } else if running {
            "updating"
        } else {
            "disabled"
        };

        rows.push(TrackerRow {
            url: url.clone(),
            tier: Some(i as u32),
            status: status.to_string(),
            seeders: None,
            leechers: None,
            last_announce_ms: st.last_announce_ms,
            next_announce_ms: st.next_announce_ms,
            error: st.last_error,
            announce_count: Some(st.announce_count),
            scrape_count: Some(st.scrape_count),
        });
    }

    Ok(TrackersResponse { trackers: rows })
}

fn dedup_preserve(mut v: Vec<String>) -> Vec<String> {
    let mut seen = HashSet::<String>::new();
    v.retain(|s| seen.insert(s.to_string()));
    v
}

fn parse_trackers_from_magnet(magnet: &str) -> Vec<String> {
    let Some(qpos) = magnet.find('?') else {
        return vec![];
    };
    let q = &magnet[qpos + 1..];
    let mut out = Vec::new();
    for part in q.split('&') {
        let mut it = part.splitn(2, '=');
        let key = it.next().unwrap_or("");
        if key != "tr" {
            continue;
        }
        let val = it.next().unwrap_or("");
        let val = percent_decode(val);
        if !val.trim().is_empty() {
            out.push(val);
        }
    }
    out
}

fn parse_trackers_from_torrent_bytes(bytes: &[u8]) -> Vec<String> {
    let (v, _) = match parse_bencode(bytes, 0) {
        Ok(v) => v,
        Err(_) => return vec![],
    };

    let mut out = Vec::new();
    if let BVal::Dict(map) = v {
        if let Some(BVal::Bytes(a)) = get_dict_value(&map, b"announce") {
            let s = String::from_utf8_lossy(a).to_string();
            if !s.trim().is_empty() {
                out.push(s);
            }
        }
        if let Some(BVal::List(tiers)) = get_dict_value(&map, b"announce-list") {
            for tier in tiers {
                match tier {
                    BVal::List(urls) => {
                        for u in urls {
                            if let BVal::Bytes(b) = u {
                                let s = String::from_utf8_lossy(&b).to_string();
                                if !s.trim().is_empty() {
                                    out.push(s);
                                }
                            }
                        }
                    }
                    BVal::Bytes(b) => {
                        let s = String::from_utf8_lossy(b).to_string();
                        if !s.trim().is_empty() {
                            out.push(s);
                        }
                    }
                    _ => {}
                }
            }
        }
    }
    out
}

fn percent_decode(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        match bytes[i] {
            b'%' if i + 2 < bytes.len() => {
                let h1 = bytes[i + 1];
                let h2 = bytes[i + 2];
                if let (Some(a), Some(b)) = (from_hex(h1), from_hex(h2)) {
                    out.push((a << 4) | b);
                    i += 3;
                } else {
                    out.push(bytes[i]);
                    i += 1;
                }
            }
            b => {
                out.push(b);
                i += 1;
            }
        }
    }
    String::from_utf8_lossy(&out).to_string()
}

fn from_hex(b: u8) -> Option<u8> {
    match b {
        b'0'..=b'9' => Some(b - b'0'),
        b'a'..=b'f' => Some(10 + (b - b'a')),
        b'A'..=b'F' => Some(10 + (b - b'A')),
        _ => None,
    }
}

#[allow(dead_code)]
fn peer_entries_from_snapshot(v: &serde_json::Value) -> Vec<(String, serde_json::Value)> {
    if let Some(obj) = v.as_object() {
        for key in [
            "peers",
            "per_peer",
            "per_peer_stats",
            "peer_stats",
            "per_peer_stats_snapshot",
        ] {
            if let Some(sub) = obj.get(key) {
                if let Some(map) = sub.as_object() {
                    return map.iter().map(|(k, v)| (k.clone(), v.clone())).collect();
                }
                if let Some(arr) = sub.as_array() {
                    return arr
                        .iter()
                        .enumerate()
                        .map(|(i, p)| {
                            let addr = pick_str(p, &["addr", "peer_addr", "peer", "socket"])
                                .unwrap_or_else(|| format!("peer-{i}"));
                            (addr, p.clone())
                        })
                        .collect();
                }
            }
        }
        if obj.values().all(|vv| vv.is_object()) {
            return obj.iter().map(|(k, v)| (k.clone(), v.clone())).collect();
        }
    }

    vec![]
}

#[allow(dead_code)]
fn pick_u64(v: &serde_json::Value, keys: &[&str]) -> Option<u64> {
    let obj = v.as_object()?;
    for k in keys {
        if let Some(x) = obj.get(*k) {
            if let Some(n) = x.as_u64() {
                return Some(n);
            }
            if let Some(n) = x.as_i64() {
                return Some(n.max(0) as u64);
            }
        }
    }
    None
}

#[allow(dead_code)]
fn pick_f32(v: &serde_json::Value, keys: &[&str]) -> Option<f32> {
    let obj = v.as_object()?;
    for k in keys {
        if let Some(x) = obj.get(*k) {
            if let Some(n) = x.as_f64() {
                return Some(n as f32);
            }
        }
    }
    None
}

#[allow(dead_code)]
fn pick_str(v: &serde_json::Value, keys: &[&str]) -> Option<String> {
    let obj = v.as_object()?;
    for k in keys {
        if let Some(x) = obj.get(*k) {
            if let Some(s) = x.as_str() {
                if !s.trim().is_empty() {
                    return Some(s.to_string());
                }
            }
        }
    }
    None
}

#[allow(dead_code)]
fn pick_bool(v: &serde_json::Value, keys: &[&str]) -> Option<bool> {
    let obj = v.as_object()?;
    for k in keys {
        if let Some(x) = obj.get(*k) {
            if let Some(b) = x.as_bool() {
                return Some(b);
            }
            if let Some(n) = x.as_i64() {
                return Some(n != 0);
            }
            if let Some(n) = x.as_u64() {
                return Some(n != 0);
            }
        }
    }
    None
}


#[allow(dead_code)]
fn synth_peer_flags(v: &serde_json::Value) -> String {
    let mut flags = String::new();
    let obj = v.as_object();

    let b = |k: &str| -> bool {
        obj.and_then(|o| o.get(k)).and_then(|x| x.as_bool()).unwrap_or(false)
    };

    if b("encrypted") || b("is_encrypted") {
        flags.push('E');
    }
    if b("is_seed") || b("seed") {
        flags.push('S');
    }
    if b("choked") || b("is_choked") {
        flags.push('C');
    }
    if b("interested") || b("is_interested") {
        flags.push('I');
    }
    if flags.is_empty() {
        flags.push('—');
    }
    flags
}

#[allow(dead_code)]
fn split_addr(addr: &str) -> (String, u16) {
    if let Ok(sa) = addr.parse::<std::net::SocketAddr>() {
        return (sa.ip().to_string(), sa.port());
    }
    if let Some((host, port)) = addr.rsplit_once(':') {
        if let Ok(p) = port.parse::<u16>() {
            return (host.to_string(), p);
        }
    }

    (addr.to_string(), 0)
}

#[cfg(test)]
mod tests {
    use super::{PeersResponse, PeerRow};

    /// Validates that the peers API response serializes to the shape the frontend expects:
    /// { "peers": [ { "id", "ip", "port", "down_rate", "up_rate", ... } ] }
    #[test]
    fn peers_response_serializes_for_frontend() {
        let row = PeerRow {
            id: "192.168.1.1:6881".to_string(),
            ip: "192.168.1.1".to_string(),
            port: 6881,
            down_rate: 1024,
            up_rate: 512,
            downloaded: 10_000,
            uploaded: 5_000,
            client: Some("qBittorrent".to_string()),
            flags: Some("I".to_string()),
            progress: Some(0.5),
            snubbed: false,
            choked: false,
            interested: Some(true),
            optimistic: Some(false),
            incoming: Some(true),
            encrypted: Some(true),
            rtt_ms: Some(42),
            country: Some("US".to_string()),
            last_seen_ms: 0,
        };
        let resp = PeersResponse {
            peers: vec![row],
        };
        let json = serde_json::to_value(&resp).expect("PeersResponse must serialize");
        let obj = json.as_object().expect("root must be object");
        let peers = obj.get("peers").and_then(|p| p.as_array()).expect("must have peers array");
        assert_eq!(peers.len(), 1, "one peer in response");
        let peer = &peers[0];
        assert_eq!(peer.get("ip").and_then(|v| v.as_str()), Some("192.168.1.1"));
        assert_eq!(peer.get("port").and_then(|v| v.as_u64()), Some(6881));
        assert_eq!(peer.get("down_rate").and_then(|v| v.as_i64()), Some(1024));
        assert_eq!(peer.get("up_rate").and_then(|v| v.as_i64()), Some(512));
        assert!(peer.get("client").is_some());
        assert!(peer.get("country").is_some());
    }

    #[test]
    fn peers_response_empty_list() {
        let resp = PeersResponse { peers: vec![] };
        let json = serde_json::to_value(&resp).expect("must serialize");
        let peers = json.get("peers").and_then(|p| p.as_array()).expect("must have peers");
        assert!(peers.is_empty());
    }
}
