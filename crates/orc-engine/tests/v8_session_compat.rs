use std::time::{SystemTime, UNIX_EPOCH};

use orc_engine::{
    api::TorrentIdOrHash, ConnectionOptions, Engine, Session, SessionOptions,
    SessionPersistenceConfig,
};

const FIXTURE_HASH: &str = "cab507494d02ebb1178b38f2e9d7be299c86b862";
const TORRENT_SIDECAR: &[u8] = include_bytes!(
    "../../librqbit-v9-patched/resources/ubuntu-21.04-live-server-amd64.iso.torrent"
);

fn fixture_directory(label: &str) -> (std::path::PathBuf, &'static [u8]) {
    let unique = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("clock")
        .as_nanos();
    let persistence = std::env::temp_dir()
        .join(format!("orc-v8-session-{label}-{unique}"))
        .join("state")
        .join("rqbit");
    std::fs::create_dir_all(&persistence).expect("persistence folder");
    let fixture = include_bytes!("fixtures/v8.1.1-session.json");
    std::fs::write(persistence.join("session.json"), fixture).expect("copy fixture");
    std::fs::write(
        persistence.join(format!("{FIXTURE_HASH}.torrent")),
        TORRENT_SIDECAR,
    )
    .expect("copy torrent sidecar");
    (persistence, fixture)
}

#[test]
fn validates_v8_session_without_rewriting_it() {
    let (persistence, fixture) = fixture_directory("validate");
    let session_file = persistence.join("session.json");
    let bitv_file = persistence.join(format!("{FIXTURE_HASH}.bitv"));
    let torrent_file = persistence.join(format!("{FIXTURE_HASH}.torrent"));
    std::fs::write(&bitv_file, [0b1010_0000]).expect("fast resume fixture");

    orc_engine::validate_persistence_directory(&persistence)
        .expect("v8.1.1 session shape should validate");
    assert_eq!(std::fs::read(&session_file).expect("read fixture"), fixture);
    assert_eq!(
        std::fs::read(bitv_file).expect("bitv fixture"),
        [0b1010_0000]
    );
    assert_eq!(
        std::fs::read(torrent_file).expect("torrent fixture"),
        TORRENT_SIDECAR
    );
}

#[tokio::test]
async fn restores_v8_session_forced_paused_in_place() {
    let (persistence, _) = fixture_directory("restore");
    let downloads = persistence
        .parent()
        .expect("state folder")
        .join("downloads");
    std::fs::create_dir_all(&downloads).expect("downloads");
    let session = Session::new_with_opts(
        downloads,
        SessionOptions {
            disable_dht: true,
            disable_trackers: true,
            disable_local_service_discovery: true,
            disable_pex: true,
            force_paused_on_restore: true,
            connect: Some(ConnectionOptions::default()),
            persistence: Some(SessionPersistenceConfig::Json {
                folder: Some(persistence.clone()),
            }),
            fastresume: true,
            ..Default::default()
        },
    )
    .await
    .expect("v8.1.1 session should restore");
    let engine = Engine::new(session.clone(), true);
    let restored = engine.api_torrent_list().torrents;
    assert_eq!(restored.len(), 1);
    assert_eq!(restored[0].id, Some(7));
    assert_eq!(restored[0].info_hash, FIXTURE_HASH);
    let mut restored_state = String::new();
    for _ in 0..50 {
        restored_state = engine
            .torrent_stats(TorrentIdOrHash::Id(7))
            .expect("restored stats")
            .state;
        if restored_state == "paused" {
            break;
        }
        assert_ne!(restored_state, "live", "forced-paused restore went live");
        tokio::time::sleep(std::time::Duration::from_millis(20)).await;
    }
    assert_eq!(restored_state, "paused");
    let persisted: serde_json::Value = serde_json::from_slice(
        &std::fs::read(persistence.join("session.json")).expect("read restored session"),
    )
    .expect("valid restored session JSON");
    assert_eq!(persisted["torrents"]["7"]["info_hash"], FIXTURE_HASH);
    assert_eq!(persisted["torrents"]["7"]["is_paused"], true);
    assert_eq!(
        persisted["torrents"]["7"]["output_folder"],
        "/tmp/orc-v8-session-fixture"
    );
    session.cancellation_token().cancel();
}
