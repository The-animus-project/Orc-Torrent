//! ORC Core: shared types + in-memory state used by the Orc Torrent daemon.
//!
//! This now embeds a real BitTorrent runtime (rqbit via `librqbit`) behind the existing API.

use std::{
    collections::{HashMap, HashSet},
    net::IpAddr,
    path::{Path, PathBuf},
    process::Command,
    sync::{Arc, OnceLock, RwLock},
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

use anyhow::{anyhow, Context, Result};
use base64::{engine::general_purpose, Engine as _};
use hex;
use maxminddb::{geoip2::Country, Reader};
use network_interface::{NetworkInterface, NetworkInterfaceConfig};
use regex::Regex;
use serde::{Deserialize, Serialize};
use sha1::{Digest, Sha1};
use tracing::{info, warn};
use url::form_urlencoded;
use uuid::Uuid;

use librqbit::api::{Api as RqbitApi, ApiAddTorrentResponse, TorrentIdOrHash};
use librqbit::{
    storage::BoxStorageFactory, AddTorrent, AddTorrentOptions, Session, SessionOptions,
    SessionPersistenceConfig,
};

mod bandwidth;
mod media_download_policy;
mod network;
mod privacy;
mod seeding;

pub use media_download_policy::{
    apply_media_download_policy, build_add_torrent_options, is_download_allowed_for_path,
    media_download_policy_enabled, validate_file_download_priority, MEDIA_ONLY_FILES_REGEX,
};

pub use network::{
    default_route_info, dns_config, list_network_adapters, tor_status, DefaultRoute, DnsConfig,
    NetworkAdapter, NetworkAdaptersResponse, TorSource, TorState, TorStatusState,
};

/// Supplies platform-native connectivity state to embedded daemon runtimes.
/// Desktop builds leave this unset and retain their existing adapter probing.
pub trait NetworkStatusProvider: Send + Sync {
    fn vpn_connected(&self) -> bool;

    /// Whether the native host currently permits peer traffic. Desktop providers
    /// default to true; Android also accounts for its Wi-Fi/cellular policy.
    fn transfers_allowed(&self) -> bool {
        true
    }

    /// Consume a platform signal indicating that sockets must be recreated on a
    /// newly bound network before transfers resume.
    fn take_rebind_required(&self) -> bool {
        false
    }

    fn vpn_interface(&self) -> Option<String> {
        None
    }
}

fn network_status_provider_slot() -> &'static RwLock<Option<Arc<dyn NetworkStatusProvider>>> {
    static PROVIDER: OnceLock<RwLock<Option<Arc<dyn NetworkStatusProvider>>>> = OnceLock::new();
    PROVIDER.get_or_init(|| RwLock::new(None))
}

pub fn set_network_status_provider(provider: Option<Arc<dyn NetworkStatusProvider>>) {
    if let Ok(mut slot) = network_status_provider_slot().write() {
        *slot = provider;
    }
}

pub fn network_transfers_allowed() -> bool {
    network_status_provider_slot()
        .read()
        .ok()
        .and_then(|provider| provider.clone())
        .map(|provider| provider.transfers_allowed())
        .unwrap_or(true)
}

pub fn take_network_rebind_required() -> bool {
    network_status_provider_slot()
        .read()
        .ok()
        .and_then(|provider| provider.clone())
        .map(|provider| provider.take_rebind_required())
        .unwrap_or(false)
}

pub use bandwidth::*;
pub use privacy::*;
pub use seeding::*;

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
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub seeding_override: Option<SeedingSettings>,
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
    pub uploaded_bytes: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ratio: Option<f64>,
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

/// Persisted subset of KillSwitchConfig (no runtime-only fields like enforcement_state).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KillSwitchStoredSettings {
    pub enabled: bool,
    pub scope: KillSwitchScope,
    pub vpn_source: VpnSource,
    pub grace_period_sec: u64,
    pub triggers: KillSwitchTriggers,
}

impl From<&KillSwitchConfig> for KillSwitchStoredSettings {
    fn from(cfg: &KillSwitchConfig) -> Self {
        Self {
            enabled: cfg.enabled,
            scope: cfg.scope.clone(),
            vpn_source: cfg.vpn_source.clone(),
            grace_period_sec: cfg.grace_period_sec,
            triggers: cfg.triggers.clone(),
        }
    }
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

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
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

    seeding_started_at_ms: Option<u64>,
}

#[derive(Debug, Clone)]
struct TorrentRecord {
    torrent: Torrent,
    runtime: TorrentRuntime,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct PersistedTorrentRecord {
    torrent: Torrent,
    file_priorities: HashMap<String, String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
struct TorrentCatalog {
    torrents: Vec<PersistedTorrentRecord>,
}

fn file_priority_key(path: &[String]) -> String {
    path.join("/")
}

fn load_torrent_catalog(path: Option<&Path>) -> HashMap<String, PersistedTorrentRecord> {
    let Some(path) = path else {
        return HashMap::new();
    };
    let Ok(bytes) = std::fs::read(path) else {
        return HashMap::new();
    };
    match serde_json::from_slice::<TorrentCatalog>(&bytes) {
        Ok(catalog) => catalog
            .torrents
            .into_iter()
            .map(|record| (record.torrent.id.clone(), record))
            .collect(),
        Err(error) => {
            warn!(
                "Ignoring invalid torrent catalog {}: {error}",
                path.display()
            );
            HashMap::new()
        }
    }
}

fn persist_torrent_catalog(state: &OrcState) {
    let Some(path) = state.catalog_path.as_ref() else {
        return;
    };
    let catalog = TorrentCatalog {
        torrents: state
            .torrents
            .values()
            .map(|record| PersistedTorrentRecord {
                torrent: record.torrent.clone(),
                file_priorities: record
                    .runtime
                    .files
                    .iter()
                    .map(|file| (file_priority_key(&file.path), file.priority.clone()))
                    .collect(),
            })
            .collect(),
    };
    let result = (|| -> Result<()> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let bytes = serde_json::to_vec_pretty(&catalog)?;
        let temporary = path.with_extension("json.tmp");
        std::fs::write(&temporary, bytes)?;
        std::fs::rename(&temporary, path)?;
        Ok(())
    })();
    if let Err(error) = result {
        warn!(
            "Failed to persist torrent catalog {}: {error}",
            path.display()
        );
    }
}

fn stable_torrent_id(info_hash: &str) -> String {
    let normalized = info_hash.trim().to_ascii_lowercase();
    if normalized.len() >= 32 && normalized[..32].chars().all(|c| c.is_ascii_hexdigit()) {
        return format!(
            "{}-{}-{}-{}-{}",
            &normalized[0..8],
            &normalized[8..12],
            &normalized[12..16],
            &normalized[16..20],
            &normalized[20..32]
        );
    }
    Uuid::new_v4().to_string()
}

fn restored_torrent_records(
    rqbit: &RqbitApi,
    mut catalog: HashMap<String, PersistedTorrentRecord>,
) -> HashMap<String, TorrentRecord> {
    let now = Instant::now();
    let mut restored = HashMap::new();
    for listed in rqbit.api_torrent_list().torrents {
        let Some(rqbit_id) = listed.id else { continue };
        let details = rqbit
            .api_torrent_details(TorrentIdOrHash::Id(rqbit_id))
            .unwrap_or(listed);
        let id = stable_torrent_id(&details.info_hash);
        let persisted = catalog.remove(&id).filter(|record| {
            record.torrent.info_hash_hex.as_deref() == Some(details.info_hash.as_str())
        });
        let files = details
            .files
            .unwrap_or_default()
            .into_iter()
            .map(|file| {
                let path = if file.components.is_empty() {
                    split_path_components(&file.name)
                } else {
                    file.components
                };
                let priority = persisted
                    .as_ref()
                    .and_then(|record| record.file_priorities.get(&file_priority_key(&path)))
                    .cloned()
                    .unwrap_or_else(|| if file.included { "normal" } else { "skip" }.to_string());
                TorrentFileEntry {
                    path,
                    size: file.length,
                    priority,
                    downloaded: false,
                }
            })
            .collect::<Vec<_>>();
        let total_bytes = files.iter().map(|file| file.size).sum::<u64>();
        let stats_value = rqbit
            .api_stats_v1(TorrentIdOrHash::Id(rqbit_id))
            .ok()
            .and_then(|stats| serde_json::to_value(stats).ok())
            .unwrap_or_default();
        let downloaded_bytes = stats_value
            .get("progress_bytes")
            .and_then(|value| value.as_u64())
            .or_else(|| {
                stats_value
                    .get("downloaded_bytes")
                    .and_then(|value| value.as_u64())
            })
            .unwrap_or_default();
        let uploaded_bytes = stats_value
            .get("uploaded_bytes")
            .and_then(|value| value.as_u64())
            .unwrap_or_default();
        let finished = stats_value
            .get("finished")
            .and_then(|value| value.as_bool())
            .unwrap_or(total_bytes > 0 && downloaded_bytes >= total_bytes);
        let state_name = stats_value
            .get("state")
            .and_then(|value| value.as_str())
            .unwrap_or("downloading");
        let running = persisted
            .as_ref()
            .map(|record| record.torrent.running)
            .unwrap_or_else(|| !matches!(state_name, "paused" | "stopped" | "error"));
        let state = if !running {
            TorrentState::Stopped
        } else if finished {
            TorrentState::Seeding
        } else {
            TorrentState::Downloading
        };
        let total_pieces_estimate =
            ((total_bytes / (256 * 1024)).max(1)).min(u32::MAX as u64) as u32;
        let name = details.name.unwrap_or_else(|| {
            format!(
                "Torrent {}",
                &details.info_hash[..details.info_hash.len().min(12)]
            )
        });
        let mut torrent = Torrent {
            id: id.clone(),
            name,
            added_at_ms: now_ms(),
            running,
            profile: TorrentProfile {
                mode: TorrentMode::Standard,
                hops: 0,
            },
            info_hash_hex: Some(details.info_hash),
            save_path: Some(details.output_folder),
            seeding_override: None,
        };
        if let Some(persisted) = persisted {
            torrent.name = persisted.torrent.name;
            torrent.added_at_ms = persisted.torrent.added_at_ms;
            torrent.profile = persisted.torrent.profile;
            torrent.seeding_override = persisted.torrent.seeding_override;
        }
        let runtime = TorrentRuntime {
            rqbit_id,
            total_bytes,
            downloaded_bytes,
            uploaded_bytes,
            running,
            state,
            down_rate_bps: 0,
            up_rate_bps: 0,
            peers_seen: 0,
            files,
            last_error: None,
            trackers: Vec::new(),
            tracker_state: HashMap::new(),
            peer_samples: HashMap::new(),
            state_override: None,
            last_sample: now,
            last_downloaded_bytes: downloaded_bytes,
            last_uploaded_bytes: uploaded_bytes,
            heartbeat_samples: Vec::new(),
            heartbeat_last_sample: now,
            heartbeat_last_bytes: downloaded_bytes,
            total_pieces_estimate,
            piece_availability: vec![0; total_pieces_estimate as usize],
            peer_progress_cache: HashMap::new(),
            seeding_started_at_ms: finished.then(now_ms),
        };
        restored.insert(id, TorrentRecord { torrent, runtime });
    }
    if !restored.is_empty() {
        info!(
            "Restored {} torrents from rqbit persistence",
            restored.len()
        );
    }
    restored
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
    catalog_path: Option<PathBuf>,
    persistence_dir: Option<PathBuf>,
    storage_factory: Option<BoxStorageFactory>,
    network_disabled: bool,
    policy: PolicyState,
    kill_switch: KillSwitchConfig,
    bind_interface: Option<String>,
    leak_proof_enabled: bool,
    listen_port: u16,
    net_last_change_ms: u64,
    #[allow(dead_code)]
    geoip_reader: Option<Reader<Vec<u8>>>,
    pub seeding_settings: SeedingSettings,
    pub bandwidth_settings: BandwidthSettings,
    pub bandwidth_active_profile: BandwidthProfile,
    /// Torrent ids queued for stop due to seeding limits (processed by daemon async loop).
    pub seeding_stop_pending: Vec<String>,
}

impl OrcState {
    /// Default download directory path (canonical). Used when adding torrents without a custom save_path.
    pub fn download_dir_path(&self) -> &PathBuf {
        &self.download_dir_path
    }

