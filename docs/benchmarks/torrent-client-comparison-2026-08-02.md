# Full torrent-client download-speed benchmark comparison — 2026-08-02

This report compares ORC Torrent, qBittorrent, Transmission, Deluge, and µTorrent on the same Mac and the same official Ubuntu torrent. It contains two complementary suites: an initial full-payload run per runnable client, followed by a controlled 12-run randomized 512 MiB milestone suite with matching 128-peer limits. These are exact measurements of this test window, not a universal client ranking: swarm membership, peer selection, network conditions, disk behavior, and runtime architecture all affect BitTorrent throughput.

## Executive summary

- In the controlled repeated suite, ORC reached 512 MiB in **14.943 s median** (range **14.916–15.921 s**) and completed **3/3** runs. qBittorrent's median was **41.685 s** and Transmission's was **268.130 s**, also with 3/3 completions.
- On median 512 MiB time, ORC delivered **2.790× qBittorrent's payload throughput** and **17.944× Transmission's**. Equivalently, ORC used **64.15% less time** than qBittorrent and **94.43% less time** than Transmission.
- Deluge completed **0/3** controlled trials by the 600-second cutoff. Its median partial-window average was **0.0205 MB/s**, with only one endpoint row at peak in every trial. ORC's completion-time advantage is therefore a lower bound of **>40.154×**, not a measured Deluge completion ratio.
- ORC achieved the result with a median peak of **46 endpoint rows**, versus **127** for qBittorrent. More connections alone did not explain throughput; productive-peer selection and request scheduling were more important in this window.
- In the earlier full-payload runs, ORC completed the 3.405 GB payload in **57.228 s**; Deluge completed in **197.274 s**; qBittorrent completed in **225 s internally**; and Transmission reached 9.6685% after a bounded 357 s run.
- The signed and notarized µTorrent Web 1.5.0 application crashed before its engine started under both native arm64 and Intel/Rosetta execution. It therefore has a compatibility result but no speed result.
- ORC's repeated advantage appears to combine a fast productive-peer ramp-up with a deep per-peer request pipeline, concurrent DHT/tracker discovery, and slow-piece reassignment. Three runs substantially improve on the original one-run comparison, but remain descriptive rather than statistically conclusive.

## Controlled randomized 512 MiB suite

### Design and metric definitions

| Field | Controlled value |
|---|---|
| Payload metadata | Identical official Ubuntu 24.04.4 Server `.torrent` in every run |
| Timed target | Exactly 536,870,912 payload bytes (512 MiB) |
| Runs | Three per client; 12 total |
| Order | Reproducibly shuffled with seed `20260802` |
| Schedule | ORC, Transmission, qBittorrent, Transmission, Deluge, Deluge, qBittorrent, qBittorrent, ORC, Deluge, Transmission, ORC |
| Per-torrent peer limit | 128 for every client |
| Global peer limit | 128 for qBittorrent, Transmission, and Deluge; ORC ran one torrent with its 128 live-peer cap |
| Rate limits | Unlimited download and upload |
| State | Fresh client profile/configuration and empty destination for every run |
| Timing origin | Immediately before the torrent-add API/RPC request; client process/API readiness excluded |
| Sampling | Status every 250 ms; peer endpoints every 1 s |
| Cutoff | 600 s per run |
| Milestones | First observed positive byte (TTFB), 64 MiB, 256 MiB, and 512 MiB |
| Endpoint privacy | Exact IP:port observations were used during analysis, then retained only as stable salted hashes; the salt is not in the published data |

Times have up to 250 ms observation uncertainty plus API response latency. “Average to 512 MiB” is the exact 536,870,912-byte target divided by the observed milestone time, so polling overshoot does not inflate it. “Reported peak” is the maximum instantaneous rate returned by the client. “Endpoint rows” counts peer-list entries and is the most comparable endpoint metric available, but client APIs do not expose identical peer-state semantics.

