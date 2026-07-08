mod config;
mod search;
mod watch_folders;

use std::path::{Component, Path as StdPath, PathBuf};
use std::{net::SocketAddr, sync::Arc, time::Duration};

use axum::{
    extract::{Path, Request, State},
    http::{HeaderMap, Method, StatusCode},
    middleware::Next,
    response::IntoResponse,
    routing::{get, patch, post},
    Json, Router,
};
use subtle::ConstantTimeEq;
use tower::limit::ConcurrencyLimitLayer;
use tower_http::{
    cors::{Any, CorsLayer},
    limit::RequestBodyLimitLayer,
    set_header::SetResponseHeaderLayer,
    trace::TraceLayer,
};
use tracing::{error, info, warn};

use librqbit::api::Api as RqbitApi;
use orc_core::{
    apply_bandwidth_profile_limits, apply_net_posture_stored, apply_policy_stored,
    apply_stored_kill_switch, apply_vpn_safety_preset, build_add_torrent_options,
    drain_seeding_stop_pending,
    effective_seeding_policy, extract_info_hash_from_magnet, extract_info_hash_from_torrent_bytes,
    find_torrent_by_info_hash, get_content, get_kill_switch, get_policy, get_row_snapshot,
    get_status, get_torrent, health, integrate_added_torrent, list_torrents, mark_announce,
    media_download_policy_enabled, net_bind_interface, net_posture, net_posture_stored_from_state,
    new_state, only_files_for, overlay_status,
    patch_bandwidth_settings, patch_kill_switch, patch_net_posture, patch_policy,
    patch_seeding_settings, patch_torrent_seeding_override, peers_for, policy_stored_from_state,
    prepare_add_input, privacy_status, rebind_rqbit_session, remove_torrent,
    resolve_torrent_output_folder, rqbit_api, rqbit_id_for, session_rate_limits_response,
    set_file_priority, set_profile, set_running, set_session_rate_limits, tick, trackers_for,
    version, wallet_status, AddTorrentInput, AddTorrentRequest, BandwidthSettings,
    KillSwitchStoredSettings, PatchFilePriorityRequest, PatchKillSwitchRequest,
    PatchNetPostureRequest, PatchPolicyRequest, PatchTorrentProfileRequest, SeedingSettings,
    SharedState,
};
use search::{
    available_providers, execute_search, search_settings_response,
    SearchQuery, SearchSettingsPatchRequest,
};
use watch_folders::{PatchWatchFoldersRequest, TestWatchFolderRequest, WatchFolderManager};

#[derive(Clone)]
struct AppCtx {
    state: SharedState,
    config: Arc<tokio::sync::RwLock<config::DaemonConfig>>,
    admin_token: String,
    shutdown: std::sync::Arc<tokio::sync::Notify>,
    /// When false, mutating HTTP methods require `x-admin-token` (same as shutdown).
    bind_is_loopback: bool,
    watch_manager: Arc<WatchFolderManager>,
    download_dir: PathBuf,
}

