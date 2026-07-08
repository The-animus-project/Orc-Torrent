// Shared TypeScript types for the Orc Torrent UI

export type TorrentMode = "standard" | "private" | "anonymous" | "tor_assist";

export interface Torrent {
  id: string;
  name: string;
  added_at_ms: number;
  running: boolean;
  profile: { mode: TorrentMode; hops: number };
  /** BitTorrent infohash (20-byte SHA1) as hex. Present once metainfo resolved. */
  info_hash_hex?: string | null;
  /** Save directory for this torrent (download_dir / sanitized name). */
  save_path?: string | null;
}

export interface TorrentStatus {
  id: string;
  state: "stopped" | "downloading" | "seeding" | "checking" | "error";
  progress: number;
  down_rate_bps: number;
  up_rate_bps: number;
  eta_sec: number;
  total_bytes: number;
  downloaded_bytes: number;
  uploaded_bytes?: number;
  ratio?: number | null;
  peers_seen: number;
  error?: string; // Error message when state is "error"
  // TODO: Add seeds tracking when backend supports it
}

// Row snapshot for dual-signal UI component (pieces strip + heartbeat bar)
export interface TorrentRowSnapshot {
  progress: number;
  state: "stopped" | "downloading" | "seeding" | "checking" | "error";
  pieces_bins: PieceBin[];
  heartbeat_samples: number[]; // bytes/sec per sample
}

export interface PieceBin {
  have_ratio: number; // 0.0-1.0, fraction of pieces in bin we have
  min_avail: number; // Minimum availability in bin (for missing pieces)
  pieces_in_bin: number; // Number of pieces this bin represents
}

export interface WalletStatus {
  allowance_bytes_remaining: number;
  balance_credits: number;
}

export interface Circuit {
  id: string;
  hops: number;
  healthy: boolean;
  rtt_ms: number;
}

export interface OverlayStatus {
  enabled: boolean;
  circuits: Circuit[];
}

export type VpnPostureState = "connected" | "disconnected" | "unknown" | "checking";
export type KillSwitchState = "disarmed" | "armed" | "engaged" | "releasing";
export type KillSwitchScope = "torrent_only" | "app_level";

export interface VpnSignals {
  adapter_match: boolean;
  default_route_match: boolean;
  dns_match: boolean;
  public_ip_match: boolean | null;
}

export type ConnectionType = "vpn" | "tor" | "i2p" | "non_vpn";

export interface VpnStatus {
  posture: VpnPostureState;
  interface: string | null;
  default_route_interface: string | null;
  dns_servers: string[];
  signals: VpnSignals;
  last_check_ms: number;
  connection_type: ConnectionType;
  public_ip: string | null;
  // Legacy compatibility
  detected?: boolean;
  interfaceName?: string | null;
}

export interface VpnSource {
  auto_detect: boolean;
  allowed_adapters: string[];
}

export interface KillSwitchTriggers {
  pause_all_torrents: boolean;
  stop_seeding: boolean;
  disable_dht_pex_lpd: boolean;
  block_outbound: boolean;
}

export interface KillSwitchConfig {
  enabled: boolean;
  scope: KillSwitchScope;
  vpn_source: VpnSource;
  grace_period_sec: number;
  triggers: KillSwitchTriggers;
  enforcement_state: KillSwitchState;
  last_enforcement_ms: number | null;
}

export interface NetPosture {
  bind_interface: string | null;
  leak_proof_enabled: boolean;
  state: "unconfigured" | "protected" | "leak_risk";
  last_change_ms: number;
  vpn_status: VpnStatus;
  kill_switch: KillSwitchConfig;
}

export interface NetworkAdapter {
  name: string;
  interface_type: string;
  status: string;
  gateway: string | null;
  is_default_route: boolean;
  is_vpn: boolean;
}

export interface DefaultRoute {
  interface: string | null;
  gateway: string | null;
  metric: number | null;
  last_update_ms: number;
}

export interface DnsConfig {
  primary: string | null;
  secondary: string | null;
  source: string;
}

export type TorStatusState = "disconnected" | "connecting" | "connected" | "error";
export type TorSource = "embedded" | "external";

export interface TorState {
  status: TorStatusState;
  socks_addr: string | null;
  source: TorSource | { external: { socks_addr: string } };
  last_check_ms: number;
  error?: string;
}

export interface Health {
  ok: boolean;
  uptime_sec: number;
}

export interface Version {
  version: string;
}

export interface TorrentListResponse {
  items: Torrent[];
}

export interface SearchProviderInfo {
  name: string;
  label: string;
  enabled: boolean;
  configured: boolean;
  is_custom: boolean;
  supports_browse: boolean;
  feed_url?: string | null;
  provider_format?: SearchProviderFormat | null;
  categories: string[];
  requires_feed_url: boolean;
  description: string;
}

