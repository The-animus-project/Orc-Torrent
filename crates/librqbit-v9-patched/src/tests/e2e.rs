use std::{
    net::{IpAddr, Ipv4Addr, Ipv6Addr, SocketAddr},
    time::Duration,
};

use anyhow::{Context, bail};
use librqbit_core::magnet::Magnet;
use orc_mse::PeerTrafficMode;
use rand::Rng;
use tokio::{
    spawn,
    time::{interval, timeout},
};
use tracing::{Instrument, error, error_span, info};

use crate::{
    AddTorrentOptions, AddTorrentResponse, ConnectionOptions, ListenerMode, Session,
    SessionOptions, SessionPersistenceConfig, create_torrent,
    listen::ListenerOptions,
    spawn_utils::BlockingSpawner,
    tests::test_util::{
        DropChecks, TestPeerMetadata, create_default_random_dir_with_torrents, setup_test_logging,
        wait_until_i_am_the_last_task,
    },
};

#[tokio::test(flavor = "multi_thread")]
async fn test_e2e_download_tcp() {
    _test_e2e_download_timeout_and_cleanups(
        ListenerMode::TcpOnly,
        Ipv4Addr::LOCALHOST.into(),
        15100,
    )
    .await
}

#[tokio::test(flavor = "multi_thread")]
async fn test_e2e_download_utp() {
    _test_e2e_download_timeout_and_cleanups(
        ListenerMode::UtpOnly,
        Ipv4Addr::LOCALHOST.into(),
        15200,
    )
    .await
}

#[tokio::test(flavor = "multi_thread")]
async fn test_e2e_download_tcp_ipv6() {
    _test_e2e_download_timeout_and_cleanups(
        ListenerMode::TcpOnly,
        Ipv6Addr::LOCALHOST.into(),
        15300,
    )
    .await
}

#[tokio::test(flavor = "multi_thread")]
async fn test_e2e_download_utp_ipv6() {
    _test_e2e_download_timeout_and_cleanups(
        ListenerMode::UtpOnly,
        Ipv6Addr::LOCALHOST.into(),
        15400,
    )
    .await
}

#[tokio::test(flavor = "multi_thread")]
async fn test_e2e_download_mse_require_tcp() {
    _test_e2e_download_timeout_and_cleanups_with_options(
        ListenerMode::TcpOnly,
        Ipv4Addr::LOCALHOST.into(),
        15500,
        PeerTrafficMode::Require,
        PeerTrafficMode::Require,
        E2eScale::mse(),
    )
    .await
}

#[tokio::test(flavor = "multi_thread")]
async fn test_e2e_download_mse_prefer_tcp_ipv6() {
    _test_e2e_download_timeout_and_cleanups_with_options(
        ListenerMode::TcpOnly,
        Ipv6Addr::LOCALHOST.into(),
        15600,
        PeerTrafficMode::Prefer,
        PeerTrafficMode::Prefer,
        E2eScale::mse(),
    )
    .await
}

#[tokio::test(flavor = "multi_thread")]
async fn test_e2e_download_mse_prefer_plaintext_fallback_tcp() {
    _test_e2e_download_timeout_and_cleanups_with_options(
        ListenerMode::TcpOnly,
        Ipv4Addr::LOCALHOST.into(),
        15700,
        PeerTrafficMode::Off,
        PeerTrafficMode::Prefer,
        E2eScale::mse(),
    )
    .await
}

