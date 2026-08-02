# qBittorrent download-speed benchmark — 2026-08-02

This benchmark repeats ORC Torrent's 2026-08-02 download test with qBittorrent on the same machine and the same official Ubuntu torrent. It is a point-in-time comparison, not a universal ranking: BitTorrent results depend on swarm membership, peer selection, route, ISP, disk, and system load.

## Result

| Metric | qBittorrent result |
|---|---:|
| Payload | Ubuntu 24.04.4 Live Server (AMD64) |
| Payload size | 3,405,469,696 bytes (3.17 GiB) |
| qBittorrent internal completion time | **225 seconds** |
| Observed wall-clock completion time | **226.672 seconds** |
| Payload average using internal time | **15.14 MB/s (14.43 MiB/s, 121.1 Mbit/s)** |
| Payload average using observed time | **15.02 MB/s (120.2 Mbit/s)** |
| Highest sampled rate | **29.25 MB/s (27.89 MiB/s, 234.0 Mbit/s)** |
| Completion | 100%; client transitioned to `stalledUP` |

The primary result uses qBittorrent's `completion_on - added_on` interval. The independently observed time includes the API add request and up to 250 ms of completion-polling delay. The peak is a sampled value, not an instantaneous theoretical maximum.

## Like-for-like comparison with ORC

| Metric | ORC Torrent 2.3.3 | qBittorrent 5.2.3 |
|---|---:|---:|
| Completion time | **57.228 s** | **225 s** |
| Full-payload average | **59.51 MB/s** | **15.14 MB/s** |
| Highest sampled rate | **88.26 MB/s** | **29.25 MB/s** |
| Average line rate | **476.1 Mbit/s** | **121.1 Mbit/s** |

In these two runs, ORC completed the payload **3.93 times sooner** and its average payload throughput was **3.93 times qBittorrent's**. qBittorrent reached 25.4% of ORC's average and 33.1% of ORC's sampled peak.

These runs were sequential, not simultaneous or randomized. The figures describe these runs only; they do not prove that the same ratio will hold for other torrents or at another time.

## qBittorrent environment

| Field | Value |
|---|---|
| Date and time | 2026-08-02, approximately 12:05–12:09 AEST (UTC+10) |
| qBittorrent | 5.2.3, official standard macOS DMG |
| libtorrent | 1.2.20.0 |
| Qt | 6.10.3 |
| Boost | 1.86.0 |
| OpenSSL | 3.6.3 |
| Build | 64-bit universal binary, executed natively as arm64 |
| Operating system | macOS 26.5.2, build 25F84 |
| Web API | Loopback only at `127.0.0.1:18080` |
| Peer listen port | 49000, matching the ORC run |
| Download limit | Unlimited (`0`) |
| Upload limit | Unlimited (`0`) |
| Queueing | Disabled |
| DHT / PeX / LSD | Enabled / enabled / enabled |
| Encryption mode | Prefer encryption (`0`) |
| Temporary files | Disabled; direct write to isolated destination |

Package source:

`https://sourceforge.net/projects/qbittorrent/files/qbittorrent-mac/qbittorrent-5.2.3/qbittorrent-5.2.3.dmg/download`

Test torrent:

`https://releases.ubuntu.com/24.04.4/ubuntu-24.04.4-live-server-amd64.iso.torrent`

The DMG checksum structure verified successfully when mounted. `codesign --verify --deep --strict` reported that the app was valid on disk and satisfied its designated requirement. macOS `spctl` nevertheless returned `rejected` with origin `qbittorrent macos`; the benchmark ran the binary directly from the read-only mounted official DMG.

## Method

1. Download the official qBittorrent 5.2.3 macOS DMG using the standard libtorrent 1.2 build.
2. Mount the DMG read-only and verify its code signature.
3. Start qBittorrent with an isolated temporary profile, download directory, Web API port, and benchmark-only Web API credentials.
4. Confirm through `/api/v2/app/preferences` that rate limits are zero, queueing is disabled, and the peer port is 49000.
5. Add the same official Ubuntu `.torrent` through `/api/v2/torrents/add`.
6. Poll `/api/v2/torrents/info` every 250 ms for completion and record a throughput sample approximately once per second.
7. Confirm that the final file size is exactly 3,405,469,696 bytes.
8. Stop qBittorrent, detach the DMG, and remove the isolated profile, package, and payload.

### Timing evidence

qBittorrent Web API timestamps:

```text
added_on      = 1785636339
completion_on = 1785636564
elapsed       = 225 seconds
```

Independent high-resolution observation:

```text
API add started       = 1785636338.985193
completion observed   = 1785636565.657501
observed elapsed      = 226.672308 seconds
```

qBittorrent log timestamps, which have one-second display precision:

```text
2026-08-02T12:05:39  Added new torrent
2026-08-02T12:09:25  Torrent download finished
```

Payload-average calculation:

```text
3,405,469,696 bytes / 225 seconds = 15,135,421 bytes/second
15,135,421 bytes/second = 15.14 MB/s = 14.43 MiB/s
15,135,421 bytes/second * 8 = 121.1 Mbit/s
```

Units use decimal `MB/s` and `Mbit/s`; `MiB/s` is binary.

## Selected qBittorrent samples

| Approx. seconds after add | Progress | Reported rate | Seeds connected |
|---:|---:|---:|---:|
| 2.4 | 0.00% | 0 MB/s | 0 |
| 30.0 | 7.33% | 16.90 MB/s | 34 |
| 36.9 | 14.23% | **29.25 MB/s** | 40 |
| 61.3 | 29.26% | 22.42 MB/s | 54 |
| 127.1 | 50.65% | 18.85 MB/s | 75 |
| 174.0 | 75.38% | 13.19 MB/s | 81 |
| 207.8 | 93.17% | 20.13 MB/s | 81 |
| 224.3 | 99.94% | 7.22 MB/s | 80 |
| 225.0 internal / 226.7 observed | 100.00% | transfer complete | — |

qBittorrent reported 3,415,108,163 downloaded session bytes, about 9.64 MB more than the payload. The throughput average above uses the verified payload size so redundant or non-payload transfer does not inflate the result.

## Limitations

- Each client was tested once; there are no confidence intervals or run-to-run variance measurements.
- The tests ran roughly 38 minutes apart. Swarm and network conditions can change during that interval.
- qBittorrent and ORC use different torrent engines and peer-selection strategies, so they did not necessarily connect to the same peers.
- No independent line-speed test ran concurrently, so neither client's efficiency relative to the available connection can be calculated.
- CPU, memory, disk latency, energy use, and per-peer throughput were not recorded.
- qBittorrent's graphical process was running, while ORC's benchmark isolated its daemon without Electron. The transfer engines, rather than UI responsiveness, were the subject of the test.

## Cleanup

The benchmark used only a temporary profile and mounted app bundle; qBittorrent was not installed in `/Applications`. After recording the result, the client was shut down and the temporary 3.2 GB payload, qBittorrent DMG, Ubuntu torrent metadata, profile, credentials, logs, and session data were permanently deleted.