ORC's `/status` peer counter returned zero while `/peers` returned populated live rows. The controlled analysis therefore preserves the broken client-reported counter and separately reports peer-list endpoint rows. qBittorrent's peer-list rows were also higher than its summary connected-peer counter, so both values are retained instead of silently treating them as equivalent.

### Aggregate controlled results

| Client | Completed | Median TTFB | Median 64 MiB | Median 256 MiB | Median 512 MiB | 512 MiB range | Median target average | Median client peak / endpoint-row peak | Median unique endpoints |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| **ORC Torrent** | **3/3** | **3.801 s** | **6.832 s** | **9.878 s** | **14.943 s** | **14.916–15.921 s** | **35.929 MB/s** | broken `0` / **46** | 47 |
| **qBittorrent** | **3/3** | 4.422 s | 19.505 s | 29.648 s | 41.685 s | 29.914–43.576 s | 12.879 MB/s | 61 / 127 | 273 |
| **Transmission** | **3/3** | 30.981 s | 206.174 s | 231.286 s | 268.130 s | 176.119–293.425 s | 2.002 MB/s | 128 / 128 | 135 |
| **Deluge** | **0/3** | 9.304 s | — | — | >600 s each | all timed out | 0.0205 MB/s partial-window median | 1 / 1 | 1 |

ORC's mean 512 MiB time was **15.260 s** with sample standard deviation **0.573 s**. qBittorrent's was **38.392 ± 7.402 s**, and Transmission's was **245.891 ± 61.734 s**. With only three observations per client, those standard deviations describe this run set; they are not population confidence intervals.

### Every controlled run

Rates use decimal MB/s. A dash means the client never reached that milestone before the fixed cutoff.

| Order | Client run | TTFB | 64 MiB | 256 MiB | 512 MiB / outcome | Target or window average | Reported peak | Client peak / endpoint-row peak | Unique endpoints |
|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|
| 1 | ORC 1 | 2.796 s | 5.832 s | 9.878 s | **14.943 s** | **35.929 MB/s** | 56.111 MB/s | broken `0` / 46 | 47 |
| 2 | Transmission 1 | 30.981 s | 206.174 s | 231.286 s | 268.130 s | 2.002 MB/s | 14.770 MB/s | 128 / 128 | 149 |
| 3 | qBittorrent 1 | 4.422 s | 16.391 s | 24.044 s | 29.914 s | 17.947 MB/s | 40.109 MB/s | 52 / 127 | 232 |
| 4 | Transmission 2 | 51.120 s | 84.066 s | 152.428 s | 176.119 s | 3.048 MB/s | 14.721 MB/s | 109 / 108 | 113 |
| 5 | Deluge 1 | 9.186 s | — | — | timeout; 12,320,768 B | 0.0205 MB/s | 0.0842 MB/s | 1 / 1 | 1 |
| 6 | Deluge 2 | 9.304 s | — | — | timeout; 30,670,848 B | 0.0511 MB/s | 0.0800 MB/s | 1 / 1 | 1 |
| 7 | qBittorrent 2 | 4.426 s | 19.505 s | 33.075 s | 43.576 s | 12.320 MB/s | 23.700 MB/s | 73 / 126 | 280 |
| 8 | qBittorrent 3 | 4.334 s | 20.693 s | 29.648 s | 41.685 s | 12.879 MB/s | 25.653 MB/s | 61 / 127 | 273 |
| 9 | ORC 2 | 3.801 s | 6.832 s | 9.871 s | **14.916 s** | **35.993 MB/s** | 63.439 MB/s | broken `0` / 50 | 53 |
| 10 | Deluge 3 | 11.194 s | — | — | timeout; 2,883,584 B | 0.00481 MB/s | 0.0741 MB/s | 1 / 1 | 1 |
| 11 | Transmission 3 | 30.752 s | 247.166 s | 272.797 s | 293.425 s | 1.830 MB/s | 14.172 MB/s | 128 / 128 | 135 |
| 12 | ORC 3 | 5.816 s | 8.848 s | 11.878 s | **15.921 s** | **33.721 MB/s** | 66.085 MB/s | broken `0` / 29 | 30 |

