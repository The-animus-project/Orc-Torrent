mod config;
mod search;
mod watch_folders;

use std::path::{Component, Path as StdPath, PathBuf};
use std::{net::SocketAddr, sync::Arc, time::Duration};

use anyhow::Context as _;
#[cfg(feature = "desktop-search")]
use axum::routing::{delete, put};
use axum::{
    extract::{Path, Request, State},
    http::{header, HeaderMap, HeaderValue, Method, StatusCode},
    middleware::Next,
    response::IntoResponse,
    routing::{get, patch, post},
    Json, Router,
};
use subtle::ConstantTimeEq;
use tower::limit::ConcurrencyLimitLayer;
use tower_http::{
    cors::CorsLayer, limit::RequestBodyLimitLayer, set_header::SetResponseHeaderLayer,
    trace::TraceLayer,
};
use tracing::{error, info, warn};

use orc_core::{
    activate_engine_policy, apply_bandwidth_profile_limits, apply_net_posture_stored,
    apply_policy_stored, apply_stored_kill_switch, apply_vpn_safety_preset,
    build_add_torrent_options, drain_seeding_stop_pending, effective_engine_network_policy,
    effective_peer_traffic_mode, effective_seeding_policy, engine_api, engine_capabilities,
    engine_id_for, extract_info_hash_from_magnet, extract_info_hash_from_torrent_bytes,
    find_torrent_by_info_hash, get_content, get_kill_switch, get_policy, get_row_snapshot,
    get_status, get_torrent, health, integrate_added_torrent, list_torrents, mark_announce,
    media_download_policy_enabled, net_bind_interface, net_posture, net_posture_stored_from_state,
    network_session_disabled, network_transfers_allowed, new_state_with_runtime_policy,
    only_files_for, overlay_status, patch_bandwidth_settings, patch_kill_switch, patch_net_posture,
    patch_policy, patch_seeding_settings, patch_torrent_seeding_override, peers_for,
    policy_stored_from_state, prepare_add_input, privacy_status, rebind_engine_session,
    remove_torrent, resolve_torrent_output_folder, session_rate_limits_response, set_file_priority,
    set_profile, set_running, set_session_rate_limits, suspend_engine_network,
    take_network_rebind_required, tick, trackers_for, version, wallet_status, AddTorrentInput,
    AddTorrentRequest, BandwidthSettings, KillSwitchStoredSettings, NetworkStatusProvider,
    PatchFilePriorityRequest, PatchKillSwitchRequest, PatchNetPostureRequest, PatchPolicyRequest,
    PatchTorrentProfileRequest, SeedingSettings, SharedState,
};
use orc_engine::Engine;
use search::secrets::validate_api_key;
use search::{
    available_providers_with_secrets, create_default_secret_store, credential_ref_for_provider,
    execute_search_with_secrets, removed_provider_credential_refs,
    search_settings_response_with_secrets, test_torznab_provider, SearchExecutionContext,
    SearchHttpClient, SearchProviderFormat, SearchQuery, SearchSecretStore,
    SearchSettingsPatchRequest,
};
use serde::Deserialize;
use watch_folders::{PatchWatchFoldersRequest, TestWatchFolderRequest, WatchFolderManager};

#[derive(Clone)]
struct AppCtx {
    state: SharedState,
    config: Arc<tokio::sync::RwLock<config::DaemonConfig>>,
    config_file: PathBuf,
    shutdown: std::sync::Arc<tokio::sync::Notify>,
    watch_manager: Arc<WatchFolderManager>,
    download_dir: PathBuf,
    secrets: Arc<dyn SearchSecretStore>,
    /// Transient Torznab connection-test results (not persisted).
    connection_status: Arc<
        tokio::sync::RwLock<
            std::collections::HashMap<String, search::torznab::ProviderConnectionSnapshot>,
        >,
    >,
}

#[derive(Clone)]
struct ApiSecurity {
    admin_token: String,
    allowed_origin: HeaderValue,
}

#[derive(Debug, Deserialize)]
struct PutSearchCredentialsRequest {
    api_key: String,
}

/// Constant-time admin token check. An empty expected token is always denied.
fn admin_token_authorized(headers: &HeaderMap, expected: &str) -> bool {
    if expected.is_empty() {
        return false;
    }
    let provided = headers
        .get("x-admin-token")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");
    let provided_bytes = provided.as_bytes();
    let expected_bytes = expected.as_bytes();
    provided_bytes.len() == expected_bytes.len()
        && provided_bytes.ct_eq(expected_bytes).unwrap_u8() == 1
}

fn build_cors_layer(allowed_origin: HeaderValue) -> CorsLayer {
    CorsLayer::new()
        .allow_origin(allowed_origin)
        .allow_methods([
            Method::GET,
            Method::POST,
            Method::PUT,
            Method::PATCH,
            Method::DELETE,
            Method::OPTIONS,
        ])
        .allow_headers([
            header::CONTENT_TYPE,
            header::ACCEPT,
            header::HeaderName::from_static("x-admin-token"),
        ])
        .max_age(Duration::from_secs(600))
}

fn is_public_route(method: &Method, path: &str) -> bool {
    *method == Method::GET && matches!(path, "/health" | "/version")
}

fn request_requires_token(method: &Method, path: &str) -> bool {
    *method != Method::OPTIONS && !is_public_route(method, path)
}

fn origin_authorized(headers: &HeaderMap, expected: &HeaderValue) -> bool {
    headers.get(header::ORIGIN).is_some_and(|origin| {
        origin.as_bytes() == expected.as_bytes() && origin.as_bytes() != b"null"
    })
}

fn validate_torrent_id(id: &str) -> bool {
    if id.len() == 36 {
        let parts: Vec<&str> = id.split('-').collect();
        if parts.len() == 5
            && parts[0].len() == 8
            && parts[0].chars().all(|c| c.is_ascii_hexdigit())
            && parts[1].len() == 4
            && parts[1].chars().all(|c| c.is_ascii_hexdigit())
            && parts[2].len() == 4
            && parts[2].chars().all(|c| c.is_ascii_hexdigit())
            && parts[3].len() == 4
            && parts[3].chars().all(|c| c.is_ascii_hexdigit())
            && parts[4].len() == 12
            && parts[4].chars().all(|c| c.is_ascii_hexdigit())
        {
            return true;
        }
    } else if id.len() == 32 {
        return id.chars().all(|c| c.is_ascii_hexdigit());
    }
    false
}

async fn sync_media_download_policy(api: &Engine, torrent_id: &str, state: &SharedState) {
    if !media_download_policy_enabled() {
        return;
    }

    let (engine_id, only_files) = {
        let guard = state.lock().await;
        (
            engine_id_for(&guard, torrent_id),
            only_files_for(&guard, torrent_id),
        )
    };

    let (Some(engine_id), Some(only_files)) = (engine_id, only_files) else {
        return;
    };

    if only_files.is_empty() {
        return;
    }

    if let Err(error) = api
        .api_torrent_action_update_only_files(
            orc_engine::api::TorrentIdOrHash::Id(engine_id),
            &only_files,
        )
        .await
    {
        warn!("Failed to sync AnimUS media download policy for torrent {torrent_id}: {error:?}");
    }
}

/// Normalize a path by resolving `.` and `..` without requiring the path to exist.
fn normalize_path(path: &StdPath) -> PathBuf {
    let mut result = PathBuf::new();
    for comp in path.components() {
        match comp {
            Component::Prefix(prefix) => result.push(prefix.as_os_str()),
            Component::RootDir => result.push(std::path::MAIN_SEPARATOR_STR),
            Component::CurDir => {}
            Component::ParentDir => {
                result.pop();
            }
            Component::Normal(c) => result.push(c),
        }
    }
    result
}

/// Validate a destination beneath the dedicated ORC download root. Existing path
/// components must not be symlinks, and the nearest existing parent is canonicalized
/// before any non-existing suffix is accepted.
fn allowed_save_path(
    save_path: &str,
    download_dir_path: &StdPath,
) -> Result<String, anyhow::Error> {
    let trimmed = save_path.trim();
    if trimmed.is_empty() {
        return Err(anyhow::anyhow!("save_path cannot be empty"));
    }
    let path = PathBuf::from(trimmed);
    let normalized = if path.is_absolute() {
        normalize_path(&path)
    } else {
        normalize_path(&download_dir_path.join(path))
    };
    let lexical_root = normalize_path(download_dir_path);
    let relative = normalized
        .strip_prefix(&lexical_root)
        .map_err(|_| anyhow::anyhow!("save_path must be under the ORC download directory"))?;
    let download_root = download_dir_path
        .canonicalize()
        .unwrap_or_else(|_| download_dir_path.to_path_buf());
    let mut authorized = download_root.clone();
    for component in relative.components() {
        let Component::Normal(name) = component else {
            return Err(anyhow::anyhow!("save_path contains an invalid component"));
        };
        let candidate = authorized.join(name);
        match std::fs::symlink_metadata(&candidate) {
            Ok(metadata) => {
                if metadata.file_type().is_symlink() {
                    return Err(anyhow::anyhow!(
                        "save_path must not traverse symbolic links or reparse points"
                    ));
                }
                authorized = candidate
                    .canonicalize()
                    .context("failed to canonicalize save_path component")?;
                if !authorized.starts_with(&download_root) {
                    return Err(anyhow::anyhow!(
                        "save_path escapes the ORC download directory"
                    ));
                }
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                authorized = candidate;
            }
            Err(error) => return Err(error).context("failed to inspect save_path component"),
        }
    }
    Ok(authorized.to_string_lossy().to_string())
}

async fn validate_content_type(request: Request, next: Next) -> impl IntoResponse {
    if matches!(request.method(), &Method::POST | &Method::PATCH) {
        let has_body = request
            .headers()
            .get("content-length")
            .and_then(|v| v.to_str().ok())
            .and_then(|s| s.parse::<usize>().ok())
            .map(|len| len > 0)
            .unwrap_or(false);

        if has_body {
            if let Some(content_type) = request.headers().get("content-type") {
                let content_type_str = content_type.to_str().unwrap_or("");
                if !content_type_str.starts_with("application/json") {
                    return (
                        StatusCode::UNSUPPORTED_MEDIA_TYPE,
                        Json(serde_json::json!({"error": "Content-Type must be application/json"})),
                    )
                        .into_response();
                }
            } else {
                return (
                    StatusCode::BAD_REQUEST,
                    Json(serde_json::json!({"error": "Content-Type header is required"})),
                )
                    .into_response();
            }
        }
    }

    next.run(request).await
}

