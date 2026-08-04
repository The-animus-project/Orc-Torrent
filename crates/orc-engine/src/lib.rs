//! ORC-owned boundary around the embedded BitTorrent implementation.
//!
//! The implementation is currently derived from librqbit. Consumers must use
//! this crate rather than depending on that backend directly so ORC can evolve
//! its engine, persistence, transports, and policy independently.

use std::{
    collections::HashMap,
    ops::Deref,
    path::{Path, PathBuf},
    sync::{Arc, RwLock},
};

use librqbit::api::Api;
use serde::{Deserialize, Serialize};

pub use librqbit::{
    AddTorrent, AddTorrentOptions, ConnectionOptions, ListenerMode, ListenerOptions, Session,
    SessionOptions, SessionPersistenceConfig,
};
pub use orc_mse::{PeerTrafficMode, TrafficProtection};
pub use orc_scheduler::{PeerMetrics as PeerSchedulerMetrics, SchedulerMode};

pub mod api {
    pub use librqbit::api::{ApiAddTorrentResponse, PeerStatsFilter, TorrentIdOrHash};
}

pub mod storage {
    use std::{
        io::IoSlice,
        path::{Path, PathBuf},
    };

    #[derive(Debug, Clone)]
    pub struct TorrentDescriptor {
        pub output_folder: PathBuf,
        pub allow_overwrite: bool,
    }

    #[derive(Debug, Clone)]
    pub struct FileDescriptor {
        pub relative_filename: PathBuf,
        pub length: u64,
        pub padding: bool,
    }

    #[derive(Debug, Clone, Default)]
    pub struct TorrentMetadata {
        pub files: Vec<FileDescriptor>,
    }

    pub trait StorageFactory: Send + Sync {
        fn create(
            &self,
            torrent: &TorrentDescriptor,
            metadata: &TorrentMetadata,
        ) -> anyhow::Result<Box<dyn TorrentStorage>>;

        fn clone_box(&self) -> BoxStorageFactory;
    }

    pub type BoxStorageFactory = Box<dyn StorageFactory>;

    impl Clone for BoxStorageFactory {
        fn clone(&self) -> Self {
            self.clone_box()
        }
    }