### How much faster ORC measured

| Median comparison | Throughput ratio | Time reduction | Median time saved |
|---|---:|---:|---:|
| ORC vs. qBittorrent | **2.790×** | **64.15%** | **26.742 s** per 512 MiB |
| ORC vs. Transmission | **17.944×** | **94.43%** | **253.187 s** per 512 MiB |
| ORC vs. Deluge | **>40.154× lower bound** | **>97.51%** | **>585.057 s** per 512 MiB |

“2.790× faster” here means ORC delivered 2.790 times the milestone payload per second. The equivalent percentage increase in throughput is 178.97%; the less ambiguous completion-time statement is that ORC used 64.15% less time. Deluge has only a lower bound because none of its trials completed.

ORC and qBittorrent had similar median TTFB—3.801 s versus 4.422 s—so only 0.621 s of their 26.742 s median gap occurred before the first byte. By 64 MiB, ORC was 2.855× quicker; by 256 MiB it was 3.001× quicker; and at 512 MiB it was 2.790× quicker. The advantage therefore came mostly from ramp and sustained productive throughput, not merely an earlier first response.

### Peer endpoint overlap

Endpoint identities below are matched using stable salted hashes. Counts are unions across all three runs for each client.

| Pair | Endpoint unions | Common exact endpoints | Jaccard overlap | First client's endpoints also seen by second |
|---|---:|---:|---:|---:|
| ORC / qBittorrent | 99 / 517 | 48 | 8.45% | 48.48% |
| ORC / Transmission | 99 / 250 | 69 | 24.64% | 69.70% |
| qBittorrent / Transmission | 517 / 250 | 94 | 13.97% | 18.18% |
| ORC / Deluge | 99 / 2 | 0 | 0% | 0% |
| qBittorrent / Deluge | 517 / 2 | 0 | 0% | 0% |
| Transmission / Deluge | 250 / 2 | 0 | 0% | 0% |

The overlap shows that ORC did not win solely by receiving a completely disjoint swarm: 48 of its 99 observed endpoints also appeared in qBittorrent, and 69 appeared in Transmission. qBittorrent saw far more endpoint rows and unique endpoints than ORC but delivered lower target throughput, consistent with endpoint quality, connection state, and request scheduling mattering more than raw peer count. This is an inference from the telemetry, not proof of a single causal mechanism.

### Why ORC was faster in this suite

The measured evidence and code point to several contributing factors:

1. **High output from fewer peer rows.** ORC's median endpoint-row peak was 46 and mean was 17.48, yet it delivered a 35.929 MB/s median target average. qBittorrent's corresponding medians were 127 peak and 97.98 mean, but only 12.879 MB/s. ORC was obtaining more useful payload per observed connection in this window.
2. **Deep request pipelining.** The embedded `librqbit` runtime grants 128 outstanding chunk-request permits when a peer unchokes. That helps keep productive peers busy on moderate-latency paths (`crates/librqbit-patched/src/torrent_state/live/mod.rs`, around lines 1584–1591).
3. **Concurrent discovery.** DHT, trackers, and initial peers are merged into one peer stream rather than being attempted as a serial fallback chain (`crates/librqbit-patched/src/session.rs`, around lines 1357–1406).
4. **Slow-piece reassignment.** The scheduler first steals pieces from very slow peers at a 10× threshold and becomes more aggressive near completion at 3× (`live/mod.rs`, around lines 1485–1493).
5. **Native release runtime.** ORC, qBittorrent, and Transmission ran natively; Deluge ran ARM64 Linux inside Docker Desktop. The Deluge result therefore includes container networking and filesystem effects, although its immediate problem was visible as failure to acquire peers despite successful tracker announces.