/// Deny-by-default trust boundary for the local API. Only health and version are public.
async fn require_api_security(
    State(security): State<ApiSecurity>,
    request: Request,
    next: Next,
) -> axum::response::Response {
    if is_public_route(request.method(), request.uri().path()) {
        return next.run(request).await;
    }

    if !origin_authorized(request.headers(), &security.allowed_origin) {
        warn!("Request rejected: missing, opaque, or unexpected Origin header");
        return (
            StatusCode::FORBIDDEN,
            Json(serde_json::json!({"error": "origin_not_allowed"})),
        )
            .into_response();
    }

    // A valid browser preflight cannot carry the token. The exact-origin CORS layer
    // validates it before the authenticated request is allowed through.
    if request_requires_token(request.method(), request.uri().path())
        && !admin_token_authorized(request.headers(), &security.admin_token)
    {
        warn!("Request rejected: invalid or missing x-admin-token");
        return (
            StatusCode::UNAUTHORIZED,
            Json(serde_json::json!({"error": "unauthorized"})),
        )
            .into_response();
    }
    next.run(request).await
}

pub struct DaemonRuntimeConfig {
    pub bind_addr: SocketAddr,
    pub admin_token: String,
    pub download_dir: PathBuf,
    pub config_dir: Option<PathBuf>,
    pub state_dir: Option<PathBuf>,
    pub cors_origin: Option<String>,
    pub install_signal_handlers: bool,
    pub shutdown: Option<Arc<tokio::sync::Notify>>,
    pub storage_factory: Option<orc_engine::storage::BoxStorageFactory>,
    pub network_status_provider: Option<Arc<dyn NetworkStatusProvider>>,
    pub network_disabled_at_start: bool,
    prebound_listener: Option<std::net::TcpListener>,
}

impl DaemonRuntimeConfig {
    pub fn from_env() -> anyhow::Result<Self> {
        let bind = std::env::var("DAEMON_BIND").unwrap_or_else(|_| "127.0.0.1:8733".to_string());
        let bind_addr = bind
            .parse()
            .map_err(|e| anyhow::anyhow!("Invalid DAEMON_BIND '{}': {}", bind, e))?;
        Ok(Self {
            bind_addr,
            admin_token: std::env::var("DAEMON_ADMIN_TOKEN").unwrap_or_default(),
            download_dir: PathBuf::from(
                std::env::var("ORC_DOWNLOAD_DIR").unwrap_or_else(|_| default_download_dir()),
            ),
            config_dir: std::env::var_os("ORC_CONFIG_DIR").map(PathBuf::from),
            state_dir: std::env::var_os("ORC_STATE_DIR").map(PathBuf::from),
            cors_origin: Some(
                std::env::var("DAEMON_ALLOWED_ORIGIN")
                    .unwrap_or_else(|_| "orc://desktop".to_string()),
            ),
            install_signal_handlers: true,
            shutdown: None,
            storage_factory: None,
            network_status_provider: None,
            network_disabled_at_start: false,
            prebound_listener: None,
        })
    }

    pub fn android(
        bind_addr: SocketAddr,
        admin_token: String,
        download_dir: PathBuf,
        config_dir: PathBuf,
        state_dir: PathBuf,
    ) -> Self {
        Self {
            bind_addr,
            admin_token,
            download_dir,
            config_dir: Some(config_dir),
            state_dir: Some(state_dir),
            cors_origin: Some("https://localhost".to_string()),
            install_signal_handlers: false,
            shutdown: None,
            storage_factory: None,
            network_status_provider: None,
            network_disabled_at_start: false,
            prebound_listener: None,
        }
    }
}

pub struct DaemonHandle {
    pub local_addr: SocketAddr,
    shutdown: Arc<tokio::sync::Notify>,
    thread: Option<std::thread::JoinHandle<anyhow::Result<()>>>,
}

impl DaemonHandle {
    pub fn shutdown(&self) {
        self.shutdown.notify_one();
    }

    pub fn join(mut self) -> anyhow::Result<()> {
        self.shutdown();
        match self.thread.take().expect("daemon thread missing").join() {
            Ok(result) => result,
            Err(_) => Err(anyhow::anyhow!("daemon thread panicked")),
        }
    }
}

impl Drop for DaemonHandle {
    fn drop(&mut self) {
        self.shutdown.notify_one();
    }
}

/// Start the daemon on a dedicated Tokio runtime. A port of zero selects an available loopback port.
pub fn spawn_daemon(mut runtime: DaemonRuntimeConfig) -> anyhow::Result<DaemonHandle> {
    let reservation = std::net::TcpListener::bind(runtime.bind_addr)?;
    reservation.set_nonblocking(true)?;
    runtime.bind_addr = reservation.local_addr()?;
    runtime.prebound_listener = Some(reservation);
    let local_addr = runtime.bind_addr;
    let shutdown = runtime
        .shutdown
        .clone()
        .unwrap_or_else(|| Arc::new(tokio::sync::Notify::new()));
    runtime.shutdown = Some(shutdown.clone());
    let thread = std::thread::Builder::new()
        .name("orc-daemon".to_string())
        .spawn(move || {
            tokio::runtime::Builder::new_multi_thread()
                .enable_all()
                .build()?
                .block_on(run_daemon(runtime))
        })?;
    Ok(DaemonHandle {
        local_addr,
        shutdown,
        thread: Some(thread),
    })
}

fn sanitize_error(e: &anyhow::Error, context: &str) -> String {
    let detailed = format!("{}: {}", context, e);
    error!("{}", detailed);
    let msg = e.to_string();
    let mut sanitized = msg.lines().take(1).collect::<String>();
    // Only replace if env var is non-empty; empty pattern would insert between every character
    if let Ok(home) = std::env::var("HOME") {
        if !home.is_empty() {
            sanitized = sanitized.replace(home.as_str(), "[HOME]");
        }
    }
    if let Ok(appdata) = std::env::var("APPDATA") {
        if !appdata.is_empty() {
            sanitized = sanitized.replace(appdata.as_str(), "[APPDATA]");
        }
    }
    if let Ok(userprofile) = std::env::var("USERPROFILE") {
        if !userprofile.is_empty() {
            sanitized = sanitized.replace(userprofile.as_str(), "[USERPROFILE]");
        }
    }
    if sanitized.to_lowercase().contains("token") || sanitized.to_lowercase().contains("secret") {
        sanitized = "An error occurred".to_string();
    }
    let mut chars = sanitized.chars();
    let prefix: String = chars.by_ref().take(200).collect();
    if chars.next().is_some() {
        format!("{prefix}...")
    } else {
        sanitized
    }
}

async fn persist_config_update<F>(ctx: &AppCtx, update: F) -> anyhow::Result<config::DaemonConfig>
where
    F: FnOnce(&mut config::DaemonConfig),
{
    // Serialize config transactions so a slow disk write cannot overwrite a newer
    // update. The active copy is replaced only after the synced atomic write succeeds.
    let mut active = ctx.config.write().await;
    let mut candidate = active.clone();
    update(&mut candidate);
    config::save_config_to(&candidate, &ctx.config_file).await?;
    *active = candidate.clone();
    Ok(candidate)
}

fn persistence_failure(error: &anyhow::Error, context: &str) -> axum::response::Response {
    let sanitized = sanitize_error(error, context);
    (
        StatusCode::INTERNAL_SERVER_ERROR,
        Json(serde_json::json!({
            "error": sanitized,
            "persisted": false
        })),
    )
        .into_response()
}

#[allow(dead_code)] // This file is also included by lib.rs for the embeddable runtime.
fn setup_panic_handler() {
    std::panic::set_hook(Box::new(|panic_info| {
        error!("PANIC: Application panicked");
        if let Some(location) = panic_info.location() {
            error!(
                "Location: {}:{}:{}",
                location.file(),
                location.line(),
                location.column()
            );
        }
        if let Some(s) = panic_info.payload().downcast_ref::<&str>() {
            error!("Message: {}", s);
        } else if let Some(s) = panic_info.payload().downcast_ref::<String>() {
            error!("Message: {}", s);
        }
    }));
}

/// Default download directory when ORC_DOWNLOAD_DIR is not set.
/// Uses user's Downloads folder so torrents are not saved in the install directory.
fn default_download_dir() -> String {
    #[cfg(windows)]
    {
        if let Ok(profile) = std::env::var("USERPROFILE") {
            if !profile.is_empty() {
                return format!("{}\\Downloads\\ORC Torrent", profile.trim_end_matches('\\'));
            }
        }
    }
    #[cfg(not(windows))]
    {
        if let Ok(home) = std::env::var("HOME") {
            if !home.is_empty() {
                return format!("{}/Downloads/ORC Torrent", home.trim_end_matches('/'));
            }
        }
    }
    "./downloads".to_string()
}

#[tokio::main]
#[allow(dead_code)] // This file is also included by lib.rs for the embeddable runtime.
async fn main() -> anyhow::Result<()> {
    setup_panic_handler();
    tracing_subscriber::fmt()
        .with_env_filter(tracing_subscriber::EnvFilter::from_default_env())
        .with_target(false)
        .with_thread_ids(false)
        .init();

    run_daemon(DaemonRuntimeConfig::from_env()?).await
}