    pub fn listen_port(&self) -> u16 {
        self.listen_port
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
    let result = reader.lookup(ip_addr).ok()?;
    let country: Country = result.decode().ok()??;
    country.country.iso_code.map(|code: &str| code.to_string())
}

#[allow(dead_code)]
fn is_private_ip(ip: &IpAddr) -> bool {
    match ip {
        IpAddr::V4(ipv4) => {
            ipv4.is_private() || ipv4.is_loopback() || ipv4.is_link_local() || ipv4.is_broadcast()
        }
        IpAddr::V6(ipv6) => ipv6.is_loopback() || ipv6.is_multicast(),
    }
}

fn is_dht_startup_error(err: &anyhow::Error) -> bool {
    err.chain().any(|cause| {
        let message = cause.to_string();
        message.contains("error initializing persistent DHT")
            || message.contains("error initializing DHT")
            || message.contains("error binding socket")
    })
}

async fn create_session_with_dht_fallback(
    download_dir: PathBuf,
    listen_port: u16,
    bind_ipv4: Option<std::net::Ipv4Addr>,
    persistence_dir: Option<PathBuf>,
    storage_factory: Option<&BoxStorageFactory>,
    network_disabled: bool,
) -> Result<Arc<Session>> {
    let base_opts = || SessionOptions {
        listen_port_range: (!network_disabled)
            .then_some(listen_port..listen_port.saturating_add(1)),
        bind_ipv4,
        disable_dht: network_disabled,
        force_paused_on_restore: network_disabled,
        persistence: persistence_dir
            .as_ref()
            .map(|folder| SessionPersistenceConfig::Json {
                folder: Some(folder.clone()),
            }),
        fastresume: persistence_dir.is_some(),
        default_storage_factory: storage_factory.map(|factory| factory.clone_box()),
        ..Default::default()
    };

    match Session::new_with_opts(download_dir.clone(), base_opts()).await {
        Ok(session) => Ok(session),
        Err(primary_err) => {
            let primary_error_text = primary_err.to_string();
            if !is_dht_startup_error(&primary_err) {
                return Err(primary_err).context("Failed to initialize rqbit session");
            }

            warn!(
                error = %primary_err,
                "Primary rqbit session initialization failed; retrying without DHT persistence"
            );

            let no_persistence_opts = SessionOptions {
                disable_dht_persistence: true,
                listen_port_range: (!network_disabled)
                    .then_some(listen_port..listen_port.saturating_add(1)),
                bind_ipv4,
                disable_dht: network_disabled,
                force_paused_on_restore: network_disabled,
                persistence: persistence_dir.as_ref().map(|folder| {
                    SessionPersistenceConfig::Json {
                        folder: Some(folder.clone()),
                    }
                }),
                fastresume: persistence_dir.is_some(),
                default_storage_factory: storage_factory.map(|factory| factory.clone_box()),
                ..Default::default()
            };

            match Session::new_with_opts(download_dir.clone(), no_persistence_opts).await {
                Ok(session) => {
                    warn!("Started rqbit session with non-persistent DHT after persistent DHT initialization failed");
                    Ok(session)
                }
                Err(retry_err) => {
                    let retry_error_text = retry_err.to_string();
                    if !is_dht_startup_error(&retry_err) {
                        return Err(retry_err).context(format!(
                            "Failed to initialize rqbit session after retrying without persistent DHT (initial error: {primary_error_text})"
                        ));
                    }

                    warn!(
                        error = %retry_err,
                        "Non-persistent DHT retry failed; retrying with DHT disabled"
                    );

                    let no_dht_opts = SessionOptions {
                        disable_dht: true,
                        disable_dht_persistence: true,
                        listen_port_range: Some(listen_port..listen_port.saturating_add(1)),
                        bind_ipv4,
                        force_paused_on_restore: network_disabled,
                        persistence: persistence_dir.map(|folder| SessionPersistenceConfig::Json {
                            folder: Some(folder),
                        }),
                        fastresume: true,
                        default_storage_factory: storage_factory.map(|factory| factory.clone_box()),
                        ..Default::default()
                    };

                    Session::new_with_opts(download_dir, no_dht_opts)
                        .await
                        .map(|session| {
                            warn!("Started rqbit session with DHT disabled due to socket initialization failure");
                            session
                        })
                        .context(format!(
                            "Failed to initialize rqbit session after DHT fallbacks (initial error: {primary_error_text}; retry error: {retry_error_text})"
                        ))
                }
            }
        }
    }
}

/// Resolve the first IPv4 address assigned to a network interface name.
pub fn resolve_interface_ipv4(interface: &str) -> Option<std::net::Ipv4Addr> {
    let want = interface.trim();
    if want.is_empty() {
        return None;
    }
    let interfaces = NetworkInterface::show().ok()?;
    for iface in interfaces {
        if iface.name != want {
            continue;
        }
        for addr in iface.addr {
            if let network_interface::Addr::V4(v4) = addr {
                return Some(v4.ip);
            }
        }
    }
    None
}

pub async fn new_state(
    download_dir: String,
    listen_port: u16,
    bind_interface: Option<String>,
) -> Result<SharedState> {
    new_state_with_runtime(download_dir, listen_port, bind_interface, None, None).await
}

/// Initialize ORC with optional embedded-runtime persistence and storage.
pub async fn new_state_with_runtime(
    download_dir: String,
    listen_port: u16,
    bind_interface: Option<String>,
    persistence_dir: Option<PathBuf>,
    storage_factory: Option<BoxStorageFactory>,
) -> Result<SharedState> {
    new_state_with_runtime_policy(
        download_dir,
        listen_port,
        bind_interface,
        persistence_dir,
        storage_factory,
        false,
    )
    .await
}

pub async fn new_state_with_runtime_policy(
    download_dir: String,
    listen_port: u16,
    bind_interface: Option<String>,
    persistence_dir: Option<PathBuf>,
    storage_factory: Option<BoxStorageFactory>,
    network_disabled: bool,
) -> Result<SharedState> {
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

    let bind_ipv4 = bind_interface.as_deref().and_then(resolve_interface_ipv4);
    if let Some(ref iface) = bind_interface {
        if bind_ipv4.is_none() {
            warn!("bind_interface {iface} has no IPv4 address; sockets will use default binding");
        } else {
            info!("Binding BitTorrent session to interface {iface} ({bind_ipv4:?})");
        }
    }

    let catalog_path = persistence_dir
        .as_ref()
        .and_then(|directory| directory.parent())
        .map(|directory| directory.join("torrent-catalog.json"));
    let catalog = load_torrent_catalog(catalog_path.as_deref());
    let session = create_session_with_dht_fallback(
        download_dir_canonical.clone(),
        listen_port,
        bind_ipv4,
        persistence_dir.clone(),
        storage_factory.as_ref(),
        network_disabled,
    )
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
    let net_last_change_ms = now_ms();

    let mut torrents = restored_torrent_records(&rqbit, catalog);
    if network_disabled {
        for record in torrents.values_mut() {
            record.torrent.running = false;
            record.runtime.running = false;
            record.runtime.state = TorrentState::Stopped;
        }
    }
    for record in torrents.values().filter(|record| !record.torrent.running) {
        let _ = rqbit
            .api_torrent_action_pause(TorrentIdOrHash::Id(record.runtime.rqbit_id))
            .await;
    }

    let state = OrcState {
        started_at: Instant::now(),
        download_dir,
        download_dir_path: download_dir_canonical,
        rqbit,
        torrents,
        catalog_path,
        persistence_dir,
        storage_factory,
        network_disabled,
        policy,
        kill_switch,
        bind_interface: bind_interface.clone(),
        leak_proof_enabled: false,
        listen_port,
        net_last_change_ms,
        geoip_reader,
        seeding_settings: SeedingSettings::default(),
        bandwidth_settings: BandwidthSettings::default(),
        bandwidth_active_profile: BandwidthProfile::Normal,
        seeding_stop_pending: Vec::new(),
    };
    if network_disabled {
        persist_torrent_catalog(&state);
    }
    Ok(Arc::new(tokio::sync::Mutex::new(state)))
}

#[derive(Debug, Clone, Deserialize)]
pub struct AddTorrentRequest {
    pub magnet: Option<String>,
    pub torrent_b64: Option<String>,
    pub name_hint: Option<String>,
    /// Optional save path (folder) for this torrent. Use for seeding from an existing folder
    /// or to choose where to download. Must be an absolute path. If omitted, uses default download folder.
    pub save_path: Option<String>,
    #[serde(default)]
    pub start_paused: bool,
}

impl AddTorrentRequest {
    pub fn validate(&self) -> Result<()> {
        if let Some(ref hint) = self.name_hint {
            const MAX_NAME_HINT_LENGTH: usize = 1000;
            if hint.len() > MAX_NAME_HINT_LENGTH {
                return Err(anyhow!(
                    "Name hint too long (max {} chars)",
                    MAX_NAME_HINT_LENGTH
                ));
            }
        }
        if let Some(ref path) = self.save_path {
            let trimmed = path.trim();
            if trimmed.is_empty() {
                return Err(anyhow!("save_path cannot be empty"));
            }
            const MAX_SAVE_PATH_LENGTH: usize = 4096;
            if trimmed.len() > MAX_SAVE_PATH_LENGTH {
                return Err(anyhow!(
                    "save_path too long (max {} chars)",
                    MAX_SAVE_PATH_LENGTH
                ));
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
    #[serde(default)]
    pub paths: Vec<Vec<String>>,
    #[serde(default)]
    pub path: Option<Vec<String>>,
    pub priority: String,
}

impl PatchFilePriorityRequest {
    pub fn resolved_paths(&self) -> Vec<Vec<String>> {
        let mut paths = self.paths.clone();
        if let Some(single) = &self.path {
            paths.push(single.clone());
        }
        paths
    }

    pub fn validate(&self) -> Result<()> {
        let paths = self.resolved_paths();
        const MAX_PATHS: usize = 10000;
        if paths.len() > MAX_PATHS {
            return Err(anyhow!("Too many paths (max {})", MAX_PATHS));
        }
        const VALID_PRIORITIES: &[&str] = &["skip", "low", "normal", "high"];
        if !VALID_PRIORITIES.contains(&self.priority.as_str()) {
            return Err(anyhow!(
                "Invalid priority: must be one of {:?}",
                VALID_PRIORITIES
            ));
        }
        const MAX_PATH_DEPTH: usize = 100;
        for path in &paths {
            if path.len() > MAX_PATH_DEPTH {
                return Err(anyhow!(
                    "Path depth too large (max {} components)",
                    MAX_PATH_DEPTH
                ));
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
    pub vpn_source: Option<VpnSource>,
}

impl PatchKillSwitchRequest {
    pub fn validate(&self) -> Result<()> {
        if let Some(gp) = self.grace_period_sec {
            const MAX_GRACE_PERIOD: u64 = 3600;
            if gp > MAX_GRACE_PERIOD {
                return Err(anyhow!(
                    "Grace period too large (max {} seconds)",
                    MAX_GRACE_PERIOD
                ));
            }
        }
        Ok(())
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NetPostureStoredSettings {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub bind_interface: Option<String>,
    #[serde(default)]
    pub leak_proof_enabled: bool,
}

impl Default for NetPostureStoredSettings {
    fn default() -> Self {
        Self {
            bind_interface: None,
            leak_proof_enabled: false,
        }
    }
}

pub fn apply_policy_stored(state: &mut OrcState, stored: &DesiredPolicy) {
    let _ = patch_policy(state, stored.clone());
}

pub fn policy_stored_from_state(state: &OrcState) -> DesiredPolicy {
    let mut desired = state.policy.desired.clone();
    desired.kill_switch = state.kill_switch.enabled;
    desired.bind_interface_only =
        state.bind_interface.is_some() || state.policy.desired.bind_interface_only;
    desired
}

pub fn apply_net_posture_stored(state: &mut OrcState, stored: &NetPostureStoredSettings) {
    state.bind_interface = stored.bind_interface.clone();
    state.leak_proof_enabled = stored.leak_proof_enabled;
    state.net_last_change_ms = now_ms();
}

pub fn net_posture_stored_from_state(state: &OrcState) -> NetPostureStoredSettings {
    NetPostureStoredSettings {
        bind_interface: state.bind_interface.clone(),
        leak_proof_enabled: state.leak_proof_enabled,
    }
}

pub fn effective_seeding_policy(torrent: &Torrent, global: &SeedingSettings) -> SeedingSettings {
    torrent
        .seeding_override
        .clone()
        .unwrap_or_else(|| global.clone())
}

pub fn patch_seeding_settings(
    state: &mut OrcState,
    settings: SeedingSettings,
) -> Result<SeedingSettings> {
    settings.validate()?;
    state.seeding_settings = settings.clone();
    Ok(settings)
}

pub fn patch_torrent_seeding_override(
    state: &mut OrcState,
    id: &str,
    override_settings: Option<SeedingSettings>,
) -> Result<SeedingSettings> {
    if let Some(ref s) = override_settings {
        s.validate()?;
    }
    let rec = state
        .torrents
        .get_mut(id)
        .ok_or_else(|| anyhow!("Not found"))?;
    rec.torrent.seeding_override = override_settings;
    let effective = effective_seeding_policy(&rec.torrent, &state.seeding_settings);
    persist_torrent_catalog(state);
    Ok(effective)
}

pub fn patch_bandwidth_settings(
    state: &mut OrcState,
    settings: BandwidthSettings,
) -> Result<BandwidthSettings> {
    settings.validate()?;
    state.bandwidth_settings = settings;
    apply_bandwidth_profile_limits(state);
    Ok(state.bandwidth_settings.clone())
}

pub fn apply_bandwidth_profile_limits(state: &mut OrcState) {
    use chrono::Local;
    let profile = active_bandwidth_profile(&state.bandwidth_settings, Local::now());
    state.bandwidth_active_profile = profile;
    let (dl, ul) = state
        .bandwidth_settings
        .limits_for_profile(state.bandwidth_active_profile);
    state.rqbit.session().ratelimits.set_download_bps(dl);
    state.rqbit.session().ratelimits.set_upload_bps(ul);
}

pub fn set_session_rate_limits(
    state: &mut OrcState,
    download_bps: Option<u32>,
    upload_bps: Option<u32>,
) -> Result<()> {
    if let Some(v) = download_bps {
        if v == 0 {
            anyhow::bail!("download_bps must be positive or null");
        }
    }
    if let Some(v) = upload_bps {
        if v == 0 {
            anyhow::bail!("upload_bps must be positive or null");
        }
    }
    state.bandwidth_settings.normal_download_bps = download_bps;
    state.bandwidth_settings.normal_upload_bps = upload_bps;
    apply_bandwidth_profile_limits(state);
    Ok(())
}

pub fn session_rate_limits_response(state: &OrcState) -> serde_json::Value {
    let (dl, ul) = state
        .bandwidth_settings
        .limits_for_profile(state.bandwidth_active_profile);
    serde_json::json!({
        "download_bps": dl.map(|n| n.get()),
        "upload_bps": ul.map(|n| n.get()),
        "active_profile": state.bandwidth_active_profile,
        "bandwidth": state.bandwidth_settings,
    })
}

pub fn apply_vpn_safety_preset(state: &mut OrcState) -> PrivacyPresetResult {
    let vpn_iface = vpn_status().interface_name;
    apply_vpn_safety_preset_with_vpn(state, vpn_iface)
}

pub fn apply_vpn_safety_preset_with_vpn(
    state: &mut OrcState,
    vpn_interface: Option<String>,
) -> PrivacyPresetResult {
    let mut changed = Vec::new();
    if !state.kill_switch.enabled {
        state.kill_switch.enabled = true;
        changed.push("Enabled kill switch".to_string());
    }
    if !state.kill_switch.triggers.pause_all_torrents {
        state.kill_switch.triggers.pause_all_torrents = true;
        changed.push("Enabled pause-all-torrents trigger".to_string());
    }
    if let Some(iface) = vpn_interface {
        if state.bind_interface.as_deref() != Some(iface.as_str()) {
            state.bind_interface = Some(iface.clone());
            changed.push(format!("Set bind interface to {iface}"));
        }
    }
    if !state.leak_proof_enabled {
        state.leak_proof_enabled = true;
        changed.push("Enabled leak protection".to_string());
    }
    sync_policy_kill_switch(state);
    state.net_last_change_ms = now_ms();
    let privacy_status = compute_privacy_status(state);
    PrivacyPresetResult {
        changed,
        privacy_status,
    }
}

pub fn privacy_status(state: &OrcState) -> PrivacyStatus {
    compute_privacy_status(state)
}

pub fn drain_seeding_stop_pending(state: &mut OrcState) -> Vec<String> {
    std::mem::take(&mut state.seeding_stop_pending)
}

#[derive(Debug, Clone, Deserialize)]
pub struct PatchNetPostureRequest {
    pub bind_interface: Option<String>,
    pub leak_proof_enabled: Option<bool>,
}

impl PatchNetPostureRequest {
    pub fn validate(&self) -> Result<()> {
        if let Some(iface) = &self.bind_interface {
            let trimmed = iface.trim();
            if !trimmed.is_empty() {
                const MAX_IFACE_LEN: usize = 128;
                if trimmed.len() > MAX_IFACE_LEN {
                    return Err(anyhow!(
                        "bind_interface too long (max {} chars)",
                        MAX_IFACE_LEN
                    ));
                }
                let valid = trimmed
                    .chars()
                    .all(|c| c.is_ascii_alphanumeric() || matches!(c, '_' | '-' | '.' | ':'));
                if !valid {
                    return Err(anyhow!("bind_interface contains invalid characters"));
                }
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
    #[cfg(target_os = "macos")]
    let utun_pattern = Regex::new(r"^utun\d+").unwrap();

    for interface in interfaces {
        let name = interface.name.to_lowercase();
        if !interface.addr.is_empty() {
            if let Some(conn_type) = interface_name_matches_vpn(
                &name,
                &exclude_patterns,
                &vpn_patterns,
                #[cfg(target_os = "macos")]
                &utun_pattern,
            ) {
                return Some((interface.name, conn_type));
            }
        }
    }

    #[cfg(target_os = "macos")]
    {
        // macOS fallback: if default route is through utunX, treat as active VPN.
        if let Some(default_iface) = macos_default_route_interface() {
            let lowered = default_iface.to_lowercase();
            if lowered.starts_with("utun") {
                return Some((default_iface, ConnectionType::Vpn));
            }
        }
    }

    None
}

#[cfg(target_os = "macos")]
fn macos_default_route_interface() -> Option<String> {
    let output = Command::new("route")
        .args(["-n", "get", "default"])
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let stdout = String::from_utf8(output.stdout).ok()?;
    for line in stdout.lines() {
        let trimmed = line.trim();
        if let Some(rest) = trimmed.strip_prefix("interface:") {
            let iface = rest.trim();
            if !iface.is_empty() {
                return Some(iface.to_string());
            }
        }
    }
    None
}

fn interface_name_matches_vpn(
    name: &str,
    exclude_patterns: &[Regex],
    vpn_patterns: &[(Regex, ConnectionType)],
    #[cfg(target_os = "macos")] utun_pattern: &Regex,
) -> Option<ConnectionType> {
    let is_excluded = exclude_patterns
        .iter()
        .any(|pattern| pattern.is_match(name));
    if is_excluded {
        return None;
    }
    for (pattern, conn_type) in vpn_patterns {
        if pattern.is_match(name) {
            return Some(conn_type.clone());
        }
    }
    #[cfg(target_os = "macos")]
    {
        if std::env::var("ORC_VPN_ALLOW_UTUN").ok().as_deref() == Some("1")
            && utun_pattern.is_match(name)
        {
            return Some(ConnectionType::Vpn);
        }
    }
    #[cfg(target_os = "windows")]
    {
        if (name.contains("tap") || name.contains("tun") || name.contains("wintun"))
            && !name.contains("ethernet")
            && !name.contains("adapter")
        {
            return Some(ConnectionType::Vpn);
        }
        if name.contains("mullvad")
            || name.contains("nordvpn")
            || name.contains("wireguard")
            || name.contains("openvpn")
            || name.contains("proton")
            || name.contains("expressvpn")
        {
            return Some(ConnectionType::Vpn);
        }
    }
    None
}

pub fn vpn_status() -> VpnStatus {
    let now = now_ms();
    if let Some(provider) = network_status_provider_slot()
        .read()
        .ok()
        .and_then(|provider| provider.clone())
    {
        let connected = provider.vpn_connected();
        let interface_name = provider.vpn_interface();
        return VpnStatus {
            posture: if connected {
                VpnPostureState::Connected
            } else {
                VpnPostureState::Disconnected
            },
            interface_name: interface_name.clone(),
            default_route_interface: interface_name.clone(),
            dns_servers: vec![],
            signals: VpnSignals {
                adapter_match: connected,
                default_route_match: connected,
                dns_match: false,
                public_ip_match: None,
            },
            last_check_ms: now,
            connection_type: if connected {
                ConnectionType::Vpn
            } else {
                ConnectionType::NonVpn
            },
            public_ip: None,
            detected: Some(connected),
            interface_name_legacy: interface_name,
        };
    }
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

pub fn net_bind_interface(state: &OrcState) -> Option<&str> {
    state.bind_interface.as_deref()
}

pub fn net_posture(state: &OrcState) -> NetPosture {
    let vpn = vpn_status();
    let posture_state = if state.leak_proof_enabled {
        if matches!(vpn.posture, VpnPostureState::Connected) {
            NetPostureState::Protected
        } else {
            NetPostureState::LeakRisk
        }
    } else if state.bind_interface.is_some() {
        NetPostureState::Protected
    } else {
        NetPostureState::Unconfigured
    };

    NetPosture {
        bind_interface: state.bind_interface.clone(),
        leak_proof_enabled: state.leak_proof_enabled,
        state: posture_state,
        last_change_ms: state.net_last_change_ms,
        vpn_status: vpn,
        kill_switch: state.kill_switch.clone(),
    }
}

pub fn patch_net_posture(state: &mut OrcState, req: PatchNetPostureRequest) -> NetPosture {
    if let Some(bind_interface) = req.bind_interface {
        let trimmed = bind_interface.trim().to_string();
        state.bind_interface = if trimmed.is_empty() {
            None
        } else {
            Some(trimmed)
        };
    }
    if let Some(leak_proof_enabled) = req.leak_proof_enabled {
        state.leak_proof_enabled = leak_proof_enabled;
        sync_leak_proof_kill_switch(state);
    }
    state.net_last_change_ms = now_ms();
    net_posture(state)
}

/// Recreate the rqbit session with the current bind interface and re-attach torrents.
pub async fn rebind_rqbit_session(state: &mut OrcState) -> Result<()> {
    state.network_disabled = true;
    struct TorrentRebindInfo {
        orc_id: String,
        info_hash: String,
        output_folder: String,
        running: bool,
    }

    let download_dir = state.download_dir_path().clone();
    let listen_port = state.listen_port;
    let bind_interface = state.bind_interface.clone();
    let persistence_dir = state.persistence_dir.clone();

    let torrents: Vec<TorrentRebindInfo> = state
        .torrents
        .values()
        .map(|rec| TorrentRebindInfo {
            orc_id: rec.torrent.id.clone(),
            info_hash: rec.torrent.info_hash_hex.clone().unwrap_or_default(),
            output_folder: rec
                .torrent
                .save_path
                .clone()
                .unwrap_or_else(|| state.download_dir.clone()),
            running: rec.runtime.running,
        })
        .collect();

    {
        let api = rqbit_api(state);
        let pause_ids: Vec<usize> = state
            .torrents
            .values()
            .filter_map(|rec| rqbit_id_for(state, &rec.torrent.id))
            .collect();
        for rqbit_id in pause_ids {
            let _ = api
                .api_torrent_action_pause(TorrentIdOrHash::Id(rqbit_id))
                .await;
        }
    }

    {
        let old_session = rqbit_api(state).session().clone();
        old_session.cancellation_token().cancel();
        tokio::time::sleep(Duration::from_millis(400)).await;
    }

    let bind_ipv4 = bind_interface.as_deref().and_then(resolve_interface_ipv4);
    if let Some(ref iface) = bind_interface {
        if bind_ipv4.is_none() {
            warn!("bind_interface {iface} has no IPv4 address; hot-rebind uses default sockets");
        } else {
            info!("Hot-rebinding BitTorrent session to interface {iface} ({bind_ipv4:?})");
        }
    }

    let new_session = create_session_with_dht_fallback(
        download_dir,
        listen_port,
        bind_ipv4,
        persistence_dir.clone(),
        state.storage_factory.as_ref(),
        false,
    )
    .await?;
    state.rqbit = RqbitApi::new(new_session, None);

    if persistence_dir.is_some() {
        let restored_ids = state
            .rqbit
            .api_torrent_list()
            .torrents
            .into_iter()
            .filter_map(|torrent| torrent.id.map(|id| (torrent.info_hash, id)))
            .collect::<HashMap<_, _>>();
        for torrent in torrents {
            let rqbit_id = *restored_ids.get(&torrent.info_hash).with_context(|| {
                format!(
                    "persisted torrent {} was not restored after network rebind",
                    torrent.orc_id
                )
            })?;
            if let Some(record) = state.torrents.get_mut(&torrent.orc_id) {
                record.runtime.rqbit_id = rqbit_id;
            }
            let api = rqbit_api(state);
            if torrent.running {
                api.api_torrent_action_start(TorrentIdOrHash::Id(rqbit_id))
                    .await
                    .with_context(|| format!("failed to resume torrent {}", torrent.orc_id))?;
            } else {
                let _ = api
                    .api_torrent_action_pause(TorrentIdOrHash::Id(rqbit_id))
                    .await;
            }
            let _ = set_running(state, &torrent.orc_id, torrent.running);
        }
        state.network_disabled = false;
        return Ok(());
    }

    for t in torrents {
        if t.info_hash.len() != 40 {
            warn!(
                "Skipping hot-rebind for torrent {}: missing info hash",
                t.orc_id
            );
            continue;
        }
        let mut opts = AddTorrentOptions::default();
        opts.output_folder = Some(t.output_folder);
        opts.overwrite = true;
        opts.paused = !t.running;
        let api = rqbit_api(state);
        let resp = api
            .api_add_torrent(AddTorrent::from_url(t.info_hash.as_str()), Some(opts))
            .await
            .with_context(|| format!("failed to re-add torrent {}", t.orc_id))?;
        let Some(rqbit_id) = resp.id else {
            warn!(
                "rqbit did not return id when re-adding torrent {}",
                t.orc_id
            );
            continue;
        };
        if let Some(rec) = state.torrents.get_mut(&t.orc_id) {
            rec.runtime.rqbit_id = rqbit_id;
        }
        if t.running {
            let api = rqbit_api(state);
            let _ = api
                .api_torrent_action_start(TorrentIdOrHash::Id(rqbit_id))
                .await;
            let _ = set_running(state, &t.orc_id, true);
        } else {
            let _ = set_running(state, &t.orc_id, false);
        }
    }

    state.network_disabled = false;
    Ok(())
}

pub fn network_session_disabled(state: &OrcState) -> bool {
    state.network_disabled
}

pub fn list_torrents(state: &OrcState) -> TorrentListResponse {
    TorrentListResponse {
        items: state.torrents.values().map(|r| r.torrent.clone()).collect(),
    }
}

pub fn get_torrent(state: &OrcState, id: &str) -> Option<Torrent> {
    state.torrents.get(id).map(|r| r.torrent.clone())
}

pub fn get_status(state: &OrcState, id: &str) -> Option<TorrentStatus> {
    state
        .torrents
        .get(id)
        .map(|r| torrent_status_from_record(r))
}

#[allow(dead_code)]
fn update_piece_availability_from_peers(
    rec: &mut TorrentRecord,
    peer_progress: f32,
    peer_id: &str,
) {
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
    rec.runtime
        .peer_progress_cache
        .insert(peer_id.to_string(), peer_progress);
}

#[allow(dead_code)]
fn remove_peer_from_availability(rec: &mut TorrentRecord, peer_id: &str) {
    if let Some(progress) = rec.runtime.peer_progress_cache.remove(peer_id) {
        let total_pieces = rec.runtime.total_pieces_estimate as usize;
        if rec.runtime.piece_availability.len() == total_pieces {
            let pieces_peer_had = (progress * total_pieces as f32).ceil() as usize;
            for i in 0..pieces_peer_had.min(total_pieces) {
                rec.runtime.piece_availability[i] =
                    rec.runtime.piece_availability[i].saturating_sub(1);
            }
        }
    }
}

pub fn get_row_snapshot(state: &OrcState, id: &str) -> Option<TorrentRowSnapshot> {
    let rec = state.torrents.get(id)?;
    let progress = if rec.runtime.total_bytes == 0 {
        0.0
    } else {
        (rec.runtime.downloaded_bytes as f64 / rec.runtime.total_bytes as f64).clamp(0.0, 1.0)
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
        let have_count = completed_pieces
            .saturating_sub(start_piece)
            .min(pieces_in_bin);
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

pub fn find_torrent_by_info_hash(
    state: &OrcState,
    info_hash: &str,
) -> Option<(String, bool, bool)> {
    state
        .torrents
        .iter()
        .find(|(_, rec)| {
            rec.torrent
                .info_hash_hex
                .as_ref()
                .map(|h| h.eq_ignore_ascii_case(info_hash))
                .unwrap_or(false)
        })
        .map(|(id, rec)| {
            let is_complete = rec.runtime.downloaded_bytes >= rec.runtime.total_bytes
                && rec.runtime.total_bytes > 0;
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
        (r.runtime.downloaded_bytes as f64 / r.runtime.total_bytes as f64).clamp(0.0, 1.0)
    };

    let remaining = r
        .runtime
        .total_bytes
        .saturating_sub(r.runtime.downloaded_bytes);
    let eta_sec = if r.runtime.down_rate_bps > 0 {
        (remaining / r.runtime.down_rate_bps).min(u64::MAX)
    } else {
        0
    };

    let ratio = if r.runtime.downloaded_bytes > 0 {
        Some(r.runtime.uploaded_bytes as f64 / r.runtime.downloaded_bytes as f64)
    } else {
        None
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
        uploaded_bytes: r.runtime.uploaded_bytes,
        ratio,
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

/// Extract display name (`dn=`) from a magnet URI.
pub fn extract_display_name_from_magnet(magnet: &str) -> Option<String> {
    if !magnet.starts_with("magnet:?") {
        return None;
    }
    const MAX_MAGNET_LENGTH: usize = 8192;
    if magnet.len() > MAX_MAGNET_LENGTH {
        return None;
    }
    let query = magnet.strip_prefix("magnet:?")?;
    for (key, value) in form_urlencoded::parse(query.as_bytes()) {
        if key == "dn" {
            let name = value.trim().to_string();
            if !name.is_empty() {
                return Some(name);
            }
        }
    }
    None
}

/// Placeholder `name_hint` values sent by the UI before metadata is available.
pub fn is_generic_name_hint(hint: &str) -> bool {
    matches!(
        hint.trim().to_ascii_lowercase().as_str(),
        "magnet" | "search-result" | "torrent"
    )
}

fn normalize_name_hint(hint: &str) -> String {
    let trimmed = hint.trim();
    if trimmed.len() > 8 && trimmed.to_ascii_lowercase().ends_with(".torrent") {
        trimmed[..trimmed.len() - 8].trim().to_string()
    } else {
        trimmed.to_string()
    }
}

/// True when a torrent name is known before metadata fetch (for folder naming).
pub fn has_meaningful_pre_metadata_name(req: &AddTorrentRequest) -> bool {
    if let Some(hint) = req.name_hint.as_ref() {
        let normalized = normalize_name_hint(hint);
        if !normalized.is_empty() && !is_generic_name_hint(&normalized) {
            return true;
        }
    }
    if let Some(magnet) = req.magnet.as_deref() {
        if extract_display_name_from_magnet(magnet).is_some() {
            return true;
        }
    }
    false
}

/// Resolve the human-readable torrent name for display and folder naming.
pub fn resolve_torrent_name(
    req: &AddTorrentRequest,
    details_name: Option<&str>,
    info_hash: &str,
) -> String {
    if let Some(hint) = req.name_hint.as_ref() {
        let trimmed = normalize_name_hint(hint);
        if !trimmed.is_empty() && !is_generic_name_hint(&trimmed) {
            return trimmed;
        }
    }
    if let Some(name) = details_name {
        let trimmed = name.trim();
        if !trimmed.is_empty() {
            return trimmed.to_string();
        }
    }
    if let Some(magnet) = req.magnet.as_deref() {
        if let Some(dn) = extract_display_name_from_magnet(magnet) {
            return dn;
        }
    }
    format!("torrent-{}", info_hash.chars().take(8).collect::<String>())
}

/// Default download folder for a new torrent: `{download_dir}/{sanitized name}/`.
/// Returns `None` when no meaningful name is known pre-metadata (librqbit picks the folder).
/// Appends a short hash suffix when the folder already exists (name collision).
pub fn resolve_torrent_output_folder(
    download_dir: &Path,
    req: &AddTorrentRequest,
    info_hash: &str,
) -> Option<PathBuf> {
    if !has_meaningful_pre_metadata_name(req) {
        return None;
    }
    let mut folder_name = sanitize_fs_name(&resolve_torrent_name(req, None, info_hash));
    if folder_name.is_empty() {
        folder_name = format!("torrent-{}", info_hash.chars().take(8).collect::<String>());
    }
    let candidate = download_dir.join(&folder_name);
    Some(if candidate.exists() {
        let suffix = info_hash.chars().take(8).collect::<String>();
        download_dir.join(format!("{folder_name}-{suffix}"))
    } else {
        candidate
    })
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

        let bytes = general_purpose::STANDARD
            .decode(b64)
            .context("Invalid base64 torrent")?;
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
        return Err(anyhow!(
            "Maximum number of torrents ({}) reached",
            MAX_TORRENTS
        ));
    }
    let rqbit_id = rqbit_resp
        .id
        .ok_or_else(|| anyhow!("rqbit did not return a torrent id"))?;

    let details = rqbit_resp.details;

    let id = stable_torrent_id(&details.info_hash);
    let added_at_ms = now_ms();

    let name = resolve_torrent_name(req, details.name.as_deref(), &details.info_hash);

    let mut files = details
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

    if media_download_policy_enabled() {
        apply_media_download_policy(&mut files);
    }

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
        seeding_override: None,
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
        seeding_started_at_ms: None,
    };

    state
        .torrents
        .insert(id.clone(), TorrentRecord { torrent, runtime });
    persist_torrent_catalog(state);

    info!(
        "Added torrent id={} name=\"{}\" rqbit_id={}",
        id, name, rqbit_id
    );
    Ok(AddTorrentResponse { id })
}

pub fn set_running(state: &mut OrcState, id: &str, running: bool) -> Result<()> {
    {
        let rec = state
            .torrents
            .get_mut(id)
            .ok_or_else(|| anyhow!("Not found"))?;
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
    }
    persist_torrent_catalog(state);
    Ok(())
}

pub fn remove_torrent(state: &mut OrcState, id: &str) -> Result<()> {
    state
        .torrents
        .remove(id)
        .ok_or_else(|| anyhow!("Not found"))?;
    persist_torrent_catalog(state);
    Ok(())
}

pub fn set_profile(state: &mut OrcState, id: &str, profile: TorrentProfile) -> Result<Torrent> {
    let torrent = {
        let rec = state
            .torrents
            .get_mut(id)
            .ok_or_else(|| anyhow!("Not found"))?;
        rec.torrent.profile = profile;
        rec.torrent.clone()
    };
    persist_torrent_catalog(state);
    Ok(torrent)
}

pub fn set_file_priority(
    state: &mut OrcState,
    id: &str,
    req: PatchFilePriorityRequest,
) -> Result<()> {
    {
        let rec = state
            .torrents
            .get_mut(id)
            .ok_or_else(|| anyhow!("Not found"))?;
        if rec.runtime.files.is_empty() {
            return Ok(());
        }

        for path in req.resolved_paths() {
            if req.priority != "skip" {
                validate_file_download_priority(&path, &req.priority)?;
            }
            for f in rec.runtime.files.iter_mut() {
                if f.path == path {
                    f.priority = req.priority.clone();
                }
            }
        }
    }
    persist_torrent_catalog(state);
    Ok(())
}

pub fn patch_kill_switch(state: &mut OrcState, req: PatchKillSwitchRequest) -> KillSwitchConfig {
    if let Some(enabled) = req.enabled {
        state.kill_switch.enabled = enabled;
        state.leak_proof_enabled = enabled;
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
    if let Some(vs) = req.vpn_source {
        state.kill_switch.vpn_source = vs;
    }
    sync_policy_kill_switch(state);
    state.kill_switch.clone()
}

fn sync_leak_proof_kill_switch(state: &mut OrcState) {
    state.kill_switch.enabled = state.leak_proof_enabled;
    state.kill_switch.enforcement_state = if state.leak_proof_enabled {
        KillSwitchState::Armed
    } else {
        KillSwitchState::Disarmed
    };
    sync_policy_kill_switch(state);
}

fn sync_policy_kill_switch(state: &mut OrcState) {
    state.policy.desired.kill_switch = state.kill_switch.enabled;
    state.policy.effective.kill_switch = state.kill_switch.enabled;
    state.policy.effective.network_allowed = if state.kill_switch.enabled {
        is_vpn_connected()
    } else {
        true
    };
}

/// Restore kill switch user settings from persisted config (called at startup).
pub fn apply_stored_kill_switch(state: &mut OrcState, s: &KillSwitchStoredSettings) {
    state.kill_switch.enabled = s.enabled;
    state.kill_switch.scope = s.scope.clone();
    state.kill_switch.vpn_source = s.vpn_source.clone();
    state.kill_switch.grace_period_sec = s.grace_period_sec;
    state.kill_switch.triggers = s.triggers.clone();
    state.kill_switch.enforcement_state = if s.enabled {
        KillSwitchState::Armed
    } else {
        KillSwitchState::Disarmed
    };
    state.kill_switch.last_enforcement_ms = Some(now_ms());
    sync_policy_kill_switch(state);
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

    state.policy.desired = desired.clone();
    state.policy.effective = effective;
    state.policy.warnings = warnings;
    state.policy.version += 1;
    state.policy.last_updated_ms = now_ms();

    if desired.kill_switch != state.kill_switch.enabled {
        state.kill_switch.enabled = desired.kill_switch;
    }
    state.policy.desired.kill_switch = state.kill_switch.enabled;

    state.policy.clone()
}

fn is_vpn_connected() -> bool {
    let vpn = vpn_status();
    matches!(vpn.posture, VpnPostureState::Connected)
        && matches!(vpn.connection_type, ConnectionType::Vpn)
        && vpn.detected != Some(false)
}

pub fn tick(state: &mut OrcState) {
    let now = Instant::now();
    const HEARTBEAT_SAMPLE_INTERVAL_MS: u64 = 200;
    const HEARTBEAT_MAX_SAMPLES: usize = 120;
    for rec in state.torrents.values_mut() {
        let elapsed_ms = rec.runtime.heartbeat_last_sample.elapsed().as_millis() as u64;
        if elapsed_ms >= HEARTBEAT_SAMPLE_INTERVAL_MS {
            if rec.runtime.running {
                let bytes_delta = rec
                    .runtime
                    .downloaded_bytes
                    .saturating_sub(rec.runtime.heartbeat_last_bytes);
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
                    let mut to_pause = Vec::new();
                    for (id, rec) in state.torrents.iter_mut() {
                        if rec.runtime.running {
                            rec.runtime.running = false;
                            rec.torrent.running = false;
                            rec.runtime.state = TorrentState::Stopped;
                            rec.runtime.down_rate_bps = 0;
                            rec.runtime.up_rate_bps = 0;
                            to_pause.push(id.clone());
                        }
                    }
                    for id in to_pause {
                        if !state.seeding_stop_pending.contains(&id) {
                            state.seeding_stop_pending.push(id);
                        }
                    }
                    persist_torrent_catalog(state);
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
                tracing::debug!(
                    "Failed to serialize stats for torrent {}: {}",
                    rec.runtime.rqbit_id,
                    e
                );
                continue;
            }
        };

        let total_bytes = v.get("total_bytes").and_then(|x| x.as_u64()).unwrap_or(0);
        let progress_bytes = v
            .get("progress_bytes")
            .and_then(|x| x.as_u64())
            .or_else(|| v.get("downloaded_bytes").and_then(|x| x.as_u64()))
            .unwrap_or(0);
        let uploaded_bytes = v
            .get("uploaded_bytes")
            .and_then(|x| x.as_u64())
            .unwrap_or(0);
        let finished = v.get("finished").and_then(|x| x.as_bool()).unwrap_or(false);
        let state_str = v.get("state").and_then(|x| x.as_str()).unwrap_or("error");
        let err = v
            .get("error")
            .and_then(|x| x.as_str())
            .map(|s| s.to_string());
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

        if matches!(rec.runtime.state, TorrentState::Seeding) {
            if rec.runtime.seeding_started_at_ms.is_none() {
                rec.runtime.seeding_started_at_ms = Some(now_ms());
            }
        } else {
            rec.runtime.seeding_started_at_ms = None;
        }

        rec.runtime.running = !matches!(
            rec.runtime.state,
            TorrentState::Stopped | TorrentState::Error
        );
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

    apply_bandwidth_profile_limits(state);

    let now_wall = now_ms();
    let global_seeding = state.seeding_settings.clone();
    let mut to_stop: Vec<String> = Vec::new();
    for (id, rec) in &state.torrents {
        if !matches!(rec.runtime.state, TorrentState::Seeding) || !rec.runtime.running {
            continue;
        }
        let policy = effective_seeding_policy(&rec.torrent, &global_seeding);
        if seeding_limit_reached(
            &policy,
            rec.runtime.uploaded_bytes,
            rec.runtime.downloaded_bytes,
            rec.runtime.seeding_started_at_ms,
            now_wall,
        )
        .is_some()
        {
            to_stop.push(id.clone());
        }
    }
    let stopped_any = !to_stop.is_empty();
    for id in to_stop {
        if let Some(rec) = state.torrents.get_mut(&id) {
            rec.runtime.running = false;
            rec.torrent.running = false;
            rec.runtime.state = TorrentState::Stopped;
            rec.runtime.down_rate_bps = 0;
            rec.runtime.up_rate_bps = 0;
        }
        if !state.seeding_stop_pending.contains(&id) {
            info!("Seeding limit reached for torrent {id}, queued stop");
            state.seeding_stop_pending.push(id);
        }
    }
    if stopped_any {
        persist_torrent_catalog(state);
    }
}

pub fn sanitize_fs_name(s: &str) -> String {
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
            c.is_alphanumeric()
                || matches!(
                    c,
                    ' ' | '.'
                        | '-'
                        | '_'
                        | '('
                        | ')'
                        | '['
                        | ']'
                        | '&'
                        | '#'
                        | '@'
                        | '!'
                        | '%'
                        | '+'
                        | '='
                )
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
        .and_then(|v| match v {
            BVal::Dict(d) => Some(d),
            _ => None,
        })
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
                let path_list =
                    get_dict_value(&fd, b"path.utf-8").or_else(|| get_dict_value(&fd, b"path"));

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
    dict.iter()
        .find(|(k, _)| k.as_slice() == key)
        .map(|(_, v)| v)
}

#[allow(dead_code)]
fn get_int(dict: &[(Vec<u8>, BVal)], key: &[u8]) -> Option<i64> {
    get_dict_value(dict, key).and_then(|v| match v {
        BVal::Int(i) => Some(*i),
        _ => None,
    })
}

#[allow(dead_code)]
fn get_bytes(dict: &[(Vec<u8>, BVal)], key: &[u8]) -> Option<Vec<u8>> {
    get_dict_value(dict, key).and_then(|v| match v {
        BVal::Bytes(b) => Some(b.clone()),
        _ => None,
    })
}

const MAX_BENCODE_DEPTH: usize = 100;
const MAX_BENCODE_SIZE: usize = 100 * 1024 * 1024;

fn parse_bencode(input: &[u8], i: usize) -> Result<(BVal, usize)> {
    parse_bencode_with_depth(input, i, 0)
}

fn parse_bencode_with_depth(input: &[u8], mut i: usize, depth: usize) -> Result<(BVal, usize)> {
    if depth > MAX_BENCODE_DEPTH {
        return Err(anyhow!(
            "bencode nesting too deep (max {})",
            MAX_BENCODE_DEPTH
        ));
    }
    if input.len() > MAX_BENCODE_SIZE {
        return Err(anyhow!(
            "bencode input too large (max {} bytes)",
            MAX_BENCODE_SIZE
        ));
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
                return Err(anyhow!(
                    "byte string too large (max {} bytes)",
                    MAX_BYTE_STRING_SIZE
                ));
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

        let downloaded = pick_u64(
            &pv,
            &[
                "downloaded",
                "downloaded_bytes",
                "total_downloaded",
                "dl_bytes",
            ],
        )
        .unwrap_or(0);
        let uploaded = pick_u64(
            &pv,
            &["uploaded", "uploaded_bytes", "total_uploaded", "ul_bytes"],
        )
        .unwrap_or(0);

        let client = pick_str(&pv, &["client", "client_name", "user_agent", "client_id"]);

        let flags = pick_str(&pv, &["flags"]).unwrap_or_else(|| synth_peer_flags(&pv));

        // Rate sampling.
        let key = addr.clone();
        seen.insert(key.clone());

        let (down_rate, up_rate, last_seen_ms) = match rec.runtime.peer_samples.get(&key) {
            Some(prev) => {
                let dt = now_i.duration_since(prev.at).as_secs_f64().max(0.25);
                let dd = downloaded.saturating_sub(prev.downloaded) as f64;
                let du = uploaded.saturating_sub(prev.uploaded) as f64;
                ((dd / dt) as i64, (du / dt) as i64, now_ms_epoch)
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
        let country = pick_str(&pv, &["country", "country_code"]).or_else(|| {
            // If peer data doesn't include country, lookup using GeoIP
            state
                .geoip_reader
                .as_ref()
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
            optimistic: pick_bool(&pv, &["optimistic"])
                .or_else(|| pick_bool(&pv, &["optimistic_unchoke"])),
            incoming: pick_bool(&pv, &["incoming", "is_incoming"]),
            encrypted: pick_bool(&pv, &["encrypted", "is_encrypted"]),
            rtt_ms: pick_u64(&pv, &["rtt_ms", "rtt", "ping_ms"])
                .map(|x| x.min(u32::MAX as u64) as u32),
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
            samples
                .iter()
                .take(to_remove)
                .map(|(k, _)| (*k).clone())
                .collect()
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

    let running = rec.runtime.running
        && !matches!(
            rec.runtime.state,
            TorrentState::Stopped | TorrentState::Error
        );
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
        let st = rec
            .runtime
            .tracker_state
            .get(url)
            .cloned()
            .unwrap_or_default();

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
        obj.and_then(|o| o.get(k))
            .and_then(|x| x.as_bool())
            .unwrap_or(false)
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
    use super::{
        apply_vpn_safety_preset_with_vpn, extract_display_name_from_magnet,
        find_torrent_by_info_hash, has_meaningful_pre_metadata_name, interface_name_matches_vpn,
        is_generic_name_hint, new_state, resolve_torrent_name, resolve_torrent_output_folder,
        sanitize_fs_name, AddTorrentRequest, ConnectionType, PeerRow, PeersResponse, Torrent,
        TorrentMode, TorrentProfile, TorrentRecord, TorrentRuntime, TorrentState,
    };
    use regex::Regex;
    use std::collections::HashMap;
    use std::time::Instant;

    #[test]
    fn extract_display_name_from_magnet_decodes_dn() {
        let magnet = "magnet:?xt=urn:btih:0123456789abcdef0123456789abcdef01234567&dn=Ubuntu+24.04";
        assert_eq!(
            extract_display_name_from_magnet(magnet).as_deref(),
            Some("Ubuntu 24.04")
        );
    }

    #[test]
    fn extract_display_name_from_magnet_missing_dn() {
        let magnet = "magnet:?xt=urn:btih:0123456789abcdef0123456789abcdef01234567";
        assert_eq!(extract_display_name_from_magnet(magnet), None);
    }

    #[test]
    fn is_generic_name_hint_recognizes_placeholders() {
        assert!(is_generic_name_hint("magnet"));
        assert!(is_generic_name_hint("  MAGNET  "));
        assert!(is_generic_name_hint("search-result"));
        assert!(is_generic_name_hint("torrent"));
        assert!(!is_generic_name_hint("Ubuntu 24.04"));
    }

    #[test]
    fn resolve_torrent_name_strips_torrent_extension() {
        let req = AddTorrentRequest {
            magnet: None,
            torrent_b64: Some("Zg==".to_string()),
            name_hint: Some("ubuntu-24.04.torrent".to_string()),
            save_path: None,
            start_paused: false,
        };
        assert_eq!(
            resolve_torrent_name(&req, None, "0123456789abcdef0123456789abcdef01234567"),
            "ubuntu-24.04"
        );
    }

    #[test]
    fn has_meaningful_pre_metadata_name_from_dn() {
        let req = AddTorrentRequest {
            magnet: Some(
                "magnet:?xt=urn:btih:0123456789abcdef0123456789abcdef01234567&dn=Ubuntu+24.04"
                    .to_string(),
            ),
            torrent_b64: None,
            name_hint: None,
            save_path: None,
            start_paused: false,
        };
        assert!(has_meaningful_pre_metadata_name(&req));
    }

    #[test]
    fn has_meaningful_pre_metadata_name_false_without_name() {
        let req = AddTorrentRequest {
            magnet: Some(
                "magnet:?xt=urn:btih:0123456789abcdef0123456789abcdef01234567".to_string(),
            ),
            torrent_b64: None,
            name_hint: None,
            save_path: None,
            start_paused: false,
        };
        assert!(!has_meaningful_pre_metadata_name(&req));
    }

    #[test]
    fn resolve_torrent_output_folder_skips_without_meaningful_name() {
        let req = AddTorrentRequest {
            magnet: Some(
                "magnet:?xt=urn:btih:0123456789abcdef0123456789abcdef01234567".to_string(),
            ),
            torrent_b64: None,
            name_hint: None,
            save_path: None,
            start_paused: false,
        };
        let dir = std::env::temp_dir().join("orc-torrent-test-empty-folder");
        assert_eq!(
            resolve_torrent_output_folder(&dir, &req, "0123456789abcdef0123456789abcdef01234567"),
            None
        );
    }

    #[test]
    fn resolve_torrent_output_folder_uses_sanitized_name() {
        let req = AddTorrentRequest {
            magnet: Some(
                "magnet:?xt=urn:btih:0123456789abcdef0123456789abcdef01234567&dn=Ubuntu+24.04"
                    .to_string(),
            ),
            torrent_b64: None,
            name_hint: None,
            save_path: None,
            start_paused: false,
        };
        let dir = std::env::temp_dir();
        let folder =
            resolve_torrent_output_folder(&dir, &req, "0123456789abcdef0123456789abcdef01234567")
                .expect("folder");
        assert_eq!(folder, dir.join("Ubuntu 24.04"));
    }

    #[test]
    fn resolve_torrent_name_prefers_meaningful_hint() {
        let req = AddTorrentRequest {
            magnet: Some(
                "magnet:?xt=urn:btih:0123456789abcdef0123456789abcdef01234567&dn=From+Magnet"
                    .to_string(),
            ),
            torrent_b64: None,
            name_hint: Some("Movie Title".to_string()),
            save_path: None,
            start_paused: false,
        };
        assert_eq!(
            resolve_torrent_name(&req, Some("Metadata Name"), "abc"),
            "Movie Title"
        );
    }

    #[test]
    fn resolve_torrent_name_ignores_generic_hint() {
        let req = AddTorrentRequest {
            magnet: Some(
                "magnet:?xt=urn:btih:0123456789abcdef0123456789abcdef01234567&dn=From+Magnet"
                    .to_string(),
            ),
            torrent_b64: None,
            name_hint: Some("magnet".to_string()),
            save_path: None,
            start_paused: false,
        };
        assert_eq!(
            resolve_torrent_name(
                &req,
                Some("Metadata Name"),
                "0123456789abcdef0123456789abcdef01234567"
            ),
            "Metadata Name"
        );
    }

    #[test]
    fn resolve_torrent_name_falls_back_to_dn() {
        let req = AddTorrentRequest {
            magnet: Some(
                "magnet:?xt=urn:btih:0123456789abcdef0123456789abcdef01234567&dn=Ubuntu+24.04"
                    .to_string(),
            ),
            torrent_b64: None,
            name_hint: Some("magnet".to_string()),
            save_path: None,
            start_paused: false,
        };
        assert_eq!(
            resolve_torrent_name(&req, None, "0123456789abcdef0123456789abcdef01234567"),
            "Ubuntu 24.04"
        );
    }

    #[test]
    fn resolve_torrent_name_hash_fallback() {
        let req = AddTorrentRequest {
            magnet: Some(
                "magnet:?xt=urn:btih:0123456789abcdef0123456789abcdef01234567".to_string(),
            ),
            torrent_b64: None,
            name_hint: None,
            save_path: None,
            start_paused: false,
        };
        assert_eq!(
            resolve_torrent_name(&req, None, "0123456789abcdef0123456789abcdef01234567"),
            "torrent-01234567"
        );
    }

    #[test]
    fn sanitize_fs_name_replaces_invalid_chars() {
        assert_eq!(sanitize_fs_name("Movie: Name*?"), "Movie_ Name__");
    }

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
        let resp = PeersResponse { peers: vec![row] };
        let json = serde_json::to_value(&resp).expect("PeersResponse must serialize");
        let obj = json.as_object().expect("root must be object");
        let peers = obj
            .get("peers")
            .and_then(|p| p.as_array())
            .expect("must have peers array");
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
        let peers = json
            .get("peers")
            .and_then(|p| p.as_array())
            .expect("must have peers");
        assert!(peers.is_empty());
    }

    fn test_patterns() -> (Vec<Regex>, Vec<(Regex, ConnectionType)>) {
        let exclude_patterns = vec![
            Regex::new(r"(?i)^(lo|loopback|eth|wlan|wifi|ethernet|local|bridge|docker|veth)")
                .unwrap(),
            Regex::new(r"(?i)(bluetooth|pan|wwan)").unwrap(),
        ];
        let vpn_patterns = vec![
            (Regex::new(r"(?i)^(nordlynx|nordvpn|mullvad|proton|expressvpn|surfshark|cyberghost|tailscale|wintun)").unwrap(), ConnectionType::Vpn),
            (Regex::new(r"(?i)(private.*internet|pia\b)").unwrap(), ConnectionType::Vpn),
            (Regex::new(r"(?i)^(openvpn|wireguard)").unwrap(), ConnectionType::Vpn),
            (Regex::new(r"^tun\d+").unwrap(), ConnectionType::Vpn),
            (Regex::new(r"^tap\d+").unwrap(), ConnectionType::Vpn),
            (Regex::new(r"^wg\d+").unwrap(), ConnectionType::Vpn),
            (Regex::new(r"(?i)^.*tunnel.*$").unwrap(), ConnectionType::Vpn),
            (Regex::new(r"^ppp\d+").unwrap(), ConnectionType::Vpn),
        ];
        (exclude_patterns, vpn_patterns)
    }

    #[test]
    fn vpn_name_detection_matches_provider_and_tun() {
        let (exclude_patterns, vpn_patterns) = test_patterns();
        #[cfg(target_os = "macos")]
        let utun_pattern = Regex::new(r"^utun\d+").unwrap();
        let result = interface_name_matches_vpn(
            "nordlynx0",
            &exclude_patterns,
            &vpn_patterns,
            #[cfg(target_os = "macos")]
            &utun_pattern,
        );
        assert!(matches!(result, Some(ConnectionType::Vpn)));
    }

    #[test]
    fn vpn_name_detection_excludes_non_vpn_interfaces() {
        let (exclude_patterns, vpn_patterns) = test_patterns();
        #[cfg(target_os = "macos")]
        let utun_pattern = Regex::new(r"^utun\d+").unwrap();
        let result = interface_name_matches_vpn(
            "en0",
            &exclude_patterns,
            &vpn_patterns,
            #[cfg(target_os = "macos")]
            &utun_pattern,
        );
        assert!(result.is_none());
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn mac_utun_not_detected_without_opt_in() {
        let (exclude_patterns, vpn_patterns) = test_patterns();
        let utun_pattern = Regex::new(r"^utun\d+").unwrap();
        unsafe { std::env::remove_var("ORC_VPN_ALLOW_UTUN") };
        let result =
            interface_name_matches_vpn("utun3", &exclude_patterns, &vpn_patterns, &utun_pattern);
        assert!(result.is_none());
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn mac_route_output_parses_default_interface() {
        fn parse_iface(s: &str) -> Option<String> {
            for line in s.lines() {
                let trimmed = line.trim();
                if let Some(rest) = trimmed.strip_prefix("interface:") {
                    let iface = rest.trim();
                    if !iface.is_empty() {
                        return Some(iface.to_string());
                    }
                }
            }
            None
        }
        let sample = "route to: default\n destination: default\n       mask: default\n    gateway: 10.0.0.1\n  interface: utun4\n";
        assert_eq!(parse_iface(sample).as_deref(), Some("utun4"));
    }

    fn test_torrent_runtime() -> TorrentRuntime {
        TorrentRuntime {
            rqbit_id: 0,
            total_bytes: 0,
            downloaded_bytes: 0,
            uploaded_bytes: 0,
            running: false,
            state: TorrentState::Stopped,
            down_rate_bps: 0,
            up_rate_bps: 0,
            peers_seen: 0,
            files: Vec::new(),
            last_error: None,
            trackers: Vec::new(),
            tracker_state: HashMap::new(),
            peer_samples: HashMap::new(),
            state_override: None,
            last_sample: Instant::now(),
            last_downloaded_bytes: 0,
            last_uploaded_bytes: 0,
            heartbeat_samples: Vec::new(),
            heartbeat_last_sample: Instant::now(),
            heartbeat_last_bytes: 0,
            total_pieces_estimate: 0,
            piece_availability: Vec::new(),
            peer_progress_cache: HashMap::new(),
            seeding_started_at_ms: None,
        }
    }

    use std::sync::atomic::{AtomicU16, Ordering};

    static TEST_PORT: AtomicU16 = AtomicU16::new(25000);

    fn next_test_port() -> u16 {
        TEST_PORT.fetch_add(1, Ordering::SeqCst)
    }

    #[tokio::test]
    async fn find_torrent_by_info_hash_is_case_insensitive() {
        let dir = std::env::temp_dir().join(format!("orc-dup-test-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let state = new_state(dir.to_string_lossy().to_string(), next_test_port(), None)
            .await
            .unwrap();
        let mut guard = state.lock().await;
        let hash = "0123456789abcdef0123456789abcdef01234567";
        guard.torrents.insert(
            "t1".into(),
            TorrentRecord {
                torrent: Torrent {
                    id: "t1".into(),
                    name: "test".into(),
                    added_at_ms: 0,
                    running: false,
                    profile: TorrentProfile {
                        mode: TorrentMode::Standard,
                        hops: 0,
                    },
                    info_hash_hex: Some(hash.to_string()),
                    save_path: None,
                    seeding_override: None,
                },
                runtime: test_torrent_runtime(),
            },
        );
        assert!(find_torrent_by_info_hash(&guard, &hash.to_uppercase()).is_some());
    }

    #[tokio::test]
    async fn vpn_safety_preset_enables_defaults() {
        let dir = std::env::temp_dir().join(format!("orc-vpn-test-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let state = new_state(dir.to_string_lossy().to_string(), next_test_port(), None)
            .await
            .unwrap();
        let mut guard = state.lock().await;
        let result = apply_vpn_safety_preset_with_vpn(&mut guard, None);
        assert!(result.changed.iter().any(|c| c.contains("kill switch")));
        assert!(result.changed.iter().any(|c| c.contains("leak protection")));
        assert!(guard.kill_switch.enabled);
        assert!(guard.leak_proof_enabled);
    }

    #[tokio::test]
    async fn vpn_safety_preset_idempotent_when_already_active() {
        let dir = std::env::temp_dir().join(format!("orc-vpn-idem-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let state = new_state(dir.to_string_lossy().to_string(), next_test_port(), None)
            .await
            .unwrap();
        let mut guard = state.lock().await;
        let _ = apply_vpn_safety_preset_with_vpn(&mut guard, None);
        let result = apply_vpn_safety_preset_with_vpn(&mut guard, None);
        assert!(result.changed.is_empty());
    }

    #[tokio::test]
    async fn vpn_safety_preset_sets_bind_interface_when_vpn_detected() {
        let dir = std::env::temp_dir().join(format!("orc-vpn-bind-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let state = new_state(dir.to_string_lossy().to_string(), next_test_port(), None)
            .await
            .unwrap();
        let mut guard = state.lock().await;
        let result = apply_vpn_safety_preset_with_vpn(&mut guard, Some("utun4".into()));
        assert!(result.changed.iter().any(|c| c.contains("utun4")));
        assert_eq!(guard.bind_interface.as_deref(), Some("utun4"));
    }
}