The live-peer cap itself is not the explanation: all clients were capped at 128, and ORC never needed that many observed endpoint rows. The local `librqbit` patch declarations document peer-stat export and UDP tracker binding changes; they do not establish that all of these scheduling behaviors are ORC-specific modifications. The benchmark supports a runtime-behavior explanation, but does not isolate the causal contribution of each algorithm.

The complete anonymized machine-readable run and one-second sample data are in `docs/benchmarks/data/torrent-client-randomized-2026-08-02.json`; the compact per-run table is also available as `docs/benchmarks/data/torrent-client-randomized-2026-08-02-runs.csv`.

### Post-suite network baseline

macOS `networkQuality -s` ran after all torrent clients had stopped:

| Metric | Result |
|---|---:|
| Downlink capacity | 679.238 Mbit/s |
| Uplink capacity | 95.440 Mbit/s |
| Idle latency | 22.799 ms |
| Downlink responsiveness | 42.455 ms; 1,413 RPM (`High`) |
| Uplink responsiveness | 337.477 ms; 177 RPM (`Low`) |

For scale, ORC's median target average was 287.431 Mbit/s, 42.32% of that later downlink reading; its highest client-reported controlled rate was 528.678 Mbit/s, 77.83%. qBittorrent's median target average was 103.034 Mbit/s (15.17%), and Transmission's was 16.018 Mbit/s (2.36%). These are contextual ratios only because the capacity test was not simultaneous and used different servers/protocols.

## Original full-download results

| Client | Version / engine | Outcome | Elapsed time | End-to-end payload average | Highest sampled rate |
|---|---|---:|---:|---:|---:|
| **ORC Torrent** | 2.3.3, release daemon | 100% | **57.228 s** | **59.51 MB/s (476.1 Mbit/s)** | **88.26 MB/s** |
| **Deluge** | 2.2.0, libtorrent 2.0.13 | 100% | **197.274 s** | **17.26 MB/s (138.1 Mbit/s)** | **42.56 MB/s** |
| **qBittorrent** | 5.2.3, libtorrent 1.2.20 | 100% | **225 s internal**; 226.672 s observed | **15.14 MB/s (121.1 Mbit/s)** | **29.25 MB/s** |
| **Transmission** | 4.1.3, libtransmission | 9.669% after bounded run | **357 s**, stopped incomplete | **0.922 MB/s (7.38 Mbit/s)** over the window | **3.154 MB/s** |
| **µTorrent Web** | 1.5.0 build 6261 | Not runnable on this OS | — | — | — |

The primary result for completed runs is verified payload size divided by the full download interval, including discovery and ramp-up. qBittorrent's primary time is its internal `completion_on - added_on` interval. Transmission did not complete within the six-minute bound, so its rate is a partial-run average and must not be treated as a full-download completion result. µTorrent has no speed result because the official application crashed before its engine opened a listening socket.

In these individual runs, ORC completed the payload 3.45 times sooner than Deluge and 3.93 times sooner than qBittorrent. Deluge completed 27.73 seconds sooner than qBittorrent and averaged 1.14 times its payload throughput.

### Relative performance

| Comparison | Measured relationship |
|---|---:|
| ORC average vs. Deluge | 3.447× |
| ORC average vs. qBittorrent | 3.932× |
| Deluge average vs. qBittorrent | 1.141× |
| Deluge average as percentage of ORC | 29.01% |
| qBittorrent average as percentage of ORC | 25.44% |
| Transmission partial-window average as percentage of ORC | 1.55% |
| ORC time saved vs. Deluge | 140.046 seconds |
| ORC time saved vs. qBittorrent | 167.772 seconds |

Transmission is shown only for scale in the relative-rate rows. Because it was stopped incomplete after an abnormal startup, it is excluded from the completion ranking.

## Test chronology