export type SearchProviderFormat = "open_content_json" | "rss_atom";

export interface SearchFeatureSettings {
  enabled: boolean;
  default_provider: string | null;
  default_result_limit: number;
  allow_private_remote_urls: boolean;
  providers: SearchProviderInfo[];
  safety_note: string;
}

export interface SearchProviderSetting {
  name: string;
  enabled: boolean;
  label?: string | null;
  feed_url?: string | null;
  format?: SearchProviderFormat;
  categories?: string[];
}

export interface SearchSettingsPatchRequest {
  enabled?: boolean;
  default_provider?: string;
  default_result_limit?: number;
  allow_private_remote_urls?: boolean;
  providers?: SearchProviderSetting[];
}

export interface SearchQueryRequest {
  query: string;
  category?: string | null;
  limit?: number | null;
  source?: string | null;
}

export interface SearchResult {
  id: string;
  source: string;
  name: string;
  size_bytes?: number | null;
  seeders?: number | null;
  leechers?: number | null;
  magnet_uri?: string | null;
  torrent_url?: string | null;
  description_url?: string | null;
  published_at?: string | null;
  category?: string | null;
}

export interface SearchProviderStatus {
  name: string;
  label: string;
  configured: boolean;
  ok: boolean;
  result_count: number;
  error?: string | null;
}

export interface SearchResponse {
  results: SearchResult[];
  providers: SearchProviderStatus[];
  browse_mode: boolean;
}

export interface Toast {
  kind: "error" | "info";
  msg: string;
}

export interface ActionToastNotification {
  kind: "error" | "info";
  msg: string;
  actionLabel: string;
  onAction: () => void | Promise<void>;
}

export interface StatusToastNotification {
  phase: "loading" | "success" | "error";
  msg: string;
  detail?: string;
}

// Event History types
export type EventType =
  | "disk_io"
  | "hash_failure"
  | "tracker_error"
  | "vpn_kill_switch"
  | "piece_verified"
  | "torrent_added"
  | "torrent_completed"
  | "torrent_error"
  | "torrent_started"
  | "torrent_stopped"
  | "peer_connected"
  | "peer_disconnected";

export type EventSeverity = "info" | "warning" | "error" | "success";

export interface TorrentEvent {
  id: string;
  timestamp: number;
  type: EventType;
  severity: EventSeverity;
  torrentId?: string;
  torrentName?: string;
  message: string;
  details?: Record<string, unknown>;
}

// Re-export policy types
export * from "./policy";

export type RiskState = "protected" | "warning" | "blocked" | "unknown";

export interface PrivacyStatus {
  vpn_detected: boolean;
  vpn_interface?: string | null;
  bind_interface?: string | null;
  kill_switch_enabled: boolean;
  kill_switch_engaged: boolean;
  network_allowed: boolean;
  dht_enabled: boolean;
  pex_enabled: boolean;
  lsd_enabled: boolean;
  public_ip?: string | null;
  risk_state: RiskState;
  reason: string;
}

export interface PrivacyPresetResult {
  changed: string[];
  privacy_status: PrivacyStatus;
}

export type BandwidthProfile = "normal" | "limited";

export interface BandwidthSettings {
  normal_download_bps?: number | null;
  normal_upload_bps?: number | null;
  limited_download_bps?: number | null;
  limited_upload_bps?: number | null;
  schedule_enabled: boolean;
  schedule_start: string;
  schedule_end: string;
  schedule_days: number[];
}

export interface SessionLimitsResponse {
  download_bps?: number | null;
  upload_bps?: number | null;
  active_profile: BandwidthProfile;
  bandwidth: BandwidthSettings;
}

export type SeedingAction = "stop_torrent";

export interface SeedingSettings {
  ratio_limit_enabled: boolean;
  ratio_limit: number;
  seed_time_limit_enabled: boolean;
  seed_time_minutes: number;
  action: SeedingAction;
}

export interface WatchFolderEntry {
  id: string;
  enabled: boolean;
  folder_path: string;
  default_save_path?: string | null;
  auto_start: boolean;
  delete_after_import: boolean;
  archive_folder?: string | null;
}

export interface WatchFolderSettings {
  enabled: boolean;
  folders: WatchFolderEntry[];
}

export type WatchImportStatus = "success" | "duplicate" | "error";

export interface WatchImportEvent {
  at_ms: number;
  folder_path: string;
  torrent_path: string;
  torrent_id?: string | null;
  status: WatchImportStatus;
  message: string;
}

export interface WatchFoldersResponse {
  settings: WatchFolderSettings;
  events: WatchImportEvent[];
}