/// Constant-time admin token check. Empty `expected` means no token configured (allow).
fn admin_token_authorized(headers: &HeaderMap, expected: &str) -> bool {
    if expected.is_empty() {
        return true;
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

fn build_cors_layer(bind_is_loopback: bool) -> CorsLayer {
    if bind_is_loopback {
        CorsLayer::new()
            .allow_origin(Any)
            .allow_methods([
                Method::GET,
                Method::POST,
                Method::PATCH,
                Method::DELETE,
                Method::OPTIONS,
            ])
            .allow_headers(Any)
            .max_age(Duration::from_secs(3600))
    } else {
        // Deny cross-origin browser access; native/LAN clients are unaffected.
        CorsLayer::new()
    }
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

async fn sync_media_download_policy(api: &RqbitApi, torrent_id: &str, state: &SharedState) {
    if !media_download_policy_enabled() {
        return;
    }

    let (rqbit_id, only_files) = {
        let guard = state.lock().await;
        (
            rqbit_id_for(&guard, torrent_id),
            only_files_for(&guard, torrent_id),
        )
    };

    let (Some(rqbit_id), Some(only_files)) = (rqbit_id, only_files) else {
        return;
    };

    if only_files.is_empty() {
        return;
    }

    if let Err(error) = api
        .api_torrent_action_update_only_files(librqbit::api::TorrentIdOrHash::Id(rqbit_id), &only_files)
        .await
    {
        warn!(
            "Failed to sync AnimUS media download policy for torrent {torrent_id}: {error:?}"
        );
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

/// Validate save_path: must be under download_dir_path or user home. Returns canonicalized path string.
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
    // Allowed roots: download_dir (already canonical) and user home
    let download_root = download_dir_path
        .canonicalize()
        .unwrap_or_else(|_| download_dir_path.to_path_buf());
    let mut allowed_roots: Vec<PathBuf> = vec![download_root];
    if let Ok(home) = std::env::var("HOME").or_else(|_| std::env::var("USERPROFILE")) {
        if !home.is_empty() {
            let home_path = PathBuf::from(&home);
            if let Ok(canon) = home_path.canonicalize() {
                allowed_roots.push(canon);
            } else {
                allowed_roots.push(home_path);
            }
        }
    }
    let allowed = normalized
        .canonicalize()
        .unwrap_or_else(|_| normalized.clone());
    let under_allowed = allowed_roots.iter().any(|root| allowed.starts_with(root));
    if under_allowed {
        Ok(allowed.to_string_lossy().to_string())
    } else {
        Err(anyhow::anyhow!(
            "save_path must be under the download directory or your home directory"
        ))
    }
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

/// When bound beyond loopback, require admin token for POST/PATCH/DELETE (renderer stays loopback-only).
async fn require_auth_non_loopback_mutations(
    State(ctx): State<AppCtx>,
    request: Request,
    next: Next,
) -> axum::response::Response {
    if ctx.bind_is_loopback {
        return next.run(request).await;
    }
    if matches!(
        *request.method(),
        Method::POST | Method::PATCH | Method::DELETE
    ) && !admin_token_authorized(request.headers(), &ctx.admin_token)
    {
        warn!("Mutating request rejected: invalid or missing x-admin-token (non-loopback bind)");
        return (
            StatusCode::UNAUTHORIZED,
            Json(serde_json::json!({"error": "unauthorized"})),
        )
            .into_response();
    }
    next.run(request).await
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
    if sanitized.len() > 200 {
        format!("{}...", &sanitized[..200])
    } else {
        sanitized
    }
}

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
                return format!("{}\\Downloads", profile.trim_end_matches('\\'));
            }
        }
    }
    #[cfg(not(windows))]
    {
        if let Ok(home) = std::env::var("HOME") {
            if !home.is_empty() {
                return format!("{}/Downloads", home.trim_end_matches('/'));
            }
        }
    }
    "./downloads".to_string()
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    setup_panic_handler();
    tracing_subscriber::fmt()
        .with_env_filter(tracing_subscriber::EnvFilter::from_default_env())
        .with_target(false)
        .with_thread_ids(false)
        .init();

    let admin_token = std::env::var("DAEMON_ADMIN_TOKEN").unwrap_or_else(|_| "".to_string());
    if !admin_token.is_empty() && admin_token.len() < 32 {
        warn!("DAEMON_ADMIN_TOKEN is shorter than recommended 32 characters. Consider using a longer token for better security.");
    }
    let bind = std::env::var("DAEMON_BIND").unwrap_or_else(|_| "127.0.0.1:8733".to_string());
    let addr: SocketAddr = bind
        .parse()
        .map_err(|e| anyhow::anyhow!("Invalid DAEMON_BIND '{}': {}", bind, e))?;
    let bind_is_loopback = addr.ip().is_loopback();

    if !bind_is_loopback && admin_token.is_empty() {
        return Err(anyhow::anyhow!(
            "SECURITY ERROR: Binding to non-localhost address {} requires DAEMON_ADMIN_TOKEN to be set. \
            For production use, always set a strong admin token when exposing to network.",
            addr.ip()
        ));
    }

    let download_dir = std::env::var("ORC_DOWNLOAD_DIR").unwrap_or_else(|_| default_download_dir());
    tracing::info!("Download directory: {}", download_dir);
    let config = config::load_config().await.unwrap_or_else(|e| {
        tracing::warn!("Failed to load config, using defaults: {e}");
        let mut config = config::DaemonConfig::default();
        search::apply_edition_search_defaults(&mut config.search);
        config
    });

    tracing::info!("Using listen port: {}", config.listen_port);
    tokio::fs::create_dir_all(&download_dir).await?;

    let bind_iface = config.net_posture.bind_interface.clone();
    let state = new_state(download_dir.clone(), config.listen_port, bind_iface).await?;
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
    let watch_manager = Arc::new(WatchFolderManager::new(config.watch_folders.clone()));
    let shutdown_notify = Arc::new(tokio::sync::Notify::new());
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
                    drain_seeding_stop_pending(&mut guard)
                };
                for id in pending {
                    let api = {
                        let guard = s.lock().await;
                        rqbit_api(&guard)
                    };
                    let rqbit_id = {
                        let guard = s.lock().await;
                        rqbit_id_for(&guard, &id)
                    };
                    if let Some(rqbit_id) = rqbit_id {
                        if let Err(e) = api
                            .api_torrent_action_pause(librqbit::api::TorrentIdOrHash::Id(rqbit_id))
                            .await
                        {
                            warn!("seeding limit pause failed for {id}: {e}");
                        }
                    }
                }
            }
        });
    }
    let cors = build_cors_layer(bind_is_loopback);
    use axum::http::HeaderValue;
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

    let app_ctx = AppCtx {
        state,
        config: config_state,
        admin_token,
        shutdown: shutdown_notify.clone(),
        bind_is_loopback,
        watch_manager,
        download_dir: PathBuf::from(download_dir),
    };

    let app = Router::new()
        .route("/health", get(h_health))
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
        .route(
            "/watch-folders",
            get(h_watch_folders).patch(h_patch_watch_folders),
        )
        .route("/watch-folders/test", post(h_watch_folders_test))
        .route("/watch-folders/events", get(h_watch_folders_events))
        .route("/seeding", get(h_seeding).patch(h_patch_seeding))
        .route("/torrents/limits", get(h_get_limits).post(h_post_limits))
        .route("/bandwidth/schedule", patch(h_patch_bandwidth_schedule))
        .route(
            "/torrents/:id/seeding",
            get(h_get_torrent_seeding).patch(h_patch_torrent_seeding),
        )
        .route("/search/providers", get(h_search_providers))
        .route(
            "/search/settings",
            get(h_search_settings).patch(h_patch_search_settings),
        )
        .route("/search", post(h_search))
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
        .route("/admin/shutdown", post(h_admin_shutdown))
        .with_state(app_ctx.clone())
        .layer(axum::middleware::from_fn_with_state(
            app_ctx.clone(),
            require_auth_non_loopback_mutations,
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
        async move {
            tokio::select! {
                _ = tokio::signal::ctrl_c() => {
                    info!("ctrl-c received; shutting down");
                }
                _ = shutdown_notify.notified() => {
                    info!("admin shutdown requested");
                }
            }
        }
    };

    let listener = tokio::net::TcpListener::bind(addr).await?;
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
        let sanitized = sanitize_error(&anyhow::Error::from(e), "Invalid net posture request");
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
        if let Err(e) = rebind_rqbit_session(&mut guard).await {
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

    let updated = {
        let mut config = ctx.config.write().await;
        config.net_posture = stored;
        config.kill_switch = Some(kill_switch_stored);
        config.policy = Some(policy_stored);
        config.clone()
    };
    if let Err(e) = config::save_config(&updated).await {
        warn!("Failed to persist net posture config: {e}");
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
        let sanitized = sanitize_error(&anyhow::Error::from(e), "Invalid kill switch request");
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

    let updated = {
        let mut config = ctx.config.write().await;
        config.kill_switch = Some(stored);
        config.net_posture = posture_stored;
        config.policy = Some(policy_stored);
        config.clone()
    };
    if let Err(e) = config::save_config(&updated).await {
        warn!("Failed to persist kill switch config: {e}");
    }

    Json(out).into_response()
}

async fn h_kill_switch_test(State(ctx): State<AppCtx>) -> impl IntoResponse {
    let guard = ctx.state.lock().await;
    if orc_core::get_kill_switch(&guard).enabled {
        Json(serde_json::json!({"ok": true, "message": "Kill switch is enabled (simulation)."}))
    } else {
        Json(serde_json::json!({"ok": false, "message": "Kill switch is disabled."}))
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
        let sanitized = sanitize_error(&anyhow::Error::from(e), "Invalid policy request");
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({"error": sanitized})),
        )
            .into_response();
    }

    let mut guard = ctx.state.lock().await;
    let out = patch_policy(&mut guard, req.desired_patch);
    let policy_stored = policy_stored_from_state(&guard);
    drop(guard);
    let updated = {
        let mut config = ctx.config.write().await;
        config.policy = Some(policy_stored);
        config.clone()
    };
    if let Err(e) = config::save_config(&updated).await {
        warn!("Failed to persist policy config: {e}");
    }
    Json(out).into_response()
}

