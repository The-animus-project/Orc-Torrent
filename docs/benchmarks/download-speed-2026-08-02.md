# ORC Torrent download-speed benchmark — 2026-08-02

This is a point-in-time measurement of ORC Torrent's release-mode download engine. It is not a guaranteed minimum or maximum because BitTorrent throughput depends on the swarm, route, ISP, disk, and system load.

## Result

| Metric | Result |
|---|---:|
| Payload | Ubuntu 24.04.4 Live Server (AMD64) |
| Payload size | 3,405,469,696 bytes (3.17 GiB) |
| Completion time | **57.228 seconds** |
| End-to-end average | **59.51 MB/s (56.75 MiB/s, 476.1 Mbit/s)** |
| Mid-transfer average | **78.33 MB/s (626.6 Mbit/s)** |
| Highest sampled rate | **88.26 MB/s (84.17 MiB/s, 706.1 Mbit/s)** |
| Completion | 100%; daemon transitioned to `seeding` |

The end-to-end average is the primary result. It uses the entire payload and includes startup, peer discovery, and ramp-up. The mid-transfer average is the mean of nine consecutive ORC status samples from 52.5% through 88.8% completion. The peak is a sampled value, not an instantaneous theoretical maximum.

## Test environment

| Field | Value |
|---|---|
| Date and time | 2026-08-02 at approximately 11:27 AEST (UTC+10) |
| ORC version | 2.3.3 |
| Engine | `orc-daemon`, Cargo `--release` build |
| Source revision | `7235ac708eb8951047299c9cc899f35b671674b3` on `master` |
| Working tree | Dirty; the release binary included the user's current uncommitted changes |
| Operating system | macOS 26.5.2, build 25F84 |
| Architecture | arm64 |
| API | Loopback only at `127.0.0.1:18733` |
| Peer listen port | 49000 |
| Rate limits | None in the isolated default benchmark configuration |

The payload was the official Ubuntu torrent metadata at:

`https://releases.ubuntu.com/24.04.4/ubuntu-24.04.4-live-server-amd64.iso.torrent`

## Method

1. Build the current ORC daemon in release mode with `cargo build --release -p orc-daemon`.
2. Start the daemon with a temporary download directory, temporary configuration, and loopback API port 18733.
3. Add the official Ubuntu torrent through `POST /torrents` as base64-encoded `.torrent` metadata.
4. Poll `GET /torrents/:id/status` every two seconds and record `progress`, `down_rate_bps`, and `downloaded_bytes`.
5. Take the download start and completion timestamps from the release daemon log.
6. Stop the daemon and remove the temporary torrent payload and benchmark configuration.

The benchmark used a temporary, benchmark-only configuration-path override compiled into the test binary so that the user's saved VPN and kill-switch settings were not changed. The source-level override was reverted immediately after the build and did not touch the torrent engine or transfer path.

### Timing evidence

```text
2026-08-02T01:26:50.415147Z  Initial check complete: have 0, needed 3.1 GiB
2026-08-02T01:27:47.642982Z  Torrent finished downloading
```

Elapsed time:

```text
01:27:47.642982 - 01:26:50.415147 = 57.227835 seconds
```

Average throughput calculations:

```text
3,405,469,696 bytes / 57.227835 seconds = 59,507,226 bytes/second
59,507,226 bytes/second = 59.51 MB/s = 56.75 MiB/s
59,507,226 bytes/second * 8 = 476.1 Mbit/s
```

Units use decimal `MB/s` and `Mbit/s`; `MiB/s` is binary.

## Recorded ORC status samples

Sampling began after the transfer had already ramped up. The complete-transfer average above uses daemon timestamps and the full payload, not only these samples.

| Approx. seconds after start | Progress | ORC-reported rate |
|---:|---:|---:|
| 30.6 | 52.53% | 82.23 MB/s |
| 32.6 | 56.86% | 73.45 MB/s |
| 34.6 | 61.80% | **88.26 MB/s** |
| 36.6 | 66.09% | 71.28 MB/s |
| 38.6 | 70.03% | 68.64 MB/s |
| 40.6 | 74.61% | 77.60 MB/s |
| 42.6 | 79.22% | 77.84 MB/s |
| 44.6 | 84.10% | 80.74 MB/s |
| 46.6 | 88.82% | 84.91 MB/s |
| 48.6 | 92.31% | 44.55 MB/s |
| 50.6 | 94.48% | 36.14 MB/s |
| 52.6 | 96.71% | 40.36 MB/s |
| 54.6 | 98.34% | 31.46 MB/s |
| 56.6 | 99.98% | 17.03 MB/s |
| 58.6 | 100.00% | 0 MB/s (`seeding`) |

The falling rates near completion are normal for this run: fewer remaining pieces were available to schedule concurrently.

## Limitations

- This was one full-download run, not a multi-run statistical suite.
- No simultaneous line-speed baseline was recorded, so client efficiency relative to the connection cannot be calculated.
- The selected Ubuntu swarm was healthy; another torrent can produce substantially different results.
- ORC calculates `down_rate_bps` from byte deltas during its one-second state tick. The benchmark polled that value every two seconds.
- CPU, memory, disk latency, peer count, and energy use were not recorded.
- The Electron renderer was not running. This benchmark isolates the release daemon used by the desktop application.

## Cleanup

The isolated daemon was shut down after completion. The temporary 3.2 GB Ubuntu payload, torrent metadata, session data, and temporary configuration were permanently deleted. The user's saved ORC security settings were not modified, and no benchmark source changes remain.