pub async fn run_daemon(mut runtime: DaemonRuntimeConfig) -> anyhow::Result<()> {
    orc_core::set_network_status_provider(runtime.network_status_provider.take());
    let config_file = match runtime.config_dir.as_ref() {
        Some(directory) => directory.join("config.json"),
        None => config::config_path()?,
    };

    let admin_token = runtime.admin_token.clone();
    if admin_token.len() < 32 {
        return Err(anyhow::anyhow!(
            "SECURITY ERROR: DAEMON_ADMIN_TOKEN must contain at least 32 characters"
        ));
    }
    let addr = runtime.bind_addr;
    let bind_is_loopback = addr.ip().is_loopback();

    if !bind_is_loopback {
        return Err(anyhow::anyhow!(
            "SECURITY ERROR: non-loopback HTTP binding to {} is disabled; remote access requires a separate TLS listener",
            addr.ip()
        ));
    }

    let allowed_origin: HeaderValue = runtime
        .cors_origin
        .as_deref()
        .ok_or_else(|| {
            anyhow::anyhow!("SECURITY ERROR: an exact daemon Origin allowlist is required")
        })?
        .parse()
        .context("invalid daemon Origin allowlist value")?;
    if allowed_origin.as_bytes() == b"null" || allowed_origin.as_bytes().is_empty() {
        return Err(anyhow::anyhow!(
            "SECURITY ERROR: opaque or empty daemon origins are not allowed"
        ));
    }

    let download_dir = runtime.download_dir.to_string_lossy().into_owned();
    tracing::info!("Download directory: {}", download_dir);
    // Configuration integrity is established before the torrent engine creates any
    // network sockets. Corrupt or unreadable privacy policy therefore fails closed.
    let config = config::load_config_from(&config_file)
        .await
        .context("configuration integrity check failed; torrent networking was not started")?;

    tracing::info!("Using listen port: {}", config.listen_port);
    tokio::fs::create_dir_all(&download_dir).await?;

    let bind_iface = config.net_posture.bind_interface.clone();
    let persistence_dir = runtime.state_dir.as_ref().map(|dir| dir.join("rqbit"));
    let startup_engine_policy = config
        .policy
        .as_ref()
        .map(effective_engine_network_policy)
        .unwrap_or_default();
    let startup_peer_traffic_mode = config
        .policy
        .as_ref()
        .map(effective_peer_traffic_mode)
        .unwrap_or_default();
    let state = new_state_with_runtime_policy(
        download_dir.clone(),
        config.listen_port,
        bind_iface,
        persistence_dir,
        runtime.storage_factory.take(),
        runtime.network_disabled_at_start,
        startup_engine_policy,
        startup_peer_traffic_mode,
    )
    .await?;
    if let Some(ref ks) = config.kill_switch {
        let mut guard = state.lock().await;
        apply_stored_kill_switch(&mut guard, ks);
        info!("Restored kill switch from config (enabled={})", ks.enabled);
    }
    {
        let mut guard = state.lock().await;
        guard.seeding_settings = config.seeding.clone();
        guard.bandwidth_settings = config.bandwidth.clone();
        apply_bandwidth_profile_limits(&mut guard);
        apply_net_posture_stored(&mut guard, &config.net_posture);
        if let Some(ref policy) = config.policy {
            apply_policy_stored(&mut guard, policy);
            info!("Restored policy from config");
        }
    }
    if config.policy.is_some() {
        let mut guard = state.lock().await;
        if !network_session_disabled(&guard) {
            match activate_engine_policy(&mut guard).await {
                Ok(Some(reason)) => warn!("{reason}"),
                Ok(None) => info!("Activated persisted ORC engine policy"),
                Err(error) => return Err(error).context("failed to activate ORC engine policy"),
            }
        }
    }
    let watch_manager = Arc::new(WatchFolderManager::new(config.watch_folders.clone()));
    let shutdown_notify = runtime
        .shutdown
        .clone()
        .unwrap_or_else(|| Arc::new(tokio::sync::Notify::new()));
    {
        let s = state.clone();
        let wm = watch_manager.clone();
        let dl = PathBuf::from(&download_dir);
        if config.watch_folders.enabled {
            if let Err(e) = wm.restart_watchers(s, dl).await {
                warn!("Failed to start watch folders: {e}");
            }
        }
    }
    {
        let s = state.clone();
        tokio::spawn(async move {
            let mut interval = tokio::time::interval(Duration::from_secs(1));
            loop {
                interval.tick().await;
                let pending = {
                    let mut guard = s.lock().await;
                    tick(&mut guard);
                    let engine = engine_api(&guard);
                    let engaged = matches!(
                        get_kill_switch(&guard).enforcement_state,
                        orc_core::KillSwitchState::Engaged
                    );
                    if engaged && !engine.is_network_suspended() {
                        if let Err(error) = suspend_engine_network(&mut guard).await {
                            engine_api(&guard).set_degraded_reason(Some(format!(
                                "kill switch could not suspend engine sockets: {error}"
                            )));
                            error!("Kill switch engine suspension failed: {error:#}");
                        }
                    } else if !engaged
                        && engine.is_network_suspended()
                        && network_transfers_allowed()
                    {
                        if let Err(error) = rebind_engine_session(&mut guard).await {
                            engine_api(&guard).set_degraded_reason(Some(format!(
                                "engine network restore failed: {error}"
                            )));
                            error!("Engine network restore failed: {error:#}");
                        } else {
                            engine_api(&guard).set_degraded_reason(None);
                        }
                    }
                    drain_seeding_stop_pending(&mut guard)
                };
                for id in pending {
                    let api = {
                        let guard = s.lock().await;
                        engine_api(&guard)
                    };
                    let engine_id = {
                        let guard = s.lock().await;
                        engine_id_for(&guard, &id)
                    };
                    if let Some(engine_id) = engine_id {
                        if let Err(e) = api
                            .api_torrent_action_pause(orc_engine::api::TorrentIdOrHash::Id(
                                engine_id,
                            ))
                            .await
                        {
                            warn!("seeding limit pause failed for {id}: {e}");
                        }
                    }
                }
            }
        });
    }
    let cors = build_cors_layer(allowed_origin.clone());
    let security_headers = (
        SetResponseHeaderLayer::overriding(
            axum::http::header::X_CONTENT_TYPE_OPTIONS,
            HeaderValue::from_static("nosniff"),
        ),
        SetResponseHeaderLayer::overriding(
            axum::http::header::X_FRAME_OPTIONS,
            HeaderValue::from_static("DENY"),
        ),
        SetResponseHeaderLayer::overriding(
            axum::http::header::X_XSS_PROTECTION,
            HeaderValue::from_static("1; mode=block"),
        ),
        SetResponseHeaderLayer::overriding(
            axum::http::header::REFERRER_POLICY,
            HeaderValue::from_static("strict-origin-when-cross-origin"),
        ),
    );
    const MAX_CONCURRENT_REQUESTS: usize = 100;
    let config_state = Arc::new(tokio::sync::RwLock::new(config.clone()));
    let secrets = {
        let config_dir = config_file
            .parent()
            .map(|parent| parent.to_path_buf())
            .unwrap_or_else(|| PathBuf::from(&download_dir));
        create_default_secret_store(&config_dir)
    };

    let app_ctx = AppCtx {
        state,
        config: config_state,
        config_file,
        shutdown: shutdown_notify.clone(),
        watch_manager,
        download_dir: PathBuf::from(download_dir),
        secrets,
        connection_status: Arc::new(tokio::sync::RwLock::new(std::collections::HashMap::new())),
    };
    let api_security = ApiSecurity {
        admin_token,
        allowed_origin,
    };

    let app = Router::new()
        .route("/health", get(h_health))
        .route("/engine/capabilities", get(h_engine_capabilities))
        .route("/version", get(h_version))
        .route("/wallet", get(h_wallet))
        .route("/overlay/status", get(h_overlay_status))
        .route(
            "/net/posture",
            get(h_net_posture).patch(h_patch_net_posture),
        )
        .route("/net/vpn-status", get(h_vpn_status))
        .route("/net/vpn-status/refresh", post(h_vpn_status_refresh))
        .route("/net/adapters", get(h_net_adapters))
        .route("/net/route", get(h_net_route))
        .route("/net/dns", get(h_net_dns))
        .route("/tor/status", get(h_tor_status))
        .route(
            "/net/kill-switch",
            get(h_kill_switch).patch(h_patch_kill_switch),
        )
        .route("/net/kill-switch/test", post(h_kill_switch_test))
        .route("/net/privacy-status", get(h_privacy_status))
        .route("/net/privacy/preset/vpn-safety", post(h_vpn_safety_preset))
        .route("/seeding", get(h_seeding).patch(h_patch_seeding))
        .route("/torrents/limits", get(h_get_limits).post(h_post_limits))
        .route("/bandwidth/schedule", patch(h_patch_bandwidth_schedule))
        .route(
            "/torrents/:id/seeding",
            get(h_get_torrent_seeding).patch(h_patch_torrent_seeding),
        )
        .route("/v1/policy", get(h_policy).patch(h_patch_policy))
        .route("/torrents", get(h_list_torrents).post(h_add_torrent))
        .route("/torrents/:id", get(h_get_torrent))
        .route("/torrents/:id/status", get(h_get_status))
        .route("/torrents/:id/content", get(h_get_content))
        .route("/torrents/:id/file-priority", patch(h_patch_file_priority))
        .route("/torrents/:id/profile", patch(h_patch_profile))
        .route("/torrents/:id/start", post(h_start))
        .route("/torrents/:id/stop", post(h_stop))
        .route("/torrents/:id/remove", post(h_remove))
        .route("/torrents/:id/recheck", post(h_recheck))
        .route("/torrents/:id/announce", post(h_announce))
        .route("/torrents/:id/peers", get(h_peers))
        .route("/torrents/:id/trackers", get(h_trackers))
        .route("/torrents/:id/row-snapshot", get(h_get_row_snapshot))
        .route("/admin/shutdown", post(h_admin_shutdown));

    #[cfg(feature = "desktop-watch-folders")]
    let app = app
        .route(
            "/watch-folders",
            get(h_watch_folders).patch(h_patch_watch_folders),
        )
        .route("/watch-folders/test", post(h_watch_folders_test))
        .route("/watch-folders/events", get(h_watch_folders_events));

    #[cfg(feature = "desktop-search")]
    let app = app
        .route("/search/providers", get(h_search_providers))
        .route(
            "/search/settings",
            get(h_search_settings).patch(h_patch_search_settings),
        )
        .route(
            "/search/providers/:name/credentials",
            put(h_put_search_credentials).delete(h_delete_search_credentials),
        )
        .route("/search/providers/:name/test", post(h_test_search_provider))
        .route("/search/providers/:name", delete(h_delete_search_provider))
        .route("/search", post(h_search));

    let app = app
        .with_state(app_ctx.clone())
        .layer(axum::middleware::from_fn_with_state(
            api_security,
            require_api_security,
        ))
        .layer(axum::middleware::from_fn(validate_content_type))
        .layer(TraceLayer::new_for_http())
        .layer(cors)
        .layer(RequestBodyLimitLayer::new(10 * 1024 * 1024))
        .layer(ConcurrencyLimitLayer::new(MAX_CONCURRENT_REQUESTS))
        .layer(security_headers.0)
        .layer(security_headers.1)
        .layer(security_headers.2)
        .layer(security_headers.3);

    info!("orc-daemon listening on {}", addr);

    let shutdown_signal = {
        let shutdown_notify = shutdown_notify.clone();
        let install_signal_handlers = runtime.install_signal_handlers;
        async move {
            if install_signal_handlers {
                tokio::select! {
                    _ = tokio::signal::ctrl_c() => {
                        info!("ctrl-c received; shutting down");
                    }
                    _ = shutdown_notify.notified() => {
                        info!("admin shutdown requested");
                    }
                }
            } else {
                shutdown_notify.notified().await;
                info!("embedded shutdown requested");
            }
        }
    };

    let listener = match runtime.prebound_listener.take() {
        Some(listener) => tokio::net::TcpListener::from_std(listener)?,
        None => tokio::net::TcpListener::bind(addr).await?,
    };
    axum::serve(listener, app)
        .with_graceful_shutdown(shutdown_signal)
        .await?;

    Ok(())
}