async fn h_search_settings(State(ctx): State<AppCtx>) -> impl IntoResponse {
    let config = ctx.config.read().await;
    match search_settings_response(&config.search) {
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

async fn h_patch_search_settings(
    State(ctx): State<AppCtx>,
    Json(req): Json<SearchSettingsPatchRequest>,
) -> impl IntoResponse {
    if let Err(e) = req.validate() {
        let sanitized = sanitize_error(&anyhow::Error::from(e), "Invalid search settings request");
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({"error": sanitized})),
        )
            .into_response();
    }

    let updated = {
        let mut config = ctx.config.write().await;
        match req.apply(&config.search) {
            Ok(updated) => {
                config.search = updated.clone();
                config.clone()
            }
            Err(e) => {
                let sanitized = sanitize_error(&e, "Invalid search settings request");
                return (
                    StatusCode::BAD_REQUEST,
                    Json(serde_json::json!({"error": sanitized})),
                )
                    .into_response();
            }
        }
    };

    if let Err(e) = config::save_config(&updated).await {
        let sanitized = sanitize_error(&e, "Failed to persist search settings");
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({ "error": sanitized })),
        )
            .into_response();
    }

    match search_settings_response(&updated.search) {
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
    match available_providers(&config.search) {
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

async fn h_search(State(ctx): State<AppCtx>, Json(req): Json<SearchQuery>) -> impl IntoResponse {
    let settings = {
        let config = ctx.config.read().await;
        config.search.clone()
    };

    match execute_search(&settings, req).await {
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

async fn h_list_torrents(State(ctx): State<AppCtx>) -> impl IntoResponse {
    let guard = ctx.state.lock().await;
    Json(list_torrents(&guard))
}

async fn h_add_torrent(
    State(ctx): State<AppCtx>,
    Json(req): Json<AddTorrentRequest>,
) -> impl IntoResponse {
    if let Err(e) = req.validate() {
        let sanitized = sanitize_error(&anyhow::Error::from(e), "Invalid add torrent request");
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({"error": sanitized})),
        )
            .into_response();
    }

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
                rqbit_api(&guard)
            };

            let rqbit_id = {
                let guard = ctx.state.lock().await;
                rqbit_id_for(&guard, &id)
            };
            if let Some(rqbit_id) = rqbit_id {
                if !is_running {
                    if let Err(e) = api
                        .api_torrent_action_start(librqbit::api::TorrentIdOrHash::Id(rqbit_id))
                        .await
                    {
                        error!("rqbit start failed for existing torrent: {e:?}");
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
    let (api, default_download_path) = {
        let guard = ctx.state.lock().await;
        (rqbit_api(&guard), guard.download_dir_path().clone())
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
    let opts = build_add_torrent_options(output_folder.clone());
    let rqbit_resp = match &input {
        AddTorrentInput::Url(u) => {
            api.api_add_torrent(librqbit::AddTorrent::from_url(u.as_str()), Some(opts))
                .await
        }
        AddTorrentInput::TorrentBytes(bytes) => {
            api.api_add_torrent(librqbit::AddTorrent::from_bytes(bytes.clone()), Some(opts))
                .await
        }
    };

    let rqbit_resp = match rqbit_resp {
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
                let retry_opts = build_add_torrent_options(output_folder.clone());
                match &input {
                    AddTorrentInput::Url(u) => {
                        api.api_add_torrent(
                            librqbit::AddTorrent::from_url(u.as_str()),
                            Some(retry_opts),
                        )
                        .await
                    }
                    AddTorrentInput::TorrentBytes(bytes) => {
                        api.api_add_torrent(
                            librqbit::AddTorrent::from_bytes(bytes.clone()),
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

    let rqbit_resp = match rqbit_resp {
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
        match integrate_added_torrent(&mut guard, &req, rqbit_resp) {
            Ok(r) => r,
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
        rqbit_api(&guard)
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
        let sanitized = sanitize_error(&anyhow::Error::from(e), "Invalid file priority request");
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({"error": sanitized})),
        )
            .into_response();
    }
    let (api, rqbit_id, only_files) = {
        let mut guard = ctx.state.lock().await;
        if set_file_priority(&mut guard, &id, req).is_err() {
            return StatusCode::NOT_FOUND.into_response();
        }
        (
            rqbit_api(&guard),
            rqbit_id_for(&guard, &id),
            only_files_for(&guard, &id),
        )
    };
    if let (Some(rqbit_id), Some(only_files)) = (rqbit_id, only_files) {
        if let Err(e) = api
            .api_torrent_action_update_only_files(
                librqbit::api::TorrentIdOrHash::Id(rqbit_id),
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
        let sanitized = sanitize_error(&anyhow::Error::from(e), "Invalid profile request");
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

    let (api, rqbit_id) = {
        let guard = ctx.state.lock().await;
        (rqbit_api(&guard), rqbit_id_for(&guard, &id))
    };

    let Some(rqbit_id) = rqbit_id else {
        return StatusCode::NOT_FOUND.into_response();
    };

    if let Err(e) = api
        .api_torrent_action_start(librqbit::api::TorrentIdOrHash::Id(rqbit_id))
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

    let (api, rqbit_id) = {
        let guard = ctx.state.lock().await;
        (rqbit_api(&guard), rqbit_id_for(&guard, &id))
    };

    let Some(rqbit_id) = rqbit_id else {
        return StatusCode::NOT_FOUND.into_response();
    };

    if let Err(e) = api
        .api_torrent_action_pause(librqbit::api::TorrentIdOrHash::Id(rqbit_id))
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

async fn h_remove(State(ctx): State<AppCtx>, Path(id): Path<String>) -> impl IntoResponse {
    if !validate_torrent_id(&id) {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({
                "error": "Invalid torrent ID format"
            })),
        )
            .into_response();
    }

    let (api, rqbit_id) = {
        let guard = ctx.state.lock().await;
        (rqbit_api(&guard), rqbit_id_for(&guard, &id))
    };

    let Some(rqbit_id) = rqbit_id else {
        return StatusCode::NOT_FOUND.into_response();
    };

    if let Err(e) = api
        .api_torrent_action_forget(librqbit::api::TorrentIdOrHash::Id(rqbit_id))
        .await
    {
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

    let (api, rqbit_id) = {
        let guard = ctx.state.lock().await;
        (rqbit_api(&guard), rqbit_id_for(&guard, &id))
    };

    let Some(rqbit_id) = rqbit_id else {
        return StatusCode::NOT_FOUND.into_response();
    };

    {
        let mut guard = ctx.state.lock().await;
        let _ = orc_core::force_checking(&mut guard, &id);
    }
    let _ = api
        .api_torrent_action_pause(librqbit::api::TorrentIdOrHash::Id(rqbit_id))
        .await;
    let _ = api
        .api_torrent_action_start(librqbit::api::TorrentIdOrHash::Id(rqbit_id))
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

    let (api, rqbit_id) = {
        let guard = ctx.state.lock().await;
        (rqbit_api(&guard), rqbit_id_for(&guard, &id))
    };

    let Some(rqbit_id) = rqbit_id else {
        return StatusCode::NOT_FOUND.into_response();
    };
    {
        let mut guard = ctx.state.lock().await;
        let _ = mark_announce(&mut guard, &id);
    }
    let _ = api
        .api_torrent_action_pause(librqbit::api::TorrentIdOrHash::Id(rqbit_id))
        .await;
    let _ = api
        .api_torrent_action_start(librqbit::api::TorrentIdOrHash::Id(rqbit_id))
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

async fn h_admin_shutdown(State(ctx): State<AppCtx>, headers: HeaderMap) -> impl IntoResponse {
    if !admin_token_authorized(&headers, &ctx.admin_token) {
        warn!("Admin shutdown attempt with invalid token");
        return (
            StatusCode::UNAUTHORIZED,
            Json(serde_json::json!({"error": "unauthorized"})),
        )
            .into_response();
    }

    info!("admin shutdown accepted");
    ctx.shutdown.notify_waiters();
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
            if let Err(e) = rebind_rqbit_session(&mut guard).await {
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
    let updated = {
        let mut config = ctx.config.write().await;
        config.kill_switch = Some(KillSwitchStoredSettings::from(&result.1));
        config.net_posture = result.2;
        config.policy = Some(result.3);
        config.clone()
    };
    if let Err(e) = config::save_config(&updated).await {
        warn!("Failed to persist VPN safety preset config: {e}");
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
            let updated = {
                let mut config = ctx.config.write().await;
                config.watch_folders = resp.settings.clone();
                config.clone()
            };
            if let Err(e) = config::save_config(&updated).await {
                warn!("Failed to persist watch folder config: {e}");
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
        match patch_seeding_settings(&mut guard, body) {
            Ok(s) => Ok(s),
            Err(e) => Err(e),
        }
    };
    match out {
        Ok(settings) => {
            let updated = {
                let mut config = ctx.config.write().await;
                config.seeding = settings.clone();
                config.clone()
            };
            if let Err(e) = config::save_config(&updated).await {
                warn!("Failed to persist seeding config: {e}");
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
            let updated = {
                let mut config = ctx.config.write().await;
                let guard = ctx.state.lock().await;
                config.bandwidth = guard.bandwidth_settings.clone();
                config.clone()
            };
            if let Err(e) = config::save_config(&updated).await {
                warn!("Failed to persist bandwidth config: {e}");
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
            let updated = {
                let mut config = ctx.config.write().await;
                config.bandwidth = settings.clone();
                config.clone()
            };
            if let Err(e) = config::save_config(&updated).await {
                warn!("Failed to persist bandwidth config: {e}");
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
    use super::admin_token_authorized;
    use axum::http::{HeaderMap, HeaderValue};

    #[test]
    fn admin_token_empty_expected_allows() {
        let mut h = HeaderMap::new();
        h.insert("x-admin-token", HeaderValue::from_static("anything"));
        assert!(admin_token_authorized(&h, ""));
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
}