| Client | Start evidence | Finish/stop evidence | Measured interval | Result at end |
|---|---|---|---:|---:|
| ORC Torrent | 11:26:50.415147 AEST, initial check complete | 11:27:47.642982 AEST, finished | 57.227835 s | 100% |
| qBittorrent | 12:05:38.985193 AEST, API add started | 12:09:25.657501 AEST, completion observed | 226.672308 s observed | 100% |
| qBittorrent internal | `added_on = 1785636339` | `completion_on = 1785636564` | 225 s | 100% |
| Transmission | 12:18:48.756 AEST, add started | approximately 12:24:45.756 AEST, bounded stop | 357 s | 9.6685% |
| Deluge | 12:38:19.820 AEST, add started | approximately 12:41:37.094 AEST, completion observed | 197.274000 s | 100% |
| µTorrent Web | 12:44–12:47 AEST, multiple verified launch attempts | aborted before server startup | — | Not runnable |

The tests were deliberately sequential so clients did not compete for bandwidth or disk access. The tradeoff is that the swarm and network path were not identical at each start time.

## Configuration and execution matrix

| Field | ORC Torrent | qBittorrent | Transmission | Deluge | µTorrent Web |
|---|---|---|---|---|---|
| Version | 2.3.3 | 5.2.3 | 4.1.3 | 2.2.0 | 1.5.0 build 6261 |
| Transfer engine | patched `librqbit` 8.1.1 | libtorrent 1.2.20 | libtransmission | libtorrent 2.0.13 | Engine never started |
| Runtime | Native release daemon | Native arm64 GUI app | Native command-line daemon | ARM64 Linux container | Native app attempted as arm64 and x86_64/Rosetta |
| Download limit | Unlimited | Unlimited (`0`) | Unlimited | Unlimited (`-1`) | Not reached |
| Upload limit | Unlimited | Unlimited (`0`) | Unlimited | Unlimited (`-1`) | Not reached |
| Peer listen port | 49000 | 49000 | 49000 | 49020 through container mapping | No socket opened |
| DHT | Enabled | Enabled | Enabled | Enabled | Not reached |
| Peer exchange | Enabled | PeX enabled | PeX enabled | µTorrent PeX enabled | Not reached |
| Local discovery | Enabled by benchmark security state | LSD enabled | LPD enabled | LSD enabled | Not reached |
| Encryption | Engine default | Prefer encryption | Preferred | Engine default | Not reached |
| Connection limits | Engine cap of 128 live peers per torrent | Client configuration retained | 50 peers per torrent | 200 global, unlimited per torrent, 50 half-open | Not reached |
| Queueing | ORC default | Disabled | Transmission default | Deluge default | Not reached |
| Destination | Isolated native temporary directory | Isolated native temporary directory | Isolated native temporary directory | Isolated Docker-mounted directory | No torrent added |

Not every client exposes equivalent settings, and the test intentionally retained each client's materially relevant connection strategy instead of forcing all engines into artificial identical tuning.

## Shared payload and machine

| Field | Value |
|---|---|
| Test date | 2026-08-02, AEST (UTC+10) |
| Operating system | macOS 26.5.2, build 25F84 |
| Architecture | Apple Silicon, arm64 |
| Payload | Ubuntu 24.04.4 Live Server (AMD64) |
| Payload size | 3,405,469,696 bytes (3.17 GiB) |
| Torrent metadata | `https://releases.ubuntu.com/24.04.4/ubuntu-24.04.4-live-server-amd64.iso.torrent` |
| Rate limits | Unlimited for every measured client |
| Execution order | ORC, qBittorrent, Transmission, Deluge, then µTorrent compatibility check |

The clients ran sequentially and used isolated temporary download and configuration directories. They did not share partial payload data.

## ORC Torrent result

