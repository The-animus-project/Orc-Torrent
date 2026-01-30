mod config;

use std::{net::SocketAddr, sync::Arc, time::Duration};

use axum::{
    extract::{Path, Request, State},
    http::{HeaderMap, Method, StatusCode},
    middleware::Next,
    response::IntoResponse,
    routing::{get, patch, post},
    Json, Router,
};
use tower_http::{
    cors::{Any, CorsLayer},
    limit::RequestBodyLimitLayer,
    set_header::SetResponseHeaderLayer,
    trace::TraceLayer,
};
use tower::limit::ConcurrencyLimitLayer;
use tracing::{error, info, warn};
use subtle::ConstantTimeEq;

use orc_core::{
    get_torrent,
    get_status,
    get_content,
    get_row_snapshot,
    get_policy,
    get_kill_switch,
    list_torrents,
    net_posture,
    overlay_status,
    patch_kill_switch,
    patch_policy,
    prepare_add_input,
    integrate_added_torrent,
    extract_info_hash_from_magnet,
    extract_info_hash_from_torrent_bytes,
    find_torrent_by_info_hash,
    rqbit_api,
    rqbit_id_for,
    only_files_for,
    remove_torrent,
    set_file_priority,
    set_profile,
    set_running,
    tick,
    trackers_for,
    peers_for,
    mark_announce,
    version,
    wallet_status,
    health,
    AddTorrentRequest,
    AddTorrentInput,
    PatchFilePriorityRequest,
    PatchKillSwitchRequest,
    PatchPolicyRequest,
    PatchTorrentProfileRequest,
    SharedState,
    new_state,
};

#[derive(Clone)]
struct AppCtx {
    state: SharedState,
    admin_token: String,
    shutdown: std::sync::Arc<tokio::sync::Notify>,
}

fn validate_torrent_id(id: &str) -> bool {
    if id.len() == 36 {
        let parts: Vec<&str> = id.split('-').collect();
        if parts.len() == 5 
            && parts[0].len() == 8 && parts[0].chars().all(|c| c.is_ascii_hexdigit())
            && parts[1].len() == 4 && parts[1].chars().all(|c| c.is_ascii_hexdigit())
            && parts[2].len() == 4 && parts[2].chars().all(|c| c.is_ascii_hexdigit())
            && parts[3].len() == 4 && parts[3].chars().all(|c| c.is_ascii_hexdigit())
            && parts[4].len() == 12 && parts[4].chars().all(|c| c.is_ascii_hexdigit()) {
            return true;
        }
    } else if id.len() == 32 {
        return id.chars().all(|c| c.is_ascii_hexdigit());
    }
    false
}