async fn h_health(State(ctx): State<AppCtx>) -> impl IntoResponse {
    let guard = ctx.state.lock().await;
    let health_status = health(&guard);
    Json(health_status)
}

async fn h_engine_capabilities(State(ctx): State<AppCtx>) -> impl IntoResponse {
    let guard = ctx.state.lock().await;
    Json(engine_capabilities(&guard))
}

async fn h_version() -> impl IntoResponse {
    Json(version())
}

async fn h_wallet() -> impl IntoResponse {
    Json(wallet_status())
}

async fn h_overlay_status() -> impl IntoResponse {
    Json(overlay_status())
}

async fn h_net_posture(State(ctx): State<AppCtx>) -> impl IntoResponse {
    let guard = ctx.state.lock().await;
    Json(net_posture(&guard))
}

async fn h_patch_net_posture(
    State(ctx): State<AppCtx>,
    Json(req): Json<PatchNetPostureRequest>,
) -> impl IntoResponse {
    if let Err(e) = req.validate() {
        let sanitized = sanitize_error(&e, "Invalid net posture request");
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({"error": sanitized})),
        )
            .into_response();
    }

    let mut guard = ctx.state.lock().await;
    let old_bind = net_bind_interface(&guard).map(|s| s.to_string());
    let out = patch_net_posture(&mut guard, req);
    let bind_changed = old_bind.as_deref() != net_bind_interface(&guard);
    if bind_changed {
        if let Err(e) = rebind_engine_session(&mut guard).await {
            let sanitized = sanitize_error(&e, "Failed to rebind network interface");
            return (
                StatusCode::BAD_REQUEST,
                Json(serde_json::json!({"error": sanitized})),
            )
                .into_response();
        }
    }
    let stored = net_posture_stored_from_state(&guard);
    let kill_switch_stored = KillSwitchStoredSettings::from(&get_kill_switch(&guard));
    let policy_stored = policy_stored_from_state(&guard);
    drop(guard);

    if let Err(e) = persist_config_update(&ctx, move |config| {
        config.net_posture = stored;
        config.kill_switch = Some(kill_switch_stored);
        config.policy = Some(policy_stored);
    })
    .await
    {
        return persistence_failure(&e, "Failed to persist net posture config");
    }

    Json(out).into_response()
}

async fn h_vpn_status() -> impl IntoResponse {
    Json(orc_core::vpn_status())
}

async fn h_vpn_status_refresh() -> impl IntoResponse {
    Json(orc_core::vpn_status())
}

async fn h_net_adapters() -> impl IntoResponse {
    Json(orc_core::list_network_adapters())
}

async fn h_net_route() -> impl IntoResponse {
    Json(orc_core::default_route_info())
}

async fn h_net_dns() -> impl IntoResponse {
    Json(orc_core::dns_config())
}

async fn h_tor_status() -> impl IntoResponse {
    Json(orc_core::tor_status())
}

async fn h_kill_switch(State(ctx): State<AppCtx>) -> impl IntoResponse {
    let guard = ctx.state.lock().await;
    Json(orc_core::get_kill_switch(&guard))
}

async fn h_patch_kill_switch(
    State(ctx): State<AppCtx>,
    Json(req): Json<PatchKillSwitchRequest>,
) -> impl IntoResponse {
    if let Err(e) = req.validate() {
        let sanitized = sanitize_error(&e, "Invalid kill switch request");
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({"error": sanitized})),
        )
            .into_response();
    }

    let mut guard = ctx.state.lock().await;
    let out = patch_kill_switch(&mut guard, req);
    let stored = KillSwitchStoredSettings::from(&out);
    let posture_stored = net_posture_stored_from_state(&guard);
    let policy_stored = policy_stored_from_state(&guard);
    drop(guard);

    if let Err(e) = persist_config_update(&ctx, move |config| {
        config.kill_switch = Some(stored);
        config.net_posture = posture_stored;
        config.policy = Some(policy_stored);
    })
    .await
    {
        return persistence_failure(&e, "Failed to persist transfer-pause config");
    }

    Json(out).into_response()
}

async fn h_kill_switch_test(State(ctx): State<AppCtx>) -> impl IntoResponse {
    let guard = ctx.state.lock().await;
    if orc_core::get_kill_switch(&guard).enabled {
        Json(
            serde_json::json!({"ok": true, "message": "VPN transfer pause is enabled (simulation only; no OS firewall is claimed)."}),
        )
    } else {
        Json(serde_json::json!({"ok": false, "message": "VPN transfer pause is disabled."}))
    }
}

async fn h_policy(State(ctx): State<AppCtx>) -> impl IntoResponse {
    let guard = ctx.state.lock().await;
    Json(orc_core::get_policy(&guard))
}

async fn h_patch_policy(
    State(ctx): State<AppCtx>,
    Json(req): Json<PatchPolicyRequest>,
) -> impl IntoResponse {
    if let Err(e) = req.desired_patch.validate() {
        let sanitized = sanitize_error(&e, "Invalid policy request");
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({"error": sanitized})),
        )
            .into_response();
    }

    let mut guard = ctx.state.lock().await;
    let previous_engine_policy = engine_api(&guard).network_policy();
    let previous_peer_traffic_mode = get_policy(&guard).effective.peer_encryption;
    patch_policy(&mut guard, req.desired_patch);
    let engine_policy_changed = engine_api(&guard).network_policy() != previous_engine_policy;
    let peer_traffic_mode_changed =
        get_policy(&guard).effective.peer_encryption != previous_peer_traffic_mode;
    if (engine_policy_changed || peer_traffic_mode_changed) && !network_session_disabled(&guard) {
        if let Err(error) = activate_engine_policy(&mut guard).await {
            let sanitized = sanitize_error(&error, "Failed to activate engine policy");
            return (
                StatusCode::BAD_GATEWAY,
                Json(serde_json::json!({"error": sanitized})),
            )
                .into_response();
        }
    }
    let out = get_policy(&guard);
    let policy_stored = policy_stored_from_state(&guard);
    drop(guard);
    if let Err(e) = persist_config_update(&ctx, move |config| {
        config.policy = Some(policy_stored);
    })
    .await
    {
        return persistence_failure(&e, "Failed to persist policy config");
    }
    Json(out).into_response()
}

async fn h_search_settings(State(ctx): State<AppCtx>) -> impl IntoResponse {
    let config = ctx.config.read().await;
    match search_settings_response_with_secrets(&config.search, ctx.secrets.as_ref()).await {
        Ok(mut settings) => {
            let status_map = ctx.connection_status.read().await;
            for provider in &mut settings.providers {
                if let Some(snapshot) = status_map.get(&provider.name) {
                    provider.connection_status = Some(snapshot.status_label());
                    provider.last_tested_at = Some(snapshot.tested_at.clone());
                    provider.last_error = snapshot.last_error.clone();
                }
            }
            (StatusCode::OK, Json(settings)).into_response()
        }
        Err(e) => {
            let sanitized = sanitize_error(&e, "Failed to load search settings");
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({ "error": sanitized })),
            )
                .into_response()
        }
    }
}

async fn h_patch_search_settings(
    State(ctx): State<AppCtx>,
    Json(req): Json<SearchSettingsPatchRequest>,
) -> impl IntoResponse {
    if let Err(e) = req.validate() {
        let sanitized = sanitize_error(&e, "Invalid search settings request");
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({"error": sanitized})),
        )
            .into_response();
    }

    let before = ctx.config.read().await.search.clone();
    let updated_search = match req.apply(&before) {
        Ok(updated) => updated,
        Err(e) => {
            let sanitized = sanitize_error(&e, "Invalid search settings request");
            return (
                StatusCode::BAD_REQUEST,
                Json(serde_json::json!({"error": sanitized})),
            )
                .into_response();
        }
    };
    let removed_refs = removed_provider_credential_refs(&before, &updated_search);
    let updated = match persist_config_update(&ctx, move |config| {
        config.search = updated_search;
    })
    .await
    {
        Ok(updated) => updated,
        Err(e) => return persistence_failure(&e, "Failed to persist search settings"),
    };

    // Delete credentials only after the configuration no longer references them.
    for reference in removed_refs {
        if let Err(e) = ctx.secrets.delete_secret(&reference).await {
            warn!("failed to delete search credential for removed provider: {e}");
        }
    }

    match search_settings_response_with_secrets(&updated.search, ctx.secrets.as_ref()).await {
        Ok(settings) => (StatusCode::OK, Json(settings)).into_response(),
        Err(e) => {
            let sanitized = sanitize_error(&e, "Failed to load search settings");
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({ "error": sanitized })),
            )
                .into_response()
        }
    }
}

async fn h_search_providers(State(ctx): State<AppCtx>) -> impl IntoResponse {
    let config = ctx.config.read().await;
    match available_providers_with_secrets(&config.search, ctx.secrets.clone()).await {
        Ok(mut providers) => {
            let status_map = ctx.connection_status.read().await;
            for provider in &mut providers {
                if let Some(snapshot) = status_map.get(&provider.name) {
                    provider.connection_status = Some(snapshot.status_label());
                    provider.last_tested_at = Some(snapshot.tested_at.clone());
                    provider.last_error = snapshot.last_error.clone();
                }
            }
            (StatusCode::OK, Json(providers)).into_response()
        }
        Err(e) => {
            let sanitized = sanitize_error(&e, "Failed to load search providers");
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({ "error": sanitized })),
            )
                .into_response()
        }
    }
}