ORC was built with `cargo build --release -p orc-daemon` from source revision `7235ac708eb8951047299c9cc899f35b671674b3`. The worktree was dirty, so the tested binary included the user's current uncommitted changes. The daemon ran without the Electron renderer, using an isolated benchmark configuration and loopback API at `127.0.0.1:18733`.

| Metric | ORC result |
|---|---:|
| Start timestamp | 11:26:50.415147 AEST |
| Completion timestamp | 11:27:47.642982 AEST |
| Completion time | 57.227835 seconds |
| Verified payload | 3,405,469,696 bytes |
| End-to-end average | 59.507 MB/s (56.750 MiB/s, 476.06 Mbit/s) |
| Mid-transfer sample average | 78.33 MB/s (626.6 Mbit/s) |
| Highest sampled rate | 88.26 MB/s (84.17 MiB/s, 706.1 Mbit/s) |
| Final state | `seeding` |

Timing evidence:

```text
2026-08-02T01:26:50.415147Z  Initial check complete: have 0, needed 3.1 GiB
2026-08-02T01:27:47.642982Z  Torrent finished downloading
```

### Complete retained ORC sample series

| Seconds after transfer start | Progress | ORC-reported rate |
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

The end-to-end average comes from daemon timestamps and the full payload, not from averaging these samples. Sampling began after ORC had already ramped up.

## qBittorrent result

qBittorrent 5.2.3 was run from the official standard macOS DMG. The universal application executed natively as arm64 with an isolated profile, destination, and loopback Web API at `127.0.0.1:18080`. The test disabled queueing, confirmed zero rate limits, and retained DHT, PeX, LSD, and preferred encryption.

| Metric | qBittorrent result |
|---|---:|
| Internal add timestamp | `1785636339` |
| Internal completion timestamp | `1785636564` |
| Internal completion time | 225 seconds |
| API add start | 12:05:38.985193 AEST |
| Completion observed | 12:09:25.657501 AEST |
| Observed completion time | 226.672308 seconds |
| Verified payload | 3,405,469,696 bytes |
| Average using internal time | 15.135 MB/s (14.434 MiB/s, 121.08 Mbit/s) |
| Average using observed time | 15.024 MB/s (120.19 Mbit/s) |
| Highest sampled rate | 29.25 MB/s (27.89 MiB/s, 234.0 Mbit/s) |
| Final state | `stalledUP` |

### Retained qBittorrent samples

| Seconds after add | Progress | Reported rate | Connected seeds |
|---:|---:|---:|---:|
| 2.4 | 0.00% | 0 MB/s | 0 |
| 30.0 | 7.33% | 16.90 MB/s | 34 |
| 36.9 | 14.23% | **29.25 MB/s** | 40 |
| 61.3 | 29.26% | 22.42 MB/s | 54 |
| 127.1 | 50.65% | 18.85 MB/s | 75 |
| 174.0 | 75.38% | 13.19 MB/s | 81 |
| 207.8 | 93.17% | 20.13 MB/s | 81 |
| 224.3 | 99.94% | 7.22 MB/s | 80 |
| 225.0 internal / 226.7 observed | 100.00% | complete | — |

qBittorrent reported 3,415,108,163 downloaded session bytes, approximately 9.64 MB more than the payload. The comparison uses verified payload size, preventing redundant or protocol transfer from inflating the average.

The DMG checksum structure and application code signature verified successfully. `spctl` nevertheless rejected execution with origin `qbittorrent macos`, so the signed binary was run directly from the read-only official image without modifying it.

## Transmission result

Transmission 4.1.3 was run through the Homebrew-packaged `transmission-daemon`, using the same upstream transfer engine as the desktop application. The daemon used an isolated configuration, loopback RPC at port 19091, peer port 49000, unlimited rates, DHT, PeX, LPD, preferred encryption, port mapping, and its default per-torrent peer limit of 50.