async fn validate_content_type(
    request: Request,
    next: Next,
) -> impl IntoResponse {
    if matches!(request.method(), &Method::POST | &Method::PATCH) {
        let has_body = request.headers()
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
                    ).into_response();
                }
            } else {
                return (
                    StatusCode::BAD_REQUEST,
                    Json(serde_json::json!({"error": "Content-Type header is required"})),
                ).into_response();
            }
        }
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
            error!("Location: {}:{}:{}", location.file(), location.line(), location.column());
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
    let addr: SocketAddr = bind.parse().map_err(|e| anyhow::anyhow!("Invalid DAEMON_BIND '{}': {}", bind, e))?;
    
    if !addr.ip().is_loopback() && admin_token.is_empty() {
        return Err(anyhow::anyhow!(
            "SECURITY ERROR: Binding to non-localhost address {} requires DAEMON_ADMIN_TOKEN to be set. \
            For production use, always set a strong admin token when exposing to network.",
            addr.ip()
        ));
    }
    
    let download_dir = std::env::var("ORC_DOWNLOAD_DIR").unwrap_or_else(|_| default_download_dir());
    tracing::info!("Download directory: {}", download_dir);
    let config = config::load_config().await
        .unwrap_or_else(|e| {
            tracing::warn!("Failed to load config, using defaults: {e}");
            config::DaemonConfig::default()
        });
    
    tracing::info!("Using listen port: {}", config.listen_port);
    tokio::fs::create_dir_all(&download_dir).await?;

    let state = new_state(download_dir, config.listen_port).await?;
    let shutdown_notify = Arc::new(tokio::sync::Notify::new());
    {
        let s = state.clone();
        tokio::spawn(async move {
            let mut interval = tokio::time::interval(Duration::from_secs(1));
            loop {
                interval.tick().await;
                let mut guard = s.lock().await;
                tick(&mut guard);
            }
        });
    }
    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods([Method::GET, Method::POST, Method::PATCH, Method::DELETE, Method::OPTIONS])
        .allow_headers(Any)
        .max_age(Duration::from_secs(3600));
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

    let app = Router::new()
        .route("/health", get(h_health))
        .route("/version", get(h_version))
        .route("/wallet", get(h_wallet))
        .route("/overlay/status", get(h_overlay_status))
        .route("/net/posture", get(h_net_posture))
        .route("/net/vpn-status", get(h_vpn_status))
        .route("/net/kill-switch", get(h_kill_switch).patch(h_patch_kill_switch))
        .route("/net/kill-switch/test", post(h_kill_switch_test))
        .route("/v1/policy", get(h_policy).patch(h_patch_policy))
        .route("/torrents", get(h_list_torrents).post(h_add_torrent))
        .route(
            "/torrents/:id",
            get(h_get_torrent),
        )
        .route(
            "/torrents/:id/status",
            get(h_get_status),
        )
        .route(
            "/torrents/:id/content",
            get(h_get_content),
        )
        .route(
            "/torrents/:id/file-priority",
            patch(h_patch_file_priority),
        )
        .route(
            "/torrents/:id/profile",
            patch(h_patch_profile),
        )
        .route(
            "/torrents/:id/start",
            post(h_start),
        )
        .route(
            "/torrents/:id/stop",
            post(h_stop),
        )
        .route(
            "/torrents/:id/remove",
            post(h_remove),
        )
        .route(
            "/torrents/:id/recheck",
            post(h_recheck),
        )
        .route(
            "/torrents/:id/announce",
            post(h_announce),
        )
        .route(
            "/torrents/:id/peers",
            get(h_peers),
        )
        .route(
            "/torrents/:id/trackers",
            get(h_trackers),
        )
        .route(
            "/torrents/:id/row-snapshot",
            get(h_get_row_snapshot),
        )
        .route("/admin/shutdown", post(h_admin_shutdown))
        .with_state(AppCtx { state, admin_token, shutdown: shutdown_notify.clone() })
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

async fn h_vpn_status() -> impl IntoResponse {
    Json(orc_core::vpn_status())
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
        return (StatusCode::BAD_REQUEST, Json(serde_json::json!({"error": sanitized}))).into_response();
    }
    
    let mut guard = ctx.state.lock().await;
    let out = patch_kill_switch(&mut guard, req);
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
        return (StatusCode::BAD_REQUEST, Json(serde_json::json!({"error": sanitized}))).into_response();
    }
    
    let mut guard = ctx.state.lock().await;
    let out = patch_policy(&mut guard, req.desired_patch);
    Json(out).into_response()
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
        return (StatusCode::BAD_REQUEST, Json(serde_json::json!({"error": sanitized}))).into_response();
    }
    
    let input = match prepare_add_input(&req) {
        Ok(i) => i,
        Err(e) => {
            let sanitized = sanitize_error(&e, "Failed to prepare torrent input");
            return (StatusCode::BAD_REQUEST, Json(serde_json::json!({"error": sanitized}))).into_response();
        }
    };
    let info_hash_hex = match &input {
        AddTorrentInput::Url(u) => extract_info_hash_from_magnet(u),
        AddTorrentInput::TorrentBytes(bytes) => extract_info_hash_from_torrent_bytes(bytes)
                .unwrap_or(None),
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
            return (StatusCode::OK, Json(serde_json::json!({
                "id": id
            }))).into_response();
        }
    }
    let (api, default_download_path) = {
        let guard = ctx.state.lock().await;
        (rqbit_api(&guard), guard.download_dir_path().clone())
    };
    let mut opts = librqbit::AddTorrentOptions::default();
    opts.output_folder = req.save_path.as_ref()
        .and_then(|s| {
            let t = s.trim();
            if t.is_empty() { None } else { Some(t.to_string()) }
        })
        .or_else(|| {
            info_hash_hex.as_ref().map(|h| {
                default_download_path.join(h.as_str()).to_string_lossy().to_string()
            })
        });
    // content is opened, verified (recheck), and only missing/corrupt pieces are downloaded; then seeding works.
    opts.overwrite = true;
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
                let mut retry_opts = librqbit::AddTorrentOptions::default();
                retry_opts.output_folder = req.save_path.as_ref()
                    .and_then(|s| {
                        let t = s.trim();
                        if t.is_empty() { None } else { Some(t.to_string()) }
                    })
                    .or_else(|| {
                        info_hash_hex.as_ref().map(|h| {
                            default_download_path.join(h.as_str()).to_string_lossy().to_string()
                        })
                    });
                retry_opts.overwrite = true;
                match &input {
                    AddTorrentInput::Url(u) => {
                        api.api_add_torrent(librqbit::AddTorrent::from_url(u.as_str()), Some(retry_opts))
                            .await
                    }
                    AddTorrentInput::TorrentBytes(bytes) => {
                        api.api_add_torrent(librqbit::AddTorrent::from_bytes(bytes.clone()), Some(retry_opts))
                            .await
                    }
                }
            } else {
                let sanitized = sanitize_error(&anyhow::Error::from(e), "Failed to add torrent");
                return (StatusCode::BAD_REQUEST, Json(serde_json::json!({"error": sanitized}))).into_response();
            }
        }
    };

    let rqbit_resp = match rqbit_resp {
        Ok(r) => r,
        Err(e) => {
            let sanitized = sanitize_error(&anyhow::Error::from(e), "Failed to add torrent (retry failed)");
            return (StatusCode::BAD_REQUEST, Json(serde_json::json!({"error": sanitized}))).into_response();
        }
    };

    let out = {
        let mut guard = ctx.state.lock().await;
        match integrate_added_torrent(&mut guard, &req, rqbit_resp) {
            Ok(r) => r,
            Err(e) => {
                let sanitized = sanitize_error(&e, "Failed to integrate torrent");
                return (StatusCode::INTERNAL_SERVER_ERROR, Json(serde_json::json!({"error": sanitized}))).into_response();
            }
        }
    };

    (StatusCode::OK, Json(out)).into_response()
}