async fn h_search(State(ctx): State<AppCtx>, Json(req): Json<SearchQuery>) -> impl IntoResponse {
    let settings = {
        let config = ctx.config.read().await;
        config.search.clone()
    };

    match execute_search_with_secrets(&settings, req, ctx.secrets.clone()).await {
        Ok(results) => (StatusCode::OK, Json(results)).into_response(),
        Err(e) => {
            let sanitized = sanitize_error(&e, "Search failed");
            (
                StatusCode::BAD_REQUEST,
                Json(serde_json::json!({ "error": sanitized })),
            )
                .into_response()
        }
    }
}

async fn h_put_search_credentials(
    State(ctx): State<AppCtx>,
    Path(name): Path<String>,
    Json(req): Json<PutSearchCredentialsRequest>,
) -> impl IntoResponse {
    if let Err(e) = validate_api_key(&req.api_key) {
        let sanitized = sanitize_error(&e, "Invalid API key");
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({ "error": sanitized })),
        )
            .into_response();
    }

    let reference = {
        let config = ctx.config.read().await;
        let Ok(setting) = config.search.provider_setting(&name) else {
            return (
                StatusCode::NOT_FOUND,
                Json(serde_json::json!({ "error": "Unknown search provider" })),
            )
                .into_response();
        };
        if setting.format != SearchProviderFormat::Torznab {
            return (
                StatusCode::BAD_REQUEST,
                Json(serde_json::json!({
                    "error": "Credentials are only supported for Torznab providers"
                })),
            )
                .into_response();
        }
        setting
            .credential_ref
            .unwrap_or_else(|| credential_ref_for_provider(&name))
    };

    if let Err(e) = ctx.secrets.set_secret(&reference, req.api_key.trim()).await {
        let sanitized = sanitize_error(&e, "Failed to store credentials");
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({ "error": sanitized })),
        )
            .into_response();
    }

    (
        StatusCode::OK,
        Json(serde_json::json!({
            "provider": name,
            "has_api_key": true
        })),
    )
        .into_response()
}

async fn h_delete_search_credentials(
    State(ctx): State<AppCtx>,
    Path(name): Path<String>,
) -> impl IntoResponse {
    let reference = {
        let config = ctx.config.read().await;
        let Ok(setting) = config.search.provider_setting(&name) else {
            return (
                StatusCode::NOT_FOUND,
                Json(serde_json::json!({ "error": "Unknown search provider" })),
            )
                .into_response();
        };
        if setting.format != SearchProviderFormat::Torznab {
            return (
                StatusCode::BAD_REQUEST,
                Json(serde_json::json!({
                    "error": "Credentials are only supported for Torznab providers"
                })),
            )
                .into_response();
        }
        setting
            .credential_ref
            .unwrap_or_else(|| credential_ref_for_provider(&name))
    };

    if let Err(e) = ctx.secrets.delete_secret(&reference).await {
        let sanitized = sanitize_error(&e, "Failed to clear credentials");
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({ "error": sanitized })),
        )
            .into_response();
    }

    (
        StatusCode::OK,
        Json(serde_json::json!({
            "provider": name,
            "has_api_key": false
        })),
    )
        .into_response()
}

async fn h_test_search_provider(
    State(ctx): State<AppCtx>,
    Path(name): Path<String>,
) -> impl IntoResponse {
    let settings = {
        let config = ctx.config.read().await;
        config.search.clone()
    };

    let ctx_exec = match SearchHttpClient::new() {
        Ok(http) => SearchExecutionContext {
            http,
            allow_private_remote_urls: settings.allow_private_remote_urls,
            secrets: ctx.secrets.clone(),
        },
        Err(e) => {
            let sanitized = sanitize_error(&e, "Failed to initialise search client");
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({ "error": sanitized })),
            )
                .into_response();
        }
    };

    match test_torznab_provider(&settings, &name, ctx.secrets.clone(), &ctx_exec).await {
        Ok(result) => {
            let snapshot = search::torznab::ProviderConnectionSnapshot {
                ok: result.ok,
                tested_at: chrono_like_now(),
                latency_ms: result.latency_ms,
                supports_search: result.supports_search,
                category_count: result.category_count,
                last_error: if result.ok {
                    None
                } else {
                    Some(result.message.clone())
                },
            };
            ctx.connection_status
                .write()
                .await
                .insert(name.clone(), snapshot);
            (StatusCode::OK, Json(result)).into_response()
        }
        Err(e) => {
            let sanitized = sanitize_error(&e, "Provider test failed");
            (
                StatusCode::BAD_REQUEST,
                Json(serde_json::json!({ "error": sanitized })),
            )
                .into_response()
        }
    }
}

async fn h_delete_search_provider(
    State(ctx): State<AppCtx>,
    Path(name): Path<String>,
) -> impl IntoResponse {
    let (next_search, credential_ref) = {
        let config = ctx.config.read().await;
        let Ok(setting) = config.search.provider_setting(&name) else {
            return (
                StatusCode::NOT_FOUND,
                Json(serde_json::json!({ "error": "Unknown search provider" })),
            )
                .into_response();
        };
        let credential_ref = if setting.format == SearchProviderFormat::Torznab {
            Some(
                setting
                    .credential_ref
                    .clone()
                    .unwrap_or_else(|| credential_ref_for_provider(&name)),
            )
        } else {
            None
        };

        let mut next_search = config.search.clone();
        next_search
            .providers
            .retain(|provider| provider.name != name);
        if next_search
            .default_provider
            .as_deref()
            .is_some_and(|value| value == name)
        {
            next_search.default_provider = next_search
                .providers
                .iter()
                .find(|provider| provider.enabled)
                .map(|provider| provider.name.clone());
        }
        if let Err(e) = next_search.validate() {
            let sanitized = sanitize_error(&e, "Invalid search settings after provider removal");
            return (
                StatusCode::BAD_REQUEST,
                Json(serde_json::json!({ "error": sanitized })),
            )
                .into_response();
        }
        (next_search, credential_ref)
    };

    let updated = match persist_config_update(&ctx, move |config| {
        config.search = next_search;
    })
    .await
    {
        Ok(updated) => updated,
        Err(e) => return persistence_failure(&e, "Failed to persist search settings"),
    };

    // Remove the secret and transient status only after the provider removal is durable.
    if let Some(reference) = credential_ref {
        if let Err(e) = ctx.secrets.delete_secret(&reference).await {
            warn!("failed to delete credential for removed provider: {e}");
        }
    }
    {
        let mut status = ctx.connection_status.write().await;
        status.remove(&name);
    }

    match available_providers_with_secrets(&updated.search, ctx.secrets.clone()).await {
        Ok(providers) => (StatusCode::OK, Json(providers)).into_response(),
        Err(e) => {
            let sanitized = sanitize_error(&e, "Failed to load search providers");
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({ "error": sanitized })),
            )
                .into_response()
        }
    }
}

fn chrono_like_now() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|value| value.as_secs())
        .unwrap_or(0);
    format!("{secs}")
}

async fn h_list_torrents(State(ctx): State<AppCtx>) -> impl IntoResponse {
    let guard = ctx.state.lock().await;
    Json(list_torrents(&guard))
}