    pub trait StorageFactoryExt: StorageFactory + Sized + 'static {
        fn boxed(self) -> BoxStorageFactory {
            Box::new(self)
        }
    }

    impl<T: StorageFactory + Sized + 'static> StorageFactoryExt for T {}

    pub trait TorrentStorage: Send + Sync {
        fn init(
            &mut self,
            torrent: &TorrentDescriptor,
            metadata: &TorrentMetadata,
        ) -> anyhow::Result<()>;
        fn pread_exact(&self, file_id: usize, offset: u64, buf: &mut [u8]) -> anyhow::Result<()>;
        fn pwrite_all(&self, file_id: usize, offset: u64, buf: &[u8]) -> anyhow::Result<()>;
        fn pwrite_all_vectored(
            &self,
            file_id: usize,
            offset: u64,
            bufs: [IoSlice<'_>; 2],
        ) -> anyhow::Result<usize> {
            let mut offset = offset;
            let mut size = 0;
            for slice in bufs {
                self.pwrite_all(file_id, offset, &slice)?;
                offset += slice.len() as u64;
                size += slice.len();
            }
            Ok(size)
        }
        fn remove_file(&self, file_id: usize, filename: &Path) -> anyhow::Result<()>;
        fn remove_directory_if_empty(&self, path: &Path) -> anyhow::Result<()>;
        fn ensure_file_length(&self, file_id: usize, length: u64) -> anyhow::Result<()>;
        fn take(&self) -> anyhow::Result<Box<dyn TorrentStorage>>;
    }

    fn descriptors(
        shared: &librqbit::ManagedTorrentShared,
        metadata: &librqbit::TorrentMetadata,
    ) -> (TorrentDescriptor, TorrentMetadata) {
        (
            TorrentDescriptor {
                output_folder: shared.output_folder().to_path_buf(),
                allow_overwrite: shared.allow_overwrite(),
            },
            TorrentMetadata {
                files: metadata
                    .file_infos
                    .iter()
                    .map(|file| FileDescriptor {
                        relative_filename: file.relative_filename.clone(),
                        length: file.len,
                        padding: file.attrs.padding,
                    })
                    .collect(),
            },
        )
    }

    struct BackendStorageFactory {
        inner: BoxStorageFactory,
    }

    impl librqbit::storage::StorageFactory for BackendStorageFactory {
        type Storage = BackendTorrentStorage;

        fn create(
            &self,
            shared: &librqbit::ManagedTorrentShared,
            metadata: &librqbit::TorrentMetadata,
        ) -> anyhow::Result<Self::Storage> {
            let (torrent, metadata) = descriptors(shared, metadata);
            Ok(BackendTorrentStorage {
                inner: self.inner.create(&torrent, &metadata)?,
            })
        }

        fn clone_box(&self) -> librqbit::storage::BoxStorageFactory {
            use librqbit::storage::StorageFactoryExt as _;
            Self {
                inner: self.inner.clone(),
            }
            .boxed()
        }
    }

    struct BackendTorrentStorage {
        inner: Box<dyn TorrentStorage>,
    }

    impl librqbit::storage::TorrentStorage for BackendTorrentStorage {
        fn init(
            &mut self,
            shared: &librqbit::ManagedTorrentShared,
            metadata: &librqbit::TorrentMetadata,
        ) -> anyhow::Result<()> {
            let (torrent, metadata) = descriptors(shared, metadata);
            self.inner.init(&torrent, &metadata)
        }

        fn pread_exact(&self, file_id: usize, offset: u64, buf: &mut [u8]) -> anyhow::Result<()> {
            self.inner.pread_exact(file_id, offset, buf)
        }

        fn pwrite_all(&self, file_id: usize, offset: u64, buf: &[u8]) -> anyhow::Result<()> {
            self.inner.pwrite_all(file_id, offset, buf)
        }

        fn pwrite_all_vectored(
            &self,
            file_id: usize,
            offset: u64,
            bufs: [IoSlice<'_>; 2],
        ) -> anyhow::Result<usize> {
            self.inner.pwrite_all_vectored(file_id, offset, bufs)
        }

        fn remove_file(&self, file_id: usize, filename: &Path) -> anyhow::Result<()> {
            self.inner.remove_file(file_id, filename)
        }

        fn remove_directory_if_empty(&self, path: &Path) -> anyhow::Result<()> {
            self.inner.remove_directory_if_empty(path)
        }

        fn ensure_file_length(&self, file_id: usize, length: u64) -> anyhow::Result<()> {
            self.inner.ensure_file_length(file_id, length)
        }

        fn take(&self) -> anyhow::Result<Box<dyn librqbit::storage::TorrentStorage>> {
            Ok(Box::new(Self {
                inner: self.inner.take()?,
            }))
        }
    }

    /// Install an ORC storage factory into the private backend options.
    pub fn install(factory: &BoxStorageFactory, options: &mut super::SessionOptions) {
        use librqbit::storage::StorageFactoryExt as _;
        options.default_storage_factory = Some(
            BackendStorageFactory {
                inner: factory.clone(),
            }
            .boxed(),
        );
    }
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum EngineMode {
    #[default]
    Auto,
    Legacy,
    Modern,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct TransportPolicy {
    #[serde(default = "default_true")]
    pub tcp: bool,
    #[serde(default)]
    pub utp: bool,
    #[serde(default = "default_true")]
    pub ipv4: bool,
    #[serde(default)]
    pub ipv6: bool,
}

impl Default for TransportPolicy {
    fn default() -> Self {
        Self {
            tcp: true,
            utp: false,
            ipv4: true,
            ipv6: false,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct DiscoveryPolicy {
    #[serde(default = "default_true")]
    pub dht: bool,
    #[serde(default = "default_true")]
    pub pex: bool,
    #[serde(default)]
    pub lsd: bool,
}

impl Default for DiscoveryPolicy {
    fn default() -> Self {
        Self {
            dht: true,
            pex: true,
            lsd: false,
        }
    }
}

const fn default_true() -> bool {
    true
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct EngineNetworkPolicy {
    #[serde(default)]
    pub mode: EngineMode,
    #[serde(default)]
    pub transports: TransportPolicy,
    #[serde(default)]
    pub discovery: DiscoveryPolicy,
    #[serde(default)]
    pub strict_binding: bool,
    #[serde(default)]
    pub request_scheduler: SchedulerMode,
}

impl Default for EngineNetworkPolicy {
    fn default() -> Self {
        Self {
            mode: EngineMode::Auto,
            ..Self::legacy()
        }
    }
}

impl EngineNetworkPolicy {
    pub fn legacy() -> Self {
        Self {
            mode: EngineMode::Legacy,
            transports: TransportPolicy::default(),
            discovery: DiscoveryPolicy::default(),
            strict_binding: false,
            request_scheduler: SchedulerMode::Legacy,
        }
    }

    pub fn modern() -> Self {
        Self {
            mode: EngineMode::Modern,
            transports: TransportPolicy {
                tcp: true,
                utp: true,
                ipv4: true,
                ipv6: true,
            },
            discovery: DiscoveryPolicy {
                dht: true,
                pex: true,
                lsd: true,
            },
            strict_binding: false,
            request_scheduler: SchedulerMode::Legacy,
        }
    }

    pub fn hardened() -> Self {
        Self {
            mode: EngineMode::Modern,
            transports: TransportPolicy {
                tcp: true,
                utp: true,
                ipv4: true,
                ipv6: true,
            },
            discovery: DiscoveryPolicy {
                dht: false,
                pex: false,
                lsd: false,
            },
            strict_binding: false,
            request_scheduler: SchedulerMode::Legacy,
        }
    }

    /// During the beta release `auto` deliberately resolves to the legacy set.
    pub fn resolve_beta(self) -> Self {
        if self.mode == EngineMode::Auto {
            Self {
                mode: EngineMode::Auto,
                ..Self::legacy()
            }
        } else {
            self
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct CapabilityState {
    pub supported: bool,
    pub enabled: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
}

impl CapabilityState {
    fn available(enabled: bool) -> Self {
        Self {
            supported: true,
            enabled,
            reason: None,
        }
    }

    fn unavailable(reason: impl Into<String>) -> Self {
        Self {
            supported: false,
            enabled: false,
            reason: Some(reason.into()),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct TransportCapabilities {
    pub tcp: CapabilityState,
    pub utp: CapabilityState,
    pub ipv4: CapabilityState,
    pub ipv6: CapabilityState,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct DiscoveryCapabilities {
    pub dht: CapabilityState,
    pub pex: CapabilityState,
    pub lsd: CapabilityState,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SecurityCapabilities {
    pub peer_encryption: PeerEncryptionCapability,
    pub os_outbound_block: CapabilityState,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct TransferCapabilities {
    pub scheduler_mode: SchedulerMode,
    pub adaptive_supported: bool,
    pub fast_extension: bool,
    pub bounded_endgame_duplication: bool,
    pub benchmark_gate_required: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PeerEncryptionCapability {
    pub supported: bool,
    pub enabled: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
    pub requested_mode: PeerTrafficMode,
    pub effective_mode: PeerTrafficMode,
    pub explicit_consent: bool,
    pub tcp_protected: bool,
    pub utp_protected: bool,
    pub utp_disabled_by_require: bool,
    pub require_enforced: bool,
    pub live_rc4_peers: u32,
    pub live_plaintext_peers: u32,
    pub attempts: u64,
    pub successes: u64,
    pub fallbacks: u64,
    pub rejections: u64,
    pub malformed_handshakes: u64,
    pub timeouts: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct EngineCapabilities {
    pub name: String,
    pub api_version: u32,
    pub implementation_version: String,
    pub lineage: String,
    pub mode: EngineMode,
    pub transports: TransportCapabilities,
    pub discovery: DiscoveryCapabilities,
    pub security: SecurityCapabilities,
    pub transfer: TransferCapabilities,
    pub persistence_enabled: bool,
    pub network_suspended: bool,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub degraded_reasons: Vec<String>,
}

/// Stable ORC representation of the transfer counters used by core and UI.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct TorrentStatsSnapshot {
    pub state: String,
    pub file_progress: Vec<u64>,
    pub error: Option<String>,
    pub progress_bytes: u64,
    pub uploaded_bytes: u64,
    pub total_bytes: u64,
    pub finished: bool,
}

/// Stable ORC representation of the backend's per-peer counters.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PeerSnapshot {
    pub downloaded_bytes: u64,
    pub uploaded_bytes: u64,
    pub state: String,
    pub connection_kind: Option<String>,
    pub traffic_protection: Option<TrafficProtection>,
    pub incoming: bool,
    pub request_rtt_ms: Option<u64>,
    pub goodput_bytes_per_second: u64,
    pub choke_events: u64,
    pub choke_rate: f64,
    pub reject_events: u64,
    pub reject_rate: f64,
    pub timeout_events: u64,
    pub consecutive_timeouts: u32,
    pub available_pieces: u32,
    pub total_pieces: u32,
    pub outstanding_bytes: u64,
    pub outstanding_requests: u32,
    pub target_pipeline_requests: u32,
    pub stalled_reassignments: u64,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct PeerStatsSnapshot {
    pub peers: HashMap<String, PeerSnapshot>,
}

#[derive(Deserialize)]
struct CompatibleSessionDatabase {
    torrents: HashMap<String, CompatiblePersistedTorrent>,
}

#[derive(Deserialize)]
struct CompatiblePersistedTorrent {
    info_hash: String,
    trackers: Vec<String>,
    output_folder: PathBuf,
    only_files: Option<Vec<usize>>,
    is_paused: bool,
}

/// Read-only compatibility gate for the v8/v9 JSON persistence shape.
/// Call this before constructing a session so malformed or unknown state is
/// rejected before the backend has an opportunity to flush it.
pub fn validate_persistence_directory(directory: &Path) -> anyhow::Result<()> {
    let session_file = directory.join("session.json");
    let bytes = match std::fs::read(&session_file) {
        Ok(bytes) => bytes,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(error) => return Err(error.into()),
    };
    let database: CompatibleSessionDatabase = serde_json::from_slice(&bytes).map_err(|error| {
        anyhow::anyhow!(
            "incompatible session file {}: {error}",
            session_file.display()
        )
    })?;
    for (id, torrent) in database.torrents {
        id.parse::<usize>()
            .map_err(|_| anyhow::anyhow!("invalid persisted torrent id {id}"))?;
        if torrent.info_hash.len() != 40
            || !torrent
                .info_hash
                .bytes()
                .all(|value| value.is_ascii_hexdigit())
        {
            anyhow::bail!("invalid persisted info hash for torrent {id}");
        }
        let _ = (
            torrent.trackers,
            torrent.output_folder,
            torrent.only_files,
            torrent.is_paused,
        );
    }
    Ok(())
}

#[derive(Debug, Clone)]
struct RuntimeState {
    policy: EngineNetworkPolicy,
    persistence_enabled: bool,
    network_suspended: bool,
    degraded_reasons: Vec<String>,
    requested_peer_traffic_mode: PeerTrafficMode,
    peer_encryption_opt_in: bool,
    utp_requested: bool,
}

/// Cloneable ORC engine handle. Backend-specific access stays inside this crate.
#[derive(Clone)]
pub struct Engine {
    api: Api,
    runtime: Arc<RwLock<RuntimeState>>,
}

impl Engine {
    pub fn new(session: Arc<Session>, persistence_enabled: bool) -> Self {
        let peer_traffic_mode = session.peer_traffic_mode();
        let utp_enabled = session.utp_enabled();
        Self {
            api: Api::new(session, None),
            runtime: Arc::new(RwLock::new(RuntimeState {
                policy: EngineNetworkPolicy::legacy(),
                persistence_enabled,
                network_suspended: false,
                degraded_reasons: Vec::new(),
                requested_peer_traffic_mode: peer_traffic_mode,
                peer_encryption_opt_in: !matches!(peer_traffic_mode, PeerTrafficMode::Off),
                utp_requested: utp_enabled,
            })),
        }
    }

    pub fn session(&self) -> &Arc<Session> {
        self.api.session()
    }

    pub fn set_network_policy(&self, policy: EngineNetworkPolicy) {
        if let Ok(mut runtime) = self.runtime.write() {
            runtime.policy = policy.resolve_beta();
        }
    }

    pub fn set_peer_traffic_policy(
        &self,
        requested_mode: PeerTrafficMode,
        explicit_consent: bool,
        utp_requested: bool,
    ) {
        if let Ok(mut runtime) = self.runtime.write() {
            runtime.requested_peer_traffic_mode = requested_mode;
            runtime.peer_encryption_opt_in = explicit_consent;
            runtime.utp_requested = utp_requested;
        }
    }

    pub fn network_policy(&self) -> EngineNetworkPolicy {
        self.runtime
            .read()
            .map(|s| s.policy.clone())
            .unwrap_or_default()
    }

    pub fn set_network_suspended(&self, suspended: bool) {
        if let Ok(mut runtime) = self.runtime.write() {
            runtime.network_suspended = suspended;
        }
    }

    pub fn is_network_suspended(&self) -> bool {
        self.runtime
            .read()
            .map(|s| s.network_suspended)
            .unwrap_or(true)
    }

    pub fn set_degraded_reason(&self, reason: Option<String>) {
        if let Ok(mut runtime) = self.runtime.write() {
            runtime.degraded_reasons.clear();
            if let Some(reason) = reason {
                runtime.degraded_reasons.push(reason);
            }
        }
    }

    pub fn runtime_degraded_reason(&self) -> Option<String> {
        if self.is_network_suspended() {
            return None;
        }
        let policy = self.network_policy();
        let session = self.api.session();
        let mut missing = Vec::new();
        if policy.transports.tcp && !session.tcp_enabled() {
            missing.push("TCP");
        }
        if policy.transports.utp && !session.utp_enabled() {
            missing.push("uTP");
        }
        if policy.transports.ipv6 && !session.ipv6_enabled() {
            missing.push("IPv6");
        }
        if policy.discovery.dht && !session.dht_enabled() {
            missing.push("DHT");
        }
        if policy.discovery.pex && !session.pex_enabled() {
            missing.push("PEX");
        }
        if policy.discovery.lsd && !session.lsd_enabled() {
            missing.push("LSD");
        }
        (!missing.is_empty()).then(|| {
            format!(
                "requested engine features unavailable at runtime: {}",
                missing.join(", ")
            )
        })
    }

    pub fn capabilities(&self) -> EngineCapabilities {
        let runtime = self.runtime.read().ok();
        let policy = runtime
            .as_ref()
            .map(|s| s.policy.clone())
            .unwrap_or_default();
        let suspended = runtime
            .as_ref()
            .map(|s| s.network_suspended)
            .unwrap_or(true);
        let session = self.api.session();
        let effective_peer_mode = session.peer_traffic_mode();
        let mse = session.mse_stats();
        let session_stats = session.stats_snapshot();
        let requested_peer_mode = runtime
            .as_ref()
            .map(|state| state.requested_peer_traffic_mode)
            .unwrap_or_default();
        let explicit_consent = runtime
            .as_ref()
            .map(|state| state.peer_encryption_opt_in)
            .unwrap_or(false);
        EngineCapabilities {
            name: "ORC Engine".to_string(),
            api_version: 2,
            implementation_version: format!(
                "{} (backend {})",
                env!("CARGO_PKG_VERSION"),
                librqbit::version()
            ),
            lineage: "rqbit v9.0.0-beta.2-derived with ORC runtime patches".to_string(),
            mode: policy.mode,
            transports: TransportCapabilities {
                tcp: CapabilityState::available(session.tcp_enabled() && !suspended),
                utp: CapabilityState::available(session.utp_enabled() && !suspended),
                ipv4: CapabilityState::available(!suspended),
                ipv6: CapabilityState::available(session.ipv6_enabled() && !suspended),
            },
            discovery: DiscoveryCapabilities {
                dht: CapabilityState::available(session.dht_enabled() && !suspended),
                pex: CapabilityState::available(session.pex_enabled() && !suspended),
                lsd: CapabilityState::available(session.lsd_enabled() && !suspended),
            },
            security: SecurityCapabilities {
                peer_encryption: PeerEncryptionCapability {
                    supported: true,
                    enabled: !matches!(effective_peer_mode, PeerTrafficMode::Off),
                    reason: (!explicit_consent
                        && !matches!(requested_peer_mode, PeerTrafficMode::Off))
                    .then(|| "explicit consent is required before MSE/PE is enabled".to_string()),
                    requested_mode: requested_peer_mode,
                    effective_mode: effective_peer_mode,
                    explicit_consent,
                    tcp_protected: !matches!(effective_peer_mode, PeerTrafficMode::Off),
                    utp_protected: false,
                    utp_disabled_by_require: matches!(
                        effective_peer_mode,
                        PeerTrafficMode::Require
                    ) && runtime
                        .as_ref()
                        .is_some_and(|state| state.utp_requested),
                    require_enforced: matches!(effective_peer_mode, PeerTrafficMode::Require),
                    live_rc4_peers: session_stats.peers.live_mse_rc4,
                    live_plaintext_peers: session_stats.peers.live_plaintext,
                    attempts: mse.attempts,
                    successes: mse.successes,
                    fallbacks: mse.fallbacks,
                    rejections: mse.rejections,
                    malformed_handshakes: mse.malformed,
                    timeouts: mse.timeouts,
                },
                os_outbound_block: CapabilityState::unavailable(
                    "OS-wide outbound blocking requires a platform firewall integration",
                ),
            },
            transfer: TransferCapabilities {
                scheduler_mode: session.request_scheduler(),
                adaptive_supported: true,
                fast_extension: true,
                bounded_endgame_duplication: true,
                benchmark_gate_required: matches!(
                    session.request_scheduler(),
                    SchedulerMode::Legacy
                ),
            },
            persistence_enabled: runtime
                .as_ref()
                .map(|s| s.persistence_enabled)
                .unwrap_or(false),
            network_suspended: suspended,
            degraded_reasons: runtime
                .map(|s| s.degraded_reasons.clone())
                .unwrap_or_default(),
        }
    }

    pub fn torrent_stats(
        &self,
        torrent: api::TorrentIdOrHash,
    ) -> anyhow::Result<TorrentStatsSnapshot> {
        let stats = self.api.api_stats_v1(torrent)?;
        Ok(TorrentStatsSnapshot {
            state: stats.state.to_string(),
            file_progress: stats.file_progress,
            error: stats.error,
            progress_bytes: stats.progress_bytes,
            uploaded_bytes: stats.uploaded_bytes,
            total_bytes: stats.total_bytes,
            finished: stats.finished,
        })
    }

    pub fn peer_stats(&self, torrent: api::TorrentIdOrHash) -> anyhow::Result<PeerStatsSnapshot> {
        let snapshot = self
            .api
            .api_peer_stats(torrent, librqbit::api::PeerStatsFilter::default())?;
        let peers = snapshot
            .peers
            .into_iter()
            .map(|(address, peer)| {
                let incoming = peer.counters.incoming_connections > 0;
                (
                    address,
                    PeerSnapshot {
                        downloaded_bytes: peer.counters.fetched_bytes,
                        uploaded_bytes: peer.counters.uploaded_bytes,
                        state: peer.state.to_string(),
                        connection_kind: peer.conn_kind.map(|kind| kind.to_string()),
                        traffic_protection: peer.traffic_protection,
                        incoming,
                        request_rtt_ms: peer.counters.request_rtt_ms,
                        goodput_bytes_per_second: peer.counters.goodput_bytes_per_second,
                        choke_events: peer.counters.choke_events,
                        choke_rate: peer.counters.choke_rate,
                        reject_events: peer.counters.reject_events,
                        reject_rate: peer.counters.reject_rate,
                        timeout_events: peer.counters.timeout_events,
                        consecutive_timeouts: peer.counters.consecutive_timeouts,
                        available_pieces: peer.counters.available_pieces,
                        total_pieces: peer.counters.total_pieces,
                        outstanding_bytes: peer.counters.outstanding_bytes,
                        outstanding_requests: peer.counters.outstanding_requests,
                        target_pipeline_requests: peer.counters.target_pipeline_requests,
                        stalled_reassignments: peer.counters.stalled_reassignments,
                    },
                )
            })
            .collect();
        Ok(PeerStatsSnapshot { peers })
    }
}

impl Deref for Engine {
    type Target = Api;

    fn deref(&self) -> &Self::Target {
        &self.api
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn beta_auto_resolves_to_legacy_transports() {
        let resolved = EngineNetworkPolicy {
            mode: EngineMode::Auto,
            ..EngineNetworkPolicy::modern()
        }
        .resolve_beta();
        assert_eq!(resolved.mode, EngineMode::Auto);
        assert!(resolved.transports.tcp);
        assert!(!resolved.transports.utp);
        assert!(!resolved.transports.ipv6);
        assert!(resolved.discovery.dht);
        assert!(!resolved.discovery.lsd);
    }

    #[test]
    fn hardened_disables_discovery() {
        let policy = EngineNetworkPolicy::hardened();
        assert!(!policy.discovery.dht);
        assert!(!policy.discovery.pex);
        assert!(!policy.discovery.lsd);
        assert!(!policy.strict_binding);
    }

    #[test]
    fn empty_policy_json_preserves_legacy_client_compatibility() {
        let policy: EngineNetworkPolicy = serde_json::from_str("{}").expect("default policy");
        let resolved = policy.resolve_beta();
        assert_eq!(resolved.mode, EngineMode::Auto);
        assert_eq!(resolved.transports, TransportPolicy::default());
        assert_eq!(resolved.discovery, DiscoveryPolicy::default());
        assert_eq!(resolved.request_scheduler, SchedulerMode::Legacy);
    }

    #[test]
    fn adaptive_scheduler_requires_explicit_policy_selection() {
        let policy: EngineNetworkPolicy =
            serde_json::from_str(r#"{"request_scheduler":"adaptive"}"#)
                .expect("adaptive scheduler policy");
        assert_eq!(policy.request_scheduler, SchedulerMode::Adaptive);
        assert_eq!(
            EngineNetworkPolicy::default().request_scheduler,
            SchedulerMode::Legacy
        );
    }
}
