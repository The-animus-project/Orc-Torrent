//! Watch folder auto-import for .torrent files.

use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
    time::{Duration, Instant},
};

use anyhow::{Context, Result};
use base64::{engine::general_purpose, Engine as _};
#[cfg(not(target_os = "android"))]
use notify::{EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use orc_core::{
    build_add_torrent_options, extract_info_hash_from_torrent_bytes, find_torrent_by_info_hash,
    integrate_added_torrent, prepare_add_input, rqbit_api, rqbit_id_for, set_running,
    AddTorrentRequest, SharedState,
};
use serde::{Deserialize, Serialize};
use tokio::sync::{mpsc, RwLock};
use tracing::{info, warn};
use uuid::Uuid;

use crate::config::{validate_folder_path, WatchFolderEntry, WatchFolderSettings};

const MAX_EVENTS: usize = 100;
const DEBOUNCE_SECS: u64 = 2;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum WatchImportStatus {
    Success,
    Duplicate,
    Error,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WatchImportEvent {
    pub at_ms: u64,
    pub folder_path: String,
    pub torrent_path: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub torrent_id: Option<String>,
    pub status: WatchImportStatus,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WatchFoldersResponse {
    pub settings: WatchFolderSettings,
    pub events: Vec<WatchImportEvent>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct PatchWatchFoldersRequest {
    pub enabled: Option<bool>,
    pub folders: Option<Vec<WatchFolderEntry>>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct TestWatchFolderRequest {
    pub folder_path: String,
    #[serde(default)]
    pub archive_folder: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct TestWatchFolderResponse {
    pub ok: bool,
    pub message: String,
}

struct WatchManagerInner {
    settings: WatchFolderSettings,
    events: Vec<WatchImportEvent>,
    cancel_flag: Option<Arc<AtomicBool>>,
}

pub struct WatchFolderManager {
    inner: Arc<RwLock<WatchManagerInner>>,
}

impl WatchFolderManager {
    pub fn new(settings: WatchFolderSettings) -> Self {
        Self {
            inner: Arc::new(RwLock::new(WatchManagerInner {
                settings,
                events: Vec::new(),
                cancel_flag: None,
            })),
        }
    }

    pub async fn get_response(&self) -> WatchFoldersResponse {
        let inner = self.inner.read().await;
        WatchFoldersResponse {
            settings: inner.settings.clone(),
            events: inner.events.clone(),
        }
    }

    pub async fn get_events(&self) -> Vec<WatchImportEvent> {
        self.inner.read().await.events.clone()
    }

    pub async fn update_settings(
        &self,
        patch: PatchWatchFoldersRequest,
        state: SharedState,
        download_dir: PathBuf,
    ) -> Result<WatchFoldersResponse> {
        let mut inner = self.inner.write().await;
        if let Some(enabled) = patch.enabled {
            inner.settings.enabled = enabled;
        }
        if let Some(folders) = patch.folders {
            inner.settings.folders = folders;
        }
        inner.settings.validate()?;
        drop(inner);
        self.restart_watchers(state, download_dir).await?;
        Ok(self.get_response().await)
    }

    async fn push_event(&self, event: WatchImportEvent) {
        let mut inner = self.inner.write().await;
        inner.events.push(event);
        if inner.events.len() > MAX_EVENTS {
            let drain = inner.events.len() - MAX_EVENTS;
            inner.events.drain(0..drain);
        }
    }

    #[cfg(not(target_os = "android"))]
    pub async fn restart_watchers(&self, state: SharedState, download_dir: PathBuf) -> Result<()> {
        {
            let mut inner = self.inner.write().await;
            if let Some(flag) = inner.cancel_flag.take() {
                flag.store(true, Ordering::SeqCst);
            }
        }

        let settings = self.inner.read().await.settings.clone();
        if !settings.enabled {
            return Ok(());
        }

        let cancel_flag = Arc::new(AtomicBool::new(false));
        {
            let mut inner = self.inner.write().await;
            inner.cancel_flag = Some(cancel_flag.clone());
        }

        let manager = self.clone();
        for entry in settings.folders.into_iter().filter(|e| e.enabled) {
            let state = state.clone();
            let download_dir = download_dir.clone();
            let manager = manager.clone();
            let cancel = cancel_flag.clone();
            tokio::spawn(async move {
                if let Err(e) =
                    run_folder_watcher(entry, state, download_dir, manager, cancel).await
                {
                    warn!("watch folder error: {e:#}");
                }
            });
        }

        Ok(())
    }

    #[cfg(target_os = "android")]
    pub async fn restart_watchers(
        &self,
        _state: SharedState,
        _download_dir: PathBuf,
    ) -> Result<()> {
        // Android uses SAF documents, which cannot be watched with desktop filesystem APIs.
        Ok(())
    }
}

impl Clone for WatchFolderManager {
    fn clone(&self) -> Self {
        Self {
            inner: self.inner.clone(),
        }
    }
}

#[cfg(not(target_os = "android"))]
async fn run_folder_watcher(
    entry: WatchFolderEntry,
    state: SharedState,
    _download_dir: PathBuf,
    manager: WatchFolderManager,
    cancel: Arc<AtomicBool>,
) -> Result<()> {
    let folder = PathBuf::from(&entry.folder_path);
    if !folder.is_dir() {
        anyhow::bail!("watch folder does not exist: {}", entry.folder_path);
    }

    let (event_tx, mut event_rx) = mpsc::unbounded_channel::<PathBuf>();
    let folder_watch = folder.clone();
    let watcher_handle = std::thread::spawn(move || -> Result<()> {
        let tx = event_tx;
        let mut watcher = RecommendedWatcher::new(
            move |res: notify::Result<notify::Event>| {
                if let Ok(event) = res {
                    if matches!(event.kind, EventKind::Create(_) | EventKind::Modify(_)) {
                        for path in event.paths {
                            if path.extension().and_then(|e| e.to_str()) == Some("torrent") {
                                let _ = tx.send(path);
                            }
                        }
                    }
                }
            },
            notify::Config::default(),
        )
        .context("failed to create file watcher")?;
        watcher
            .watch(&folder_watch, RecursiveMode::Recursive)
            .context("failed to watch folder")?;
        loop {
            std::thread::sleep(Duration::from_secs(3600));
        }
    });

    let entry_clone = entry.clone();
    let manager_clone = manager.clone();
    let state_clone = state.clone();
    let cancel_debounce = cancel.clone();
    let debounce_task = tokio::spawn(async move {
        let mut pending: HashMap<PathBuf, Instant> = HashMap::new();
        loop {
            if cancel_debounce.load(Ordering::SeqCst) {
                break;
            }
            tokio::select! {
                Some(path) = event_rx.recv() => {
                    pending.insert(path, Instant::now() + Duration::from_secs(DEBOUNCE_SECS));
                }
                _ = tokio::time::sleep(Duration::from_millis(200)) => {}
            }
            let now = Instant::now();
            let ready: Vec<PathBuf> = pending
                .iter()
                .filter(|(_, t)| **t <= now)
                .map(|(p, _)| p.clone())
                .collect();
            for path in ready {
                pending.remove(&path);
                if let Err(e) =
                    import_torrent_file(&entry_clone, &path, &state_clone, &manager_clone).await
                {
                    warn!("watch import failed for {:?}: {e:#}", path);
                }
            }
        }
    });

    while !cancel.load(Ordering::SeqCst) {
        tokio::time::sleep(Duration::from_millis(500)).await;
    }
    debounce_task.abort();
    let _ = watcher_handle.join();
    Ok(())
}

pub fn is_duplicate_info_hash(state: &orc_core::OrcState, hash: &str) -> bool {
    find_torrent_by_info_hash(state, hash).is_some()
}

async fn import_torrent_file(
    entry: &WatchFolderEntry,
    torrent_path: &Path,
    state: &SharedState,
    manager: &WatchFolderManager,
) -> Result<()> {
    let at_ms = orc_core::now_ms();
    let folder_path = entry.folder_path.clone();
    let torrent_path_str = torrent_path.to_string_lossy().to_string();

    let bytes = match tokio::fs::read(torrent_path).await {
        Ok(b) => b,
        Err(e) => {
            manager
                .push_event(WatchImportEvent {
                    at_ms,
                    folder_path,
                    torrent_path: torrent_path_str,
                    torrent_id: None,
                    status: WatchImportStatus::Error,
                    message: format!("Failed to read file: {e}"),
                })
                .await;
            return Err(e.into());
        }
    };

    if let Ok(Some(hash)) = extract_info_hash_from_torrent_bytes(&bytes) {
        let guard = state.lock().await;
        if is_duplicate_info_hash(&guard, &hash) {
            manager
                .push_event(WatchImportEvent {
                    at_ms,
                    folder_path,
                    torrent_path: torrent_path_str.clone(),
                    torrent_id: None,
                    status: WatchImportStatus::Duplicate,
                    message: "Torrent already in library".to_string(),
                })
                .await;
            post_import_file_action(entry, torrent_path).await;
            return Ok(());
        }
    }

    let b64 = general_purpose::STANDARD.encode(&bytes);
    let req = AddTorrentRequest {
        magnet: None,
        torrent_b64: Some(b64),
        name_hint: torrent_path
            .file_stem()
            .and_then(|s| s.to_str())
            .map(|s| s.to_string()),
        save_path: entry.default_save_path.clone(),
        start_paused: !entry.auto_start,
    };

    let input = match prepare_add_input(&req) {
        Ok(i) => i,
        Err(e) => {
            manager
                .push_event(WatchImportEvent {
                    at_ms,
                    folder_path,
                    torrent_path: torrent_path_str,
                    torrent_id: None,
                    status: WatchImportStatus::Error,
                    message: e.to_string(),
                })
                .await;
            return Err(e);
        }
    };

    let (api, _default_download_path) = {
        let guard = state.lock().await;
        (rqbit_api(&guard), guard.download_dir_path().clone())
    };

    let output_folder = if let Some(ref save) = entry.default_save_path {
        let t = save.trim();
        if t.is_empty() {
            None
        } else {
            Some(t.to_string())
        }
    } else {
        None
    };

    let mut opts = build_add_torrent_options(output_folder);
    opts.paused = req.start_paused;

    let rqbit_resp = match &input {
        orc_core::AddTorrentInput::Url(u) => {
            api.api_add_torrent(librqbit::AddTorrent::from_url(u.as_str()), Some(opts))
                .await
        }
        orc_core::AddTorrentInput::TorrentBytes(bytes) => {
            api.api_add_torrent(librqbit::AddTorrent::from_bytes(bytes.clone()), Some(opts))
                .await
        }
    };

    let rqbit_resp = match rqbit_resp {
        Ok(r) => r,
        Err(e) => {
            manager
                .push_event(WatchImportEvent {
                    at_ms,
                    folder_path,
                    torrent_path: torrent_path_str,
                    torrent_id: None,
                    status: WatchImportStatus::Error,
                    message: e.to_string(),
                })
                .await;
            return Err(e.into());
        }
    };

    let add_resp = {
        let mut guard = state.lock().await;
        integrate_added_torrent(&mut guard, &req, rqbit_resp)
    };

    match add_resp {
        Ok(resp) => {
            let torrent_id = resp.id.clone();
            if !entry.auto_start {
                let mut guard = state.lock().await;
                let _ = set_running(&mut guard, &torrent_id, false);
                if let Some(rqbit_id) = rqbit_id_for(&guard, &torrent_id) {
                    let api = rqbit_api(&guard);
                    drop(guard);
                    let _ = api
                        .api_torrent_action_pause(librqbit::api::TorrentIdOrHash::Id(rqbit_id))
                        .await;
                }
            }
            info!(
                "Watch folder imported torrent {} from {:?}",
                torrent_id, torrent_path
            );
            manager
                .push_event(WatchImportEvent {
                    at_ms,
                    folder_path,
                    torrent_path: torrent_path_str.clone(),
                    torrent_id: Some(torrent_id),
                    status: WatchImportStatus::Success,
                    message: "Imported successfully".to_string(),
                })
                .await;
            post_import_file_action(entry, torrent_path).await;
            Ok(())
        }
        Err(e) => {
            manager
                .push_event(WatchImportEvent {
                    at_ms,
                    folder_path,
                    torrent_path: torrent_path_str,
                    torrent_id: None,
                    status: WatchImportStatus::Error,
                    message: e.to_string(),
                })
                .await;
            Err(e)
        }
    }
}

async fn post_import_file_action(entry: &WatchFolderEntry, torrent_path: &Path) {
    if entry.delete_after_import {
        if let Err(e) = tokio::fs::remove_file(torrent_path).await {
            warn!("failed to delete imported torrent {:?}: {e}", torrent_path);
        }
    } else if let Some(ref archive) = entry.archive_folder {
        if !archive.trim().is_empty() {
            let dest_dir = PathBuf::from(archive);
            if let Err(e) = tokio::fs::create_dir_all(&dest_dir).await {
                warn!("failed to create archive dir: {e}");
                return;
            }
            if let Some(name) = torrent_path.file_name() {
                let dest = dest_dir.join(name);
                if let Err(e) = tokio::fs::rename(torrent_path, &dest).await {
                    warn!("failed to archive torrent file: {e}");
                }
            }
        }
    }
}

pub async fn test_watch_folder_access(req: &TestWatchFolderRequest) -> TestWatchFolderResponse {
    match validate_folder_path(&req.folder_path) {
        Err(e) => {
            return TestWatchFolderResponse {
                ok: false,
                message: e.to_string(),
            }
        }
        Ok(()) => {}
    }
    let path = PathBuf::from(&req.folder_path);
    match tokio::fs::read_dir(&path).await {
        Err(e) => {
            return TestWatchFolderResponse {
                ok: false,
                message: format!("Cannot read folder: {e}"),
            }
        }
        Ok(_) => {}
    }
    if let Some(ref archive) = req.archive_folder {
        if !archive.trim().is_empty() {
            if let Err(e) = validate_folder_path(archive) {
                return TestWatchFolderResponse {
                    ok: false,
                    message: e.to_string(),
                };
            }
            let archive_path = PathBuf::from(archive);
            if let Err(e) = tokio::fs::create_dir_all(&archive_path).await {
                return TestWatchFolderResponse {
                    ok: false,
                    message: format!("Cannot create archive folder: {e}"),
                };
            }
        }
    }
    TestWatchFolderResponse {
        ok: true,
        message: "Folder is accessible".to_string(),
    }
}

pub fn new_watch_folder_entry(folder_path: String) -> WatchFolderEntry {
    WatchFolderEntry {
        id: Uuid::new_v4().to_string(),
        enabled: true,
        folder_path,
        default_save_path: None,
        auto_start: true,
        delete_after_import: false,
        archive_folder: None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use orc_core::new_state;

    #[test]
    fn new_entry_has_uuid() {
        let e = new_watch_folder_entry("/tmp/watch".into());
        assert!(!e.id.is_empty());
        assert!(e.auto_start);
    }

    #[tokio::test]
    async fn is_duplicate_false_on_empty_library() {
        let dir = tempfile::tempdir().unwrap();
        let reservation = match std::net::TcpListener::bind(("127.0.0.1", 0)) {
            Ok(reservation) => reservation,
            Err(error) if error.kind() == std::io::ErrorKind::PermissionDenied => return,
            Err(error) => panic!("failed to reserve test port: {error}"),
        };
        let port = reservation.local_addr().unwrap().port();
        drop(reservation);
        let state = new_state(dir.path().to_string_lossy().to_string(), port, None)
            .await
            .unwrap();
        let guard = state.lock().await;
        assert!(!is_duplicate_info_hash(
            &guard,
            "0123456789abcdef0123456789abcdef01234567"
        ));
    }
}