async fn h_add_torrent(
    State(ctx): State<AppCtx>,
    Json(req): Json<AddTorrentRequest>,
) -> impl IntoResponse {
    if let Err(e) = req.validate() {
        let sanitized = sanitize_error(&e, "Invalid add torrent request");
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({"error": sanitized})),
        )
            .into_response();
    }
    let transfers_allowed = network_transfers_allowed();

    let input = match prepare_add_input(&req) {
        Ok(i) => i,
        Err(e) => {
            let sanitized = sanitize_error(&e, "Failed to prepare torrent input");
            return (
                StatusCode::BAD_REQUEST,
                Json(serde_json::json!({"error": sanitized})),
            )
                .into_response();
        }
    };
    let info_hash_hex = match &input {
        AddTorrentInput::Url(u) => extract_info_hash_from_magnet(u),
        AddTorrentInput::TorrentBytes(bytes) => {
            extract_info_hash_from_torrent_bytes(bytes).unwrap_or(None)
        }
    };
    if let Some(hash) = &info_hash_hex {
        let existing_result = {
            let guard = ctx.state.lock().await;
            find_torrent_by_info_hash(&guard, hash)
        };
        if let Some((id, _is_complete, is_running)) = existing_result {
            let api = {
                let guard = ctx.state.lock().await;
                engine_api(&guard)
            };

            let engine_id = {
                let guard = ctx.state.lock().await;
                engine_id_for(&guard, &id)
            };
            if let Some(engine_id) = engine_id {
                if !is_running && transfers_allowed && !req.start_paused {
                    if let Err(e) = api
                        .api_torrent_action_start(orc_engine::api::TorrentIdOrHash::Id(engine_id))
                        .await
                    {
                        error!("engine start failed for existing torrent: {e:?}");
                    } else {
                        let mut guard = ctx.state.lock().await;
                        let _ = set_running(&mut guard, &id, true);
                    }
                }
            }
            return (
                StatusCode::OK,
                Json(serde_json::json!({
                    "id": id
                })),
            )
                .into_response();
        }
    }
    if !transfers_allowed && matches!(&input, AddTorrentInput::Url(_)) {
        return (
            StatusCode::FORBIDDEN,
            Json(serde_json::json!({
                "error": "Network blocked by the active Android transfer policy. Connect to an allowed network before resolving a magnet link."
            })),
        )
            .into_response();
    }
    let (api, default_download_path) = {
        let guard = ctx.state.lock().await;
        (engine_api(&guard), guard.download_dir_path().clone())
    };
    let output_folder = if let Some(s) = req.save_path.as_ref() {
        let t = s.trim();
        if t.is_empty() {
            None
        } else {
            match allowed_save_path(t, &default_download_path) {
                Ok(allowed) => Some(allowed),
                Err(e) => {
                    let sanitized = sanitize_error(&e, "Invalid save_path");
                    return (
                        StatusCode::BAD_REQUEST,
                        Json(serde_json::json!({"error": sanitized})),
                    )
                        .into_response();
                }
            }
        }
    } else {
        None
    }
    .or_else(|| {
        info_hash_hex.as_ref().and_then(|h| {
            resolve_torrent_output_folder(&default_download_path, &req, h)
                .map(|p| p.to_string_lossy().to_string())
        })
    });
    let mut opts = build_add_torrent_options(output_folder.clone());
    opts.paused = req.start_paused || !transfers_allowed;
    let engine_resp = match &input {
        AddTorrentInput::Url(u) => {
            api.api_add_torrent(orc_engine::AddTorrent::from_url(u.as_str()), Some(opts))
                .await
        }
        AddTorrentInput::TorrentBytes(bytes) => {
            api.api_add_torrent(
                orc_engine::AddTorrent::from_bytes(bytes.clone()),
                Some(opts),
            )
            .await
        }
    };

    let engine_resp = match engine_resp {
        Ok(r) => Ok(r),
        Err(e) => {
            let error_str = e.to_string();
            let error_lower = error_str.to_lowercase();
            let is_file_exists_error = error_lower.contains("file exists")
                || error_lower.contains("already exists")
                || error_lower.contains("the file exists")
                || error_lower.contains("cannot create a file when that file already exists")
                || error_lower.contains("eexist")
                || error_lower.contains("file already exists");
            if is_file_exists_error {
                info!("Files exist on disk but torrent not in state, retrying with overwrite to resume: {error_str}");
                let mut retry_opts = build_add_torrent_options(output_folder.clone());
                retry_opts.paused = req.start_paused || !transfers_allowed;
                match &input {
                    AddTorrentInput::Url(u) => {
                        api.api_add_torrent(
                            orc_engine::AddTorrent::from_url(u.as_str()),
                            Some(retry_opts),
                        )
                        .await
                    }
                    AddTorrentInput::TorrentBytes(bytes) => {
                        api.api_add_torrent(
                            orc_engine::AddTorrent::from_bytes(bytes.clone()),
                            Some(retry_opts),
                        )
                        .await
                    }
                }
            } else {
                let sanitized = sanitize_error(&anyhow::Error::from(e), "Failed to add torrent");
                return (
                    StatusCode::BAD_REQUEST,
                    Json(serde_json::json!({"error": sanitized})),
                )
                    .into_response();
            }
        }
    };

    let engine_resp = match engine_resp {
        Ok(r) => r,
        Err(e) => {
            let sanitized = sanitize_error(
                &anyhow::Error::from(e),
                "Failed to add torrent (retry failed)",
            );
            return (
                StatusCode::BAD_REQUEST,
                Json(serde_json::json!({"error": sanitized})),
            )
                .into_response();
        }
    };

    let out = {
        let mut guard = ctx.state.lock().await;
        match integrate_added_torrent(&mut guard, &req, engine_resp) {
            Ok(r) => {
                if req.start_paused || !transfers_allowed {
                    let _ = set_running(&mut guard, &r.id, false);
                }
                r
            }
            Err(e) => {
                let sanitized = sanitize_error(&e, "Failed to integrate torrent");
                return (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(serde_json::json!({"error": sanitized})),
                )
                    .into_response();
            }
        }
    };

    let api_for_policy = {
        let guard = ctx.state.lock().await;
        engine_api(&guard)
    };
    sync_media_download_policy(&api_for_policy, &out.id, &ctx.state).await;

    (StatusCode::OK, Json(out)).into_response()
}

async fn h_get_torrent(State(ctx): State<AppCtx>, Path(id): Path<String>) -> impl IntoResponse {
    if !validate_torrent_id(&id) {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({
                "error": "Invalid torrent ID format"
            })),
        )
            .into_response();
    }

    let guard = ctx.state.lock().await;
    match get_torrent(&guard, &id) {
        Some(t) => (StatusCode::OK, Json(t)).into_response(),
        None => StatusCode::NOT_FOUND.into_response(),
    }
}

async fn h_get_status(State(ctx): State<AppCtx>, Path(id): Path<String>) -> impl IntoResponse {
    if !validate_torrent_id(&id) {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({
                "error": "Invalid torrent ID format"
            })),
        )
            .into_response();
    }

    let guard = ctx.state.lock().await;
    match get_status(&guard, &id) {
        Some(s) => (StatusCode::OK, Json(s)).into_response(),
        None => StatusCode::NOT_FOUND.into_response(),
    }
}

async fn h_get_content(State(ctx): State<AppCtx>, Path(id): Path<String>) -> impl IntoResponse {
    if !validate_torrent_id(&id) {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({
                "error": "Invalid torrent ID format"
            })),
        )
            .into_response();
    }

    let guard = ctx.state.lock().await;
    match get_content(&guard, &id) {
        Some(c) => (StatusCode::OK, Json(c)).into_response(),
        None => StatusCode::NOT_FOUND.into_response(),
    }
}

async fn h_patch_file_priority(
    State(ctx): State<AppCtx>,
    Path(id): Path<String>,
    Json(req): Json<PatchFilePriorityRequest>,
) -> impl IntoResponse {
    if !validate_torrent_id(&id) {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({
                "error": "Invalid torrent ID format"
            })),
        )
            .into_response();
    }

    // Production Security: Validate request payload
    if let Err(e) = req.validate() {
        let sanitized = sanitize_error(&e, "Invalid file priority request");
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({"error": sanitized})),
        )
            .into_response();
    }
    let (api, engine_id, only_files) = {
        let mut guard = ctx.state.lock().await;
        if set_file_priority(&mut guard, &id, req).is_err() {
            return StatusCode::NOT_FOUND.into_response();
        }
        (
            engine_api(&guard),
            engine_id_for(&guard, &id),
            only_files_for(&guard, &id),
        )
    };
    if let (Some(engine_id), Some(only_files)) = (engine_id, only_files) {
        if let Err(e) = api
            .api_torrent_action_update_only_files(
                orc_engine::api::TorrentIdOrHash::Id(engine_id),
                &only_files,
            )
            .await
        {
            let sanitized =
                sanitize_error(&anyhow::Error::from(e), "Failed to update file priority");
            return (
                StatusCode::BAD_REQUEST,
                Json(serde_json::json!({"error": sanitized})),
            )
                .into_response();
        }
    }

    StatusCode::OK.into_response()
}

async fn h_patch_profile(
    State(ctx): State<AppCtx>,
    Path(id): Path<String>,
    Json(req): Json<PatchTorrentProfileRequest>,
) -> impl IntoResponse {
    if !validate_torrent_id(&id) {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({
                "error": "Invalid torrent ID format"
            })),
        )
            .into_response();
    }

    // Production Security: Validate request payload
    if let Err(e) = req.validate() {
        let sanitized = sanitize_error(&e, "Invalid profile request");
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({"error": sanitized})),
        )
            .into_response();
    }

    let mut guard = ctx.state.lock().await;
    let profile = orc_core::TorrentProfile {
        mode: req.mode,
        hops: req.hops,
    };
    match set_profile(&mut guard, &id, profile) {
        Ok(t) => (StatusCode::OK, Json(t)).into_response(),
        Err(_) => StatusCode::NOT_FOUND.into_response(),
    }
}

async fn h_start(State(ctx): State<AppCtx>, Path(id): Path<String>) -> impl IntoResponse {
    if !validate_torrent_id(&id) {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({
                "error": "Invalid torrent ID format"
            })),
        )
            .into_response();
    }
    if !network_transfers_allowed() {
        return (
            StatusCode::FORBIDDEN,
            Json(serde_json::json!({
                "error": "Network blocked by the active Android transfer policy. Connect to an allowed network and resume manually."
            })),
        )
            .into_response();
    }
    {
        let rebind_requested = take_network_rebind_required();
        let mut guard = ctx.state.lock().await;
        if network_session_disabled(&guard) || rebind_requested {
            if let Err(error) = rebind_engine_session(&mut guard).await {
                let sanitized = sanitize_error(&error, "Failed to enable the torrent network");
                return (
                    StatusCode::BAD_REQUEST,
                    Json(serde_json::json!({"error": sanitized})),
                )
                    .into_response();
            }
        }
    }
    {
        let guard = ctx.state.lock().await;
        let policy = get_policy(&guard);
        let killswitch = get_kill_switch(&guard);
        if killswitch.enabled && !policy.effective.network_allowed {
            return (StatusCode::FORBIDDEN, Json(serde_json::json!({
                "error": "Network blocked: VPN kill switch is engaged. Please connect to VPN to resume torrents."
            }))).into_response();
        }
    }

    let (api, engine_id) = {
        let guard = ctx.state.lock().await;
        (engine_api(&guard), engine_id_for(&guard, &id))
    };

    let Some(engine_id) = engine_id else {
        return StatusCode::NOT_FOUND.into_response();
    };

    if let Err(e) = api
        .api_torrent_action_start(orc_engine::api::TorrentIdOrHash::Id(engine_id))
        .await
    {
        let sanitized = sanitize_error(&anyhow::Error::from(e), "Failed to start torrent");
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({"error": sanitized})),
        )
            .into_response();
    }

    let mut guard = ctx.state.lock().await;
    let _ = set_running(&mut guard, &id, true);
    StatusCode::OK.into_response()
}

async fn h_stop(State(ctx): State<AppCtx>, Path(id): Path<String>) -> impl IntoResponse {
    if !validate_torrent_id(&id) {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({
                "error": "Invalid torrent ID format"
            })),
        )
            .into_response();
    }

    let (api, engine_id) = {
        let guard = ctx.state.lock().await;
        (engine_api(&guard), engine_id_for(&guard, &id))
    };

    let Some(engine_id) = engine_id else {
        return StatusCode::NOT_FOUND.into_response();
    };

    if let Err(e) = api
        .api_torrent_action_pause(orc_engine::api::TorrentIdOrHash::Id(engine_id))
        .await
    {
        let sanitized = sanitize_error(&anyhow::Error::from(e), "Failed to stop torrent");
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({"error": sanitized})),
        )
            .into_response();
    }

    let mut guard = ctx.state.lock().await;
    let _ = set_running(&mut guard, &id, false);
    StatusCode::OK.into_response()
}