The torrent was added at approximately 12:18:48 AEST. Tracker data reported 601 seeders and four leechers, but peer acquisition was unusually slow: the run initially had one peer and no transferred payload for roughly 110 seconds. It later reached the 50-peer limit, with 46 peers sending at the final query.

| Metric | Transmission result |
|---|---:|
| Bounded interval | 357 seconds |
| Downloaded payload | 329,259,008 bytes |
| Remaining payload | 3,076,210,688 bytes |
| Progress | 9.6685% |
| Window-average payload rate | 0.922 MB/s (0.880 MiB/s, 7.38 Mbit/s) |
| Highest sampled rate | 3.154 MB/s (3.008 MiB/s, 25.23 Mbit/s) |
| Final reported rate | 1.237 MB/s |
| Connected / sending peers at stop | 50 / 46 |
| Straight-line projection at window average | 3,692 seconds (61.5 minutes) |

The projection is illustrative only. It assumes the slow startup and later transfer rate repeat uniformly; it is not a measured completion time.

## Deluge result

The current official Deluge release is 2.2.0, but the project does not publish a current macOS application bundle. A native temporary installation against Homebrew's current libtorrent 2.1.0 could start only after removing an obsolete setting, then failed when Deluge accessed another status field removed by libtorrent 2.1. Rather than benchmark a substantially patched client, the test used the maintained ARM64 LinuxServer Deluge 2.2.0 container with its supported libtorrent 2.0.13 runtime.

Container identity:

```text
lscr.io/linuxserver/deluge@sha256:33a939576f7ecfc1227db1a0cb2afce030ce983e620ec9d93c956e3700e21fe9
LinuxServer build: 2.2.0-ls381 (2026-07-06)
Architecture: arm64
```

Deluge used its default connection limits, unlimited download/upload rates, DHT, µTorrent PeX, LSD, UPnP, NAT-PMP, and an isolated peer port mapped at 49020. The torrent was added at approximately 12:38:19 AEST. It completed and was immediately paused to prevent sustained seeding.

| Metric | Deluge result |
|---|---:|
| Observed completion time | 197.274 seconds |
| Verified completed payload | 3,405,469,696 bytes |
| Payload average | 17.263 MB/s (16.463 MiB/s, 138.10 Mbit/s) |
| Highest sampled rate | 42.560 MB/s (40.588 MiB/s, 340.48 Mbit/s) |
| Deluge internal active time | 198 seconds |
| Final tracker status | `Announce OK` |

### Selected Deluge samples

| Seconds after add | Progress | Reported rate | Connected peers |
|---:|---:|---:|---:|
| 5.2 | 0.006% | 0.04 MB/s | 2 |
| 40.1 | 1.90% | 3.08 MB/s | 6 |
| 85.2 | 11.39% | 10.86 MB/s | 15 |
| 120.0 | 34.47% | 32.74 MB/s | 12 |
| 135.1 | 51.60% | 39.48 MB/s | 14 |
| 165.1 | 86.69% | 41.45 MB/s | 12 |
| 175.2 | 97.75% | 35.50 MB/s | 12 |
| 195.2 | 99.88% | 3.92 MB/s | 12 |
| 197.274 | 100.00% | complete | 12 |

## µTorrent compatibility result

The official Mac download page offers µTorrent Web and states that µTorrent Classic is not compatible with macOS 10.15 or later. The official µTorrent Web asset was downloaded from:

`https://utweb-assets.bittorrent.com/installer/uTorrentWeb.dmg`

Verification and compatibility evidence:

| Field | Value |
|---|---|
| DMG SHA-256 | `7b1de25be5c32c6ab175c692f5ef675b85128880d02d601b84bec593c76aac98` |
| DMG internal checksum | Valid |
| Application | µTorrent Web 1.5.0, build 6261 |
| Architectures | arm64 and x86_64 |
| Signature | Valid Developer ID Application: BitTorrent, Inc (`SNBT6M4A7T`) |
| Notarization | Accepted by Gatekeeper; stapled ticket |
| Signature timestamp | 2025-03-24 13:28:26 |
| Native arm64 launch | Aborted before server startup |
| Intel slice through Rosetta | Aborted before server startup |
| Error | Uncaught `std::__1::bad_function_call`; `SIGABRT` |