#[tokio::test(flavor = "multi_thread")]
async fn test_mse_require_rejects_plaintext_without_fallback() {
    setup_test_logging();
    let source = create_default_random_dir_with_torrents(1, 64 * 1024, Some("rqbit_mse_reject"));
    let torrent = create_torrent(
        source.path(),
        crate::CreateTorrentOptions {
            piece_length: Some(16 * 1024),
            ..Default::default()
        },
        &BlockingSpawner::new(1),
    )
    .await
    .unwrap();
    let server = Session::new_with_opts(
        std::env::temp_dir().join("rqbit_mse_reject_server"),
        SessionOptions {
            disable_dht: true,
            disable_local_service_discovery: true,
            listen: Some(ListenerOptions {
                mode: ListenerMode::TcpOnly,
                listen_addr: SocketAddr::new(Ipv4Addr::LOCALHOST.into(), 15800),
                ..Default::default()
            }),
            ..Default::default()
        },
    )
    .await
    .unwrap();
    let server_torrent = server
        .add_torrent(
            crate::AddTorrent::TorrentFileBytes(torrent.as_bytes().unwrap()),
            Some(AddTorrentOptions {
                output_folder: Some(source.path().to_string_lossy().into_owned()),
                overwrite: true,
                ..Default::default()
            }),
        )
        .await
        .unwrap()
        .into_handle()
        .unwrap();
    timeout(Duration::from_secs(10), async {
        loop {
            if server_torrent
                .with_state(|state| matches!(state, crate::ManagedTorrentState::Live(_)))
            {
                break;
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .unwrap();

    let client = Session::new_with_opts(
        tempfile::TempDir::new().unwrap().keep(),
        SessionOptions {
            disable_dht: true,
            disable_local_service_discovery: true,
            listen: None,
            peer_traffic_mode: PeerTrafficMode::Require,
            ..Default::default()
        },
    )
    .await
    .unwrap();
    let magnet = Magnet::from_id20(torrent.info_hash(), Vec::new(), None).to_string();
    let result = client
        .add_torrent(
            crate::AddTorrent::Url(magnet.into()),
            Some(AddTorrentOptions {
                initial_peers: Some(vec![SocketAddr::new(Ipv4Addr::LOCALHOST.into(), 15800)]),
                ..Default::default()
            }),
        )
        .await;
    assert!(result.is_err());
    let stats = client.mse_stats();
    assert_eq!(stats.attempts, 1);
    assert_eq!(stats.fallbacks, 0);
    assert_eq!(stats.successes, 0);
}

#[derive(Clone, Copy)]
struct E2eScale {
    file_length: usize,
    num_files: usize,
    num_servers: u8,
}

impl E2eScale {
    const fn standard() -> Self {
        Self {
            file_length: 8 * 1000 * 1000,
            num_files: 8,
            num_servers: 32,
        }
    }

    const fn mse() -> Self {
        Self {
            file_length: 256 * 1024,
            num_files: 1,
            num_servers: 1,
        }
    }
}

async fn _test_e2e_download_timeout_and_cleanups(
    mode: ListenerMode,
    loopback: IpAddr,
    base_port: u16,
) {
    _test_e2e_download_timeout_and_cleanups_with_options(
        mode,
        loopback,
        base_port,
        PeerTrafficMode::Off,
        PeerTrafficMode::Off,
        E2eScale::standard(),
    )
    .await
}

async fn _test_e2e_download_timeout_and_cleanups_with_options(
    mode: ListenerMode,
    loopback: IpAddr,
    base_port: u16,
    server_peer_traffic_mode: PeerTrafficMode,
    peer_traffic_mode: PeerTrafficMode,
    scale: E2eScale,
) {
    let timeout = std::env::var("E2E_TIMEOUT")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(180);

    let drop_checks = DropChecks::default();
    tokio::time::timeout(
        Duration::from_secs(timeout),
        _test_e2e_download(
            mode,
            loopback,
            base_port,
            &drop_checks,
            server_peer_traffic_mode,
            peer_traffic_mode,
            scale,
        ),
    )
    .await
    .context("test_e2e_download timed out")
    .unwrap();

    // Wait to ensure everything is dropped.
    wait_until_i_am_the_last_task().await.unwrap();

    drop_checks.check().unwrap();
}

async fn _test_e2e_download(
    mode: ListenerMode,
    loopback: IpAddr,
    base_port: u16,
    drop_checks: &DropChecks,
    server_peer_traffic_mode: PeerTrafficMode,
    peer_traffic_mode: PeerTrafficMode,
    scale: E2eScale,
) {
    setup_test_logging();
    match crate::try_increase_nofile_limit() {
        Ok(limit) => info!(limit, "increased ulimit"),
        Err(e) => error!(error=?e, "error increasing ulimit"),
    };

    // 1. Create a torrent
    // Ideally (for a more complicated test) with N files, and at least N pieces that span 2 files.

    let piece_length: u32 = 16384 * 2;
    let file_length: usize = std::env::var("E2E_FILE_LENGTH")
        .ok()
        .and_then(|value| value.parse().ok())
        .unwrap_or(scale.file_length); // uneven files will make pieces cross file boundaries

    // Not setting this too high as 64 causes too many open files on osx on github runners.
    let num_files: usize = std::env::var("E2E_NUM_FILES")
        .ok()
        .and_then(|value| value.parse().ok())
        .unwrap_or(scale.num_files);

    let tempdir =
        create_default_random_dir_with_torrents(num_files, file_length, Some("rqbit_e2e"));
    let torrent_file = create_torrent(
        dbg!(tempdir.path()),
        crate::CreateTorrentOptions {
            piece_length: Some(piece_length),
            ..Default::default()
        },
        &BlockingSpawner::new(1),
    )
    .await
    .unwrap();

    let num_servers = std::env::var("E2E_NUM_SERVERS")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(scale.num_servers);

    let torrent_file_bytes = torrent_file.as_bytes().unwrap();
    let mut futs = Vec::new();

    // 2. Start N servers that are serving that torrent, and return their IP:port combos.
    //    Disable DHT on each.
    for i in 0..num_servers {
        let torrent_file_bytes = torrent_file_bytes.clone();
        let tempdir = tempdir.path().to_owned();
        let drop_checks = drop_checks.clone();
        let fut = spawn(
            async move {
                let peer_id = TestPeerMetadata {
                    server_id: i,
                    max_random_sleep_ms: rand::rng().random_range(0u8..16),
                }
                .as_peer_id();
                let listen_port = base_port + i as u16;
                let session = crate::Session::new_with_opts(
                    std::env::temp_dir().join("does_not_exist"),
                    SessionOptions {
                        disable_dht: true,
                        peer_id: Some(peer_id),
                        listen: Some(ListenerOptions {
                            mode,
                            listen_addr: SocketAddr::new(loopback, listen_port),
                            ..Default::default()
                        }),
                        root_span: Some(error_span!(parent: None, "server", id = i)),
                        disable_local_service_discovery: true,
                        peer_traffic_mode: server_peer_traffic_mode,
                        ..Default::default()
                    },
                )
                .await
                .context("error starting session")?;

                drop_checks.add(&session, format!("server session {i}"));

                info!("started session");

                let handle = session
                    .add_torrent(
                        crate::AddTorrent::TorrentFileBytes(torrent_file_bytes),
                        Some(AddTorrentOptions {
                            overwrite: true,
                            output_folder: Some(tempdir.to_str().unwrap().to_owned()),
                            ..Default::default()
                        }),
                    )
                    .await
                    .context("error adding torrent")?;
                let h = handle.into_handle().context("into_handle()")?;

                drop_checks.add(&h.shared, format!("server {i} torrent shared handle"));

                let mut interval = interval(Duration::from_millis(100));

                info!("added torrent");
                loop {
                    interval.tick().await;
                    let is_live = h
                        .with_state(|s| match s {
                            crate::ManagedTorrentState::Initializing(_) => Ok(false),
                            crate::ManagedTorrentState::Live(l) => {
                                if !l.is_finished() {
                                    bail!("torrent went live, but expected it to be finished");
                                }
                                Ok(true)
                            }
                            crate::ManagedTorrentState::Error(e) => bail!("error: {e:#}"),
                            _ => bail!("broken state"),
                        })
                        .context("error checking for torrent liveness")?;
                    if is_live {
                        break;
                    }
                }
                info!("torrent is live");
                let addr = session
                    .listen_addr()
                    .context("expected listen_addr to be set")?;
                Ok::<_, anyhow::Error>((session, addr))
            }
            .instrument(error_span!("server", id = i)),
        );
        futs.push(timeout(Duration::from_secs(30), fut));
    }

    let mut peers = Vec::new();

    // This is around just not to drop.
    let mut _servers = Vec::new();
    for (id, peer) in futures::future::join_all(futs)
        .await
        .into_iter()
        .enumerate()
    {
        let (server, peer) = peer
            .with_context(|| format!("join error, server={id}"))
            .unwrap()
            .with_context(|| format!("timeout, server={id}"))
            .unwrap()
            .with_context(|| format!("server couldn't start, server={id}"))
            .unwrap();
        peers.push(peer);
        _servers.push(server);
    }

    info!("started all servers, starting client");

    let client_iters = std::env::var("E2E_CLIENT_ITERS")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(1usize);

    let magnet = Magnet::from_id20(torrent_file.info_hash(), Vec::new(), None).to_string();

    // 3. Start a client with the initial peers, and download the file.
    for _ in 0..client_iters {
        let root = tempfile::TempDir::with_prefix("rqbit_e2e_client").unwrap();
        let outdir = root.path().join("out");
        let session_persistence = root.path().join("session");
        let session = Session::new_with_opts(
            outdir.to_owned(),
            SessionOptions {
                disable_dht: true,
                disable_dht_persistence: true,
                dht_config: None,
                persistence: Some(SessionPersistenceConfig::Json {
                    folder: Some(session_persistence),
                }),
                listen: if mode.utp_enabled() {
                    Some(ListenerOptions {
                        mode: ListenerMode::UtpOnly,
                        listen_addr: SocketAddr::new(loopback, base_port - 1),
                        ..Default::default()
                    })
                } else {
                    None
                },
                connect: Some(ConnectionOptions {
                    enable_tcp: mode.tcp_enabled(),
                    ..Default::default()
                }),
                fastresume: true,
                ipv4_only: loopback.is_ipv4(),
                disable_local_service_discovery: true,
                peer_traffic_mode,
                root_span: Some(error_span!("client")),
                ..Default::default()
            },
        )
        .await
        .unwrap();
        drop_checks.add(&session, "client session");

        info!("started client session");

        let (id, handle) = {
            let r = session
                .add_torrent(
                    crate::AddTorrent::Url((&magnet).into()),
                    Some(AddTorrentOptions {
                        initial_peers: Some(peers.clone()),
                        // only_files: Some(vec![0]),
                        overwrite: false,
                        ..Default::default()
                    }),
                )
                .await
                .unwrap();

            match r {
                AddTorrentResponse::AlreadyManaged(_, _) => todo!(),
                AddTorrentResponse::ListOnly(_) => todo!(),
                AddTorrentResponse::Added(id, h) => (id, h),
            }
        };

        info!("added handle");

        {
            let stats_printer = {
                let handle = handle.clone();
                async move {
                    let mut interval = interval(Duration::from_millis(100));

                    loop {
                        interval.tick().await;
                        let stats = handle.stats();
                        let live = match &stats.live {
                            Some(live) => live,
                            None => continue,
                        };
                        let pstats = &live.snapshot.peer_stats;

                        info!(
                            progress_percent =
                                format!("{}", stats.progress_percent_human_readable()),
                            peers = format!("{:?}", pstats),
                        );
                    }
                }
            }
            .instrument(error_span!("stats_printer"));

            let timeout = timeout(Duration::from_secs(180), handle.wait_until_completed());

            tokio::pin!(stats_printer);
            tokio::pin!(timeout);

            let mut stats_finished = false;
            loop {
                tokio::select! {
                    r = &mut timeout => {
                        r.unwrap().unwrap();
                        break;
                    }
                    _ = &mut stats_printer, if !stats_finished => {
                        stats_finished = true;
                    }
                }
            }
        }

        if !matches!(peer_traffic_mode, PeerTrafficMode::Off)
            && !matches!(server_peer_traffic_mode, PeerTrafficMode::Off)
        {
            assert!(session.mse_stats().successes > 0);
            assert_eq!(session.stats_snapshot().peers.live_plaintext, 0);
            assert!(
                _servers
                    .iter()
                    .any(|server| server.mse_stats().successes > 0)
            );
        } else if matches!(peer_traffic_mode, PeerTrafficMode::Prefer) {
            let stats = session.mse_stats();
            assert_eq!(stats.fallbacks, 1);
            assert_eq!(stats.successes, 0);
        }

        info!("handle is completed");
        tokio::time::timeout(Duration::from_secs(5), session.delete(id.into(), false))
            .await
            .context("timeout deleting torrent")
            .unwrap()
            .context("error deleting")
            .unwrap();

        info!("deleted handle");

        // 4. After downloading, recheck its integrity.
        let handle = session
            .add_torrent(
                crate::AddTorrent::TorrentFileBytes(torrent_file_bytes.clone()),
                Some(AddTorrentOptions {
                    paused: true,
                    overwrite: true,
                    ..Default::default()
                }),
            )
            .await
            .unwrap()
            .into_handle()
            .unwrap();

        info!("re-added handle");

        timeout(Duration::from_secs(30), async {
            let mut interval = interval(Duration::from_millis(100));
            loop {
                interval.tick().await;
                let b = handle
                    .with_state(|s| match s {
                        crate::ManagedTorrentState::Initializing(_) => Ok(false),
                        crate::ManagedTorrentState::Paused(p) => {
                            assert_eq!(p.chunk_tracker.get_hns().needed_bytes, 0);
                            Ok(true)
                        }
                        _ => bail!("bugged state"),
                    })
                    .unwrap();
                if b {
                    break;
                }
            }
        })
        .await
        .unwrap();

        tokio::time::timeout(
            Duration::from_secs(5),
            session.delete(handle.id().into(), true),
        )
        .await
        .context("timeout")
        .unwrap()
        .context("error deleting")
        .unwrap();

        // Ensure the files were deleted from the filesystem.
        let d = std::fs::read_dir(&outdir)
            .context("read_dir outdir")
            .unwrap();
        assert_eq!(
            d.into_iter().count(),
            0,
            "{outdir:?} was not empty after deletion"
        );

        info!("all good");
    }
}