async fn h_get_torrent(
    State(ctx): State<AppCtx>,
    Path(id): Path<String>,
) -> impl IntoResponse {
    if !validate_torrent_id(&id) {
        return (StatusCode::BAD_REQUEST, Json(serde_json::json!({
            "error": "Invalid torrent ID format"
        }))).into_response();
    }
    
    let guard = ctx.state.lock().await;
    match get_torrent(&guard, &id) {
        Some(t) => (StatusCode::OK, Json(t)).into_response(),
        None => StatusCode::NOT_FOUND.into_response(),
    }
}

async fn h_get_status(
    State(ctx): State<AppCtx>,
    Path(id): Path<String>,
) -> impl IntoResponse {
    if !validate_torrent_id(&id) {
        return (StatusCode::BAD_REQUEST, Json(serde_json::json!({
            "error": "Invalid torrent ID format"
        }))).into_response();
    }
    
    let guard = ctx.state.lock().await;
    match get_status(&guard, &id) {
        Some(s) => (StatusCode::OK, Json(s)).into_response(),
        None => StatusCode::NOT_FOUND.into_response(),
    }
}

async fn h_get_content(
    State(ctx): State<AppCtx>,
    Path(id): Path<String>,
) -> impl IntoResponse {
    if !validate_torrent_id(&id) {
        return (StatusCode::BAD_REQUEST, Json(serde_json::json!({
            "error": "Invalid torrent ID format"
        }))).into_response();
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
        return (StatusCode::BAD_REQUEST, Json(serde_json::json!({
            "error": "Invalid torrent ID format"
        }))).into_response();
    }
    
    // Production Security: Validate request payload
    if let Err(e) = req.validate() {
        let sanitized = sanitize_error(&anyhow::Error::from(e), "Invalid file priority request");
        return (StatusCode::BAD_REQUEST, Json(serde_json::json!({"error": sanitized}))).into_response();
    }
    let (api, rqbit_id, only_files) = {
        let mut guard = ctx.state.lock().await;
        if set_file_priority(&mut guard, &id, req).is_err() {
            return StatusCode::NOT_FOUND.into_response();
        }
        (rqbit_api(&guard), rqbit_id_for(&guard, &id), only_files_for(&guard, &id))
    };
    if let (Some(rqbit_id), Some(only_files)) = (rqbit_id, only_files) {
        if let Err(e) = api
            .api_torrent_action_update_only_files(librqbit::api::TorrentIdOrHash::Id(rqbit_id), &only_files)
            .await
        {
            let sanitized = sanitize_error(&anyhow::Error::from(e), "Failed to update file priority");
            return (StatusCode::BAD_REQUEST, Json(serde_json::json!({"error": sanitized}))).into_response();
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
        return (StatusCode::BAD_REQUEST, Json(serde_json::json!({
            "error": "Invalid torrent ID format"
        }))).into_response();
    }
    
    // Production Security: Validate request payload
    if let Err(e) = req.validate() {
        let sanitized = sanitize_error(&anyhow::Error::from(e), "Invalid profile request");
        return (StatusCode::BAD_REQUEST, Json(serde_json::json!({"error": sanitized}))).into_response();
    }
    
    let mut guard = ctx.state.lock().await;
    let profile = orc_core::TorrentProfile { mode: req.mode, hops: req.hops };
    match set_profile(&mut guard, &id, profile) {
        Ok(t) => (StatusCode::OK, Json(t)).into_response(),
        Err(_) => StatusCode::NOT_FOUND.into_response(),
    }
}

async fn h_start(State(ctx): State<AppCtx>, Path(id): Path<String>) -> impl IntoResponse {
    if !validate_torrent_id(&id) {
        return (StatusCode::BAD_REQUEST, Json(serde_json::json!({
            "error": "Invalid torrent ID format"
        }))).into_response();
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
        return (StatusCode::BAD_REQUEST, Json(serde_json::json!({"error": sanitized}))).into_response();
    }

    let mut guard = ctx.state.lock().await;
    let _ = set_running(&mut guard, &id, true);
    StatusCode::OK.into_response()
}

async fn h_stop(State(ctx): State<AppCtx>, Path(id): Path<String>) -> impl IntoResponse {
    if !validate_torrent_id(&id) {
        return (StatusCode::BAD_REQUEST, Json(serde_json::json!({
            "error": "Invalid torrent ID format"
        }))).into_response();
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
        return (StatusCode::BAD_REQUEST, Json(serde_json::json!({"error": sanitized}))).into_response();
    }

    let mut guard = ctx.state.lock().await;
    let _ = set_running(&mut guard, &id, false);
    StatusCode::OK.into_response()
}

async fn h_remove(State(ctx): State<AppCtx>, Path(id): Path<String>) -> impl IntoResponse {
    if !validate_torrent_id(&id) {
        return (StatusCode::BAD_REQUEST, Json(serde_json::json!({
            "error": "Invalid torrent ID format"
        }))).into_response();
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
        return (StatusCode::BAD_REQUEST, Json(serde_json::json!({"error": sanitized}))).into_response();
    }

    let mut guard = ctx.state.lock().await;
    let _ = remove_torrent(&mut guard, &id);
    StatusCode::OK.into_response()
}

async fn h_recheck(State(ctx): State<AppCtx>, Path(id): Path<String>) -> impl IntoResponse {
    if !validate_torrent_id(&id) {
        return (StatusCode::BAD_REQUEST, Json(serde_json::json!({
            "error": "Invalid torrent ID format"
        }))).into_response();
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
        return (StatusCode::BAD_REQUEST, Json(serde_json::json!({
            "error": "Invalid torrent ID format"
        }))).into_response();
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
        return (StatusCode::BAD_REQUEST, Json(serde_json::json!({
            "error": "Invalid torrent ID format"
        }))).into_response();
    }
    
    let mut guard = ctx.state.lock().await;
    match peers_for(&mut guard, &id) {
        Ok(p) => (StatusCode::OK, Json(p)).into_response(),
        Err(_) => StatusCode::NOT_FOUND.into_response(),
    }
}

async fn h_trackers(State(ctx): State<AppCtx>, Path(id): Path<String>) -> impl IntoResponse {
    if !validate_torrent_id(&id) {
        return (StatusCode::BAD_REQUEST, Json(serde_json::json!({
            "error": "Invalid torrent ID format"
        }))).into_response();
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
        return (StatusCode::BAD_REQUEST, Json(serde_json::json!({
            "error": "Invalid torrent ID format"
        }))).into_response();
    }
    
    let guard = ctx.state.lock().await;
    match get_row_snapshot(&guard, &id) {
        Some(s) => (StatusCode::OK, Json(s)).into_response(),
        None => StatusCode::NOT_FOUND.into_response(),
    }
}

async fn h_admin_shutdown(
    State(ctx): State<AppCtx>,
    headers: HeaderMap,
) -> impl IntoResponse {
    let provided = headers
        .get("x-admin-token")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");
    if !ctx.admin_token.is_empty() {
        let provided_bytes = provided.as_bytes();
        let expected_bytes = ctx.admin_token.as_bytes();
        if provided_bytes.len() != expected_bytes.len() 
            || provided_bytes.ct_eq(expected_bytes).unwrap_u8() == 0 {
            warn!("Admin shutdown attempt with invalid token");
            return (StatusCode::UNAUTHORIZED, Json(serde_json::json!({"error": "unauthorized"}))).into_response();
        }
    }

    info!("admin shutdown accepted");
    ctx.shutdown.notify_waiters();
    (StatusCode::OK, Json(serde_json::json!({"ok": true}))).into_response()
}