Both signed slices failed in the same way before opening a local UI or peer socket. No signature checks were bypassed and the binary was not modified. Because no torrent could be added, reporting a throughput value would be misleading; µTorrent is recorded as **not runnable on macOS 26.5.2 for this test**.

Official Mac page: `https://www.utorrent.com/downloads/mac/`

## Method summary

1. Use the identical official Ubuntu `.torrent` metadata and an empty isolated destination for each client.
2. Confirm unlimited rate settings and record relevant discovery, connection, and port settings.
3. Start the timer immediately before or at the add request.
4. Poll each client's supported API at a short interval and retain periodic progress/rate samples.
5. For completed runs, verify the final payload size and divide it by the full elapsed interval.
6. In the controlled suite, stop at the fixed 512 MiB milestone or 600-second timeout, retain endpoint hashes and one-second samples, and repeat three times per client in a reproducibly shuffled order.
7. Stop or pause the client immediately after the result, then remove temporary payload and configuration data.
8. If a client cannot run, document the verified package and failure rather than assigning a zero-speed score.

The detailed ORC and qBittorrent methods and timing evidence are in:

- `docs/benchmarks/download-speed-2026-08-02.md`
- `docs/benchmarks/qbittorrent-download-speed-2026-08-02.md`

## Limitations

- The controlled suite has three randomized runs per client, enough to expose large variance but too few for strong population confidence intervals. The earlier full-payload suite remains one run per client.
- Tests were sequential, so swarm health and internet conditions changed between starts. Randomized order reduces systematic ordering bias but cannot make peer availability simultaneous or identical.
- The controlled suite matched the exposed 128-peer limits and unlimited rates, but clients still differ in connection state machines, request queues, discovery behavior, encryption defaults, and what their APIs call a connected peer.
- The 250 ms poll interval makes milestone times interval-censored at approximately that resolution plus API latency.
- Exact raw IP:port observations were used only to calculate stable endpoint matches. Published endpoint identifiers are salted hashes, and the salt is not retained with the data.
- Deluge ran inside Docker Desktop because no supported current native macOS build was available. Container NAT, filesystem virtualization, and Linux scheduling may affect its result.
- Transmission's desktop GUI was not running; the upstream 4.1.3 daemon performed the transfer.
- Deluge's original full-payload run completed, but all three controlled runs timed out after acquiring at most one endpoint row. Those two observations demonstrate run-to-run/environment sensitivity rather than a contradiction.
- Transmission's original full-payload run was stopped incomplete at six minutes; all three later controlled 512 MiB runs completed.
- µTorrent could not start its engine on this OS, so it has no download-speed measurement.
- The line-speed baseline ran only after the suite, so efficiency percentages are contextual rather than simultaneous measurements.
- CPU, memory, disk latency, energy use, and per-peer throughput were not recorded.

## Cleanup

All clients used temporary benchmark state. The original 3.6 GB temporary suite and the controlled suite's 2.6 GB temporary directory—including payload fragments, raw IP:port endpoint observations, profiles, logs, credentials, binaries, and disk-image copies—were permanently deleted after the disk images were detached. Only salted endpoint hashes, metrics, and one-second samples remain in the published JSON/CSV artifacts. All Deluge containers and the exact locally pulled image digest were removed. The Homebrew `transmission-cli` package installed solely for the benchmark was uninstalled, and Homebrew automatically removed its now-unused `libevent`, `libpsl`, and `miniupnpc` dependencies. µTorrent's cache, support data, and benchmark-generated crash reports from the original suite were moved to the recoverable Trash folder `orc-torrent-benchmark-cleanup-2026-08-02-1248`.