#[derive(Debug, Default, Deserialize)]
struct RemoveTorrentBody {
    #[serde(default)]
    delete_data: bool,
}

async fn h_remove(
    State(ctx): State<AppCtx>,
    Path(id): Path<String>,
    body: Option<Json<RemoveTorrentBody>>,
) -> impl IntoResponse {
    if !validate_torrent_id(&id) {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({
                "error": "Invalid torrent ID format"
            })),
        )
            .into_response();
    }

    let (api, engine_id) = {
        let guard = ctx.state.lock().await;
        (engine_api(&guard), engine_id_for(&guard, &id))
    };

    let Some(engine_id) = engine_id else {
        return StatusCode::NOT_FOUND.into_response();
    };

    let delete_data = body.map(|Json(body)| body.delete_data).unwrap_or(false);
    let result = if delete_data {
        api.api_torrent_action_delete(orc_engine::api::TorrentIdOrHash::Id(engine_id))
            .await
    } else {
        api.api_torrent_action_forget(orc_engine::api::TorrentIdOrHash::Id(engine_id))
            .await
    };
    if let Err(e) = result {
        // The engine removes the in-memory/persisted torrent before asking custom storage
        // to delete files. Keep ORC's catalog synchronized even when SAF reports a
        // partial deletion (for example after a URI grant is revoked).
        if api
            .mgr_handle(orc_engine::api::TorrentIdOrHash::Id(engine_id))
            .is_err()
        {
            let mut guard = ctx.state.lock().await;
            let _ = remove_torrent(&mut guard, &id);
        }
        let sanitized = sanitize_error(&anyhow::Error::from(e), "Failed to remove torrent");
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({"error": sanitized})),
        )
            .into_response();
    }

    let mut guard = ctx.state.lock().await;
    let _ = remove_torrent(&mut guard, &id);
    StatusCode::OK.into_response()
}

async fn h_recheck(State(ctx): State<AppCtx>, Path(id): Path<String>) -> impl IntoResponse {
    if !validate_torrent_id(&id) {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({
                "error": "Invalid torrent ID format"
            })),
        )
            .into_response();
    }
    {
        let guard = ctx.state.lock().await;
        let policy = get_policy(&guard);
        let killswitch = get_kill_switch(&guard);
        if killswitch.enabled && !policy.effective.network_allowed {
            return (StatusCode::FORBIDDEN, Json(serde_json::json!({
                "error": "Network blocked: VPN kill switch is engaged. Please connect to VPN to resume torrents."
            }))).into_response();
        }
    }

    let (api, engine_id) = {
        let guard = ctx.state.lock().await;
        (engine_api(&guard), engine_id_for(&guard, &id))
    };

    let Some(engine_id) = engine_id else {
        return StatusCode::NOT_FOUND.into_response();
    };

    {
        let mut guard = ctx.state.lock().await;
        let _ = orc_core::force_checking(&mut guard, &id);
    }
    let _ = api
        .api_torrent_action_pause(orc_engine::api::TorrentIdOrHash::Id(engine_id))
        .await;
    let _ = api
        .api_torrent_action_start(orc_engine::api::TorrentIdOrHash::Id(engine_id))
        .await;

    StatusCode::OK.into_response()
}

async fn h_announce(State(ctx): State<AppCtx>, Path(id): Path<String>) -> impl IntoResponse {
    if !validate_torrent_id(&id) {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({
                "error": "Invalid torrent ID format"
            })),
        )
            .into_response();
    }
    {
        let guard = ctx.state.lock().await;
        let policy = get_policy(&guard);
        let killswitch = get_kill_switch(&guard);
        if killswitch.enabled && !policy.effective.network_allowed {
            return (StatusCode::FORBIDDEN, Json(serde_json::json!({
                "error": "Network blocked: VPN kill switch is engaged. Please connect to VPN to resume torrents."
            }))).into_response();
        }
    }

    let (api, engine_id) = {
        let guard = ctx.state.lock().await;
        (engine_api(&guard), engine_id_for(&guard, &id))
    };

    let Some(engine_id) = engine_id else {
        return StatusCode::NOT_FOUND.into_response();
    };
    {
        let mut guard = ctx.state.lock().await;
        let _ = mark_announce(&mut guard, &id);
    }
    let _ = api
        .api_torrent_action_pause(orc_engine::api::TorrentIdOrHash::Id(engine_id))
        .await;
    let _ = api
        .api_torrent_action_start(orc_engine::api::TorrentIdOrHash::Id(engine_id))
        .await;

    StatusCode::OK.into_response()
}

async fn h_peers(State(ctx): State<AppCtx>, Path(id): Path<String>) -> impl IntoResponse {
    if !validate_torrent_id(&id) {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({
                "error": "Invalid torrent ID format"
            })),
        )
            .into_response();
    }

    let mut guard = ctx.state.lock().await;
    match peers_for(&mut guard, &id) {
        Ok(p) => (StatusCode::OK, Json(p)).into_response(),
        Err(_) => StatusCode::NOT_FOUND.into_response(),
    }
}

async fn h_trackers(State(ctx): State<AppCtx>, Path(id): Path<String>) -> impl IntoResponse {
    if !validate_torrent_id(&id) {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({
                "error": "Invalid torrent ID format"
            })),
        )
            .into_response();
    }

    let mut guard = ctx.state.lock().await;
    match trackers_for(&mut guard, &id) {
        Ok(t) => (StatusCode::OK, Json(t)).into_response(),
        Err(_) => StatusCode::NOT_FOUND.into_response(),
    }
}

async fn h_get_row_snapshot(
    State(ctx): State<AppCtx>,
    Path(id): Path<String>,
) -> impl IntoResponse {
    if !validate_torrent_id(&id) {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({
                "error": "Invalid torrent ID format"
            })),
        )
            .into_response();
    }

    let guard = ctx.state.lock().await;
    match get_row_snapshot(&guard, &id) {
        Some(s) => (StatusCode::OK, Json(s)).into_response(),
        None => StatusCode::NOT_FOUND.into_response(),
    }
}

async fn h_admin_shutdown(State(ctx): State<AppCtx>) -> impl IntoResponse {
    info!("admin shutdown accepted");
    ctx.shutdown.notify_one();
    (StatusCode::OK, Json(serde_json::json!({"ok": true}))).into_response()
}

async fn h_privacy_status(State(ctx): State<AppCtx>) -> impl IntoResponse {
    let guard = ctx.state.lock().await;
    Json(privacy_status(&guard))
}

async fn h_vpn_safety_preset(State(ctx): State<AppCtx>) -> impl IntoResponse {
    let result = {
        let mut guard = ctx.state.lock().await;
        let old_bind = net_bind_interface(&guard).map(|s| s.to_string());
        let out = apply_vpn_safety_preset(&mut guard);
        let bind_changed = old_bind.as_deref() != net_bind_interface(&guard);
        if bind_changed {
            if let Err(e) = rebind_engine_session(&mut guard).await {
                let sanitized = sanitize_error(&e, "Failed to rebind network interface");
                return (
                    StatusCode::BAD_REQUEST,
                    Json(serde_json::json!({"error": sanitized})),
                )
                    .into_response();
            }
        }
        let ks = get_kill_switch(&guard);
        let np = net_posture_stored_from_state(&guard);
        let policy = policy_stored_from_state(&guard);
        (out, ks, np, policy)
    };
    let stored_kill_switch = KillSwitchStoredSettings::from(&result.1);
    let stored_posture = result.2.clone();
    let stored_policy = result.3.clone();
    if let Err(e) = persist_config_update(&ctx, move |config| {
        config.kill_switch = Some(stored_kill_switch);
        config.net_posture = stored_posture;
        config.policy = Some(stored_policy);
    })
    .await
    {
        return persistence_failure(&e, "Failed to persist VPN safety preset config");
    }
    Json(result.0).into_response()
}

async fn h_watch_folders(State(ctx): State<AppCtx>) -> impl IntoResponse {
    Json(ctx.watch_manager.get_response().await)
}

async fn h_patch_watch_folders(
    State(ctx): State<AppCtx>,
    Json(req): Json<PatchWatchFoldersRequest>,
) -> impl IntoResponse {
    match ctx
        .watch_manager
        .update_settings(req, ctx.state.clone(), ctx.download_dir.clone())
        .await
    {
        Ok(resp) => {
            let settings = resp.settings.clone();
            if let Err(e) = persist_config_update(&ctx, move |config| {
                config.watch_folders = settings;
            })
            .await
            {
                return persistence_failure(&e, "Failed to persist watch folder config");
            }
            Json(resp).into_response()
        }
        Err(e) => {
            let sanitized = sanitize_error(&e, "Invalid watch folder settings");
            (
                StatusCode::BAD_REQUEST,
                Json(serde_json::json!({"error": sanitized})),
            )
                .into_response()
        }
    }
}

async fn h_watch_folders_test(Json(req): Json<TestWatchFolderRequest>) -> impl IntoResponse {
    Json(watch_folders::test_watch_folder_access(&req).await)
}

async fn h_watch_folders_events(State(ctx): State<AppCtx>) -> impl IntoResponse {
    Json(ctx.watch_manager.get_events().await)
}

async fn h_seeding(State(ctx): State<AppCtx>) -> impl IntoResponse {
    let guard = ctx.state.lock().await;
    Json(guard.seeding_settings.clone())
}

async fn h_patch_seeding(
    State(ctx): State<AppCtx>,
    Json(body): Json<SeedingSettings>,
) -> impl IntoResponse {
    let out = {
        let mut guard = ctx.state.lock().await;
        patch_seeding_settings(&mut guard, body)
    };
    match out {
        Ok(settings) => {
            let persisted_settings = settings.clone();
            if let Err(e) = persist_config_update(&ctx, move |config| {
                config.seeding = persisted_settings;
            })
            .await
            {
                return persistence_failure(&e, "Failed to persist seeding config");
            }
            Json(settings).into_response()
        }
        Err(e) => {
            let sanitized = sanitize_error(&e, "Invalid seeding settings");
            (
                StatusCode::BAD_REQUEST,
                Json(serde_json::json!({"error": sanitized})),
            )
                .into_response()
        }
    }
}

async fn h_get_limits(State(ctx): State<AppCtx>) -> impl IntoResponse {
    let guard = ctx.state.lock().await;
    Json(session_rate_limits_response(&guard))
}

#[derive(serde::Deserialize)]
struct PostLimitsBody {
    download_bps: Option<u32>,
    upload_bps: Option<u32>,
}

async fn h_post_limits(
    State(ctx): State<AppCtx>,
    Json(body): Json<PostLimitsBody>,
) -> impl IntoResponse {
    let result = {
        let mut guard = ctx.state.lock().await;
        set_session_rate_limits(&mut guard, body.download_bps, body.upload_bps)
    };
    match result {
        Ok(()) => {
            let bandwidth = {
                let guard = ctx.state.lock().await;
                guard.bandwidth_settings.clone()
            };
            if let Err(e) = persist_config_update(&ctx, move |config| {
                config.bandwidth = bandwidth;
            })
            .await
            {
                return persistence_failure(&e, "Failed to persist bandwidth config");
            }
            let guard = ctx.state.lock().await;
            Json(session_rate_limits_response(&guard)).into_response()
        }
        Err(e) => {
            let sanitized = sanitize_error(&e, "Invalid rate limits");
            (
                StatusCode::BAD_REQUEST,
                Json(serde_json::json!({"error": sanitized})),
            )
                .into_response()
        }
    }
}

async fn h_patch_bandwidth_schedule(
    State(ctx): State<AppCtx>,
    Json(body): Json<BandwidthSettings>,
) -> impl IntoResponse {
    let result = {
        let mut guard = ctx.state.lock().await;
        patch_bandwidth_settings(&mut guard, body)
    };
    match result {
        Ok(settings) => {
            let persisted_settings = settings.clone();
            if let Err(e) = persist_config_update(&ctx, move |config| {
                config.bandwidth = persisted_settings;
            })
            .await
            {
                return persistence_failure(&e, "Failed to persist bandwidth config");
            }
            Json(settings).into_response()
        }
        Err(e) => {
            let sanitized = sanitize_error(&e, "Invalid bandwidth settings");
            (
                StatusCode::BAD_REQUEST,
                Json(serde_json::json!({"error": sanitized})),
            )
                .into_response()
        }
    }
}

async fn h_get_torrent_seeding(
    State(ctx): State<AppCtx>,
    Path(id): Path<String>,
) -> impl IntoResponse {
    if !validate_torrent_id(&id) {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({"error": "Invalid torrent ID format"})),
        )
            .into_response();
    }
    let guard = ctx.state.lock().await;
    let torrent = match get_torrent(&guard, &id) {
        Some(t) => t,
        None => return StatusCode::NOT_FOUND.into_response(),
    };
    Json(effective_seeding_policy(&torrent, &guard.seeding_settings)).into_response()
}

#[derive(serde::Deserialize)]
struct PatchTorrentSeedingBody {
    #[serde(default)]
    seeding_override: Option<SeedingSettings>,
}

async fn h_patch_torrent_seeding(
    State(ctx): State<AppCtx>,
    Path(id): Path<String>,
    Json(body): Json<PatchTorrentSeedingBody>,
) -> impl IntoResponse {
    if !validate_torrent_id(&id) {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({"error": "Invalid torrent ID format"})),
        )
            .into_response();
    }
    let result = {
        let mut guard = ctx.state.lock().await;
        patch_torrent_seeding_override(&mut guard, &id, body.seeding_override)
    };
    match result {
        Ok(policy) => Json(policy).into_response(),
        Err(e) => {
            let sanitized = sanitize_error(&e, "Failed to update torrent seeding policy");
            (
                StatusCode::BAD_REQUEST,
                Json(serde_json::json!({"error": sanitized})),
            )
                .into_response()
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{
        admin_token_authorized, allowed_save_path, build_cors_layer, is_public_route,
        origin_authorized, request_requires_token, require_api_security, sanitize_error,
        ApiSecurity,
    };
    use axum::{
        body::Body,
        http::{header, HeaderMap, HeaderValue, Method, Request, StatusCode},
        routing::post,
        Router,
    };
    use tower::ServiceExt;

    const TEST_TOKEN: &str = "0123456789abcdef0123456789abcdef";

    fn protected_test_router() -> Router {
        let origin = HeaderValue::from_static("orc://desktop");
        Router::new()
            .route(
                "/protected",
                post(|| async { StatusCode::NO_CONTENT })
                    .patch(|| async { StatusCode::NO_CONTENT })
                    .put(|| async { StatusCode::NO_CONTENT })
                    .delete(|| async { StatusCode::NO_CONTENT }),
            )
            .layer(axum::middleware::from_fn_with_state(
                ApiSecurity {
                    admin_token: TEST_TOKEN.to_string(),
                    allowed_origin: origin.clone(),
                },
                require_api_security,
            ))
            .layer(build_cors_layer(origin))
    }

    #[test]
    fn admin_token_empty_expected_is_fail_closed() {
        let mut h = HeaderMap::new();
        h.insert("x-admin-token", HeaderValue::from_static("anything"));
        assert!(!admin_token_authorized(&h, ""));
    }

    #[test]
    fn admin_token_matches_header() {
        let mut h = HeaderMap::new();
        h.insert(
            "x-admin-token",
            HeaderValue::from_static("secret-token-value-here-32chars"),
        );
        assert!(admin_token_authorized(
            &h,
            "secret-token-value-here-32chars"
        ));
    }

    #[test]
    fn admin_token_wrong_length_rejected() {
        let mut h = HeaderMap::new();
        h.insert("x-admin-token", HeaderValue::from_static("short"));
        assert!(!admin_token_authorized(
            &h,
            "secret-token-value-here-32chars"
        ));
    }

    #[test]
    fn admin_token_missing_rejected_when_expected_set() {
        let h = HeaderMap::new();
        assert!(!admin_token_authorized(
            &h,
            "secret-token-value-here-32chars"
        ));
    }

    #[test]
    fn every_mutating_method_requires_a_token() {
        for method in [Method::POST, Method::PATCH, Method::PUT, Method::DELETE] {
            assert!(request_requires_token(&method, "/torrents/example"));
            assert!(request_requires_token(&method, "/health"));
        }
        assert!(request_requires_token(&Method::GET, "/torrents"));
        assert!(is_public_route(&Method::GET, "/health"));
        assert!(is_public_route(&Method::GET, "/version"));
    }

    #[test]
    fn origin_must_be_present_exact_and_non_opaque() {
        let expected = HeaderValue::from_static("orc://desktop");
        let mut headers = HeaderMap::new();
        assert!(!origin_authorized(&headers, &expected));
        headers.insert(header::ORIGIN, HeaderValue::from_static("null"));
        assert!(!origin_authorized(&headers, &expected));
        headers.insert(
            header::ORIGIN,
            HeaderValue::from_static("https://attacker.example"),
        );
        assert!(!origin_authorized(&headers, &expected));
        headers.insert(header::ORIGIN, expected.clone());
        assert!(origin_authorized(&headers, &expected));
    }

    #[test]
    fn error_sanitization_is_unicode_safe_at_limit() {
        let message = format!("{}🙂tail", "界".repeat(199));
        let error = anyhow::anyhow!(message);
        let sanitized = sanitize_error(&error, "unicode test");
        assert!(sanitized.ends_with("..."));
        assert_eq!(sanitized.chars().count(), 203);
    }

    #[tokio::test]
    async fn protected_mutations_reject_missing_token_for_every_method() {
        for method in [Method::POST, Method::PATCH, Method::PUT, Method::DELETE] {
            let response = protected_test_router()
                .oneshot(
                    Request::builder()
                        .method(method)
                        .uri("/protected")
                        .header(header::ORIGIN, "orc://desktop")
                        .body(Body::empty())
                        .unwrap(),
                )
                .await
                .unwrap();
            assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
        }
    }

    #[tokio::test]
    async fn protected_route_accepts_exact_origin_and_token() {
        let response = protected_test_router()
            .oneshot(
                Request::builder()
                    .method(Method::POST)
                    .uri("/protected")
                    .header(header::ORIGIN, "orc://desktop")
                    .header("x-admin-token", TEST_TOKEN)
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::NO_CONTENT);
    }

    #[tokio::test]
    async fn unrelated_origin_fails_cors_preflight() {
        let response = protected_test_router()
            .oneshot(
                Request::builder()
                    .method(Method::OPTIONS)
                    .uri("/protected")
                    .header(header::ORIGIN, "https://attacker.example")
                    .header(header::ACCESS_CONTROL_REQUEST_METHOD, "POST")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_ne!(
            response
                .headers()
                .get(header::ACCESS_CONTROL_ALLOW_ORIGIN)
                .and_then(|value| value.to_str().ok()),
            Some("https://attacker.example")
        );

        let mutation = protected_test_router()
            .oneshot(
                Request::builder()
                    .method(Method::POST)
                    .uri("/protected")
                    .header(header::ORIGIN, "https://attacker.example")
                    .header("x-admin-token", TEST_TOKEN)
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(mutation.status(), StatusCode::FORBIDDEN);
    }

    #[test]
    fn save_path_is_confined_to_dedicated_download_root() {
        let root = tempfile::tempdir().unwrap();
        let download_root = root.path().join("ORC Torrent");
        std::fs::create_dir_all(&download_root).unwrap();
        let nested = download_root.join("new").join("torrent");
        let expected = download_root
            .canonicalize()
            .unwrap()
            .join("new")
            .join("torrent");
        assert_eq!(
            allowed_save_path(nested.to_str().unwrap(), &download_root).unwrap(),
            expected.to_string_lossy()
        );
        assert!(allowed_save_path(
            root.path().join("outside").to_str().unwrap(),
            &download_root
        )
        .is_err());
    }

    #[cfg(unix)]
    #[test]
    fn save_path_rejects_symlink_escape() {
        use std::os::unix::fs::symlink;

        let root = tempfile::tempdir().unwrap();
        let download_root = root.path().join("ORC Torrent");
        let outside = root.path().join("outside");
        std::fs::create_dir_all(&download_root).unwrap();
        std::fs::create_dir_all(&outside).unwrap();
        symlink(&outside, download_root.join("escape")).unwrap();
        assert!(allowed_save_path(
            download_root.join("escape/file").to_str().unwrap(),
            &download_root
        )
        .is_err());
    }
}
