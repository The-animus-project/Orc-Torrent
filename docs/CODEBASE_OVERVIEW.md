# Orc-Torrent Codebase Overview

This document maps the Orc-Torrent architecture for contributors implementing daily-driver features.

## High-level architecture

```mermaid
flowchart TB
    ElectronUI["ui/desktop React+Electron"] -->|REST 127.0.0.1:8733| Daemon["orc-daemon Axum"]
    Daemon --> Core["orc-core OrcState"]
    Core --> Engine["orc-engine Engine contract"]
    Engine --> Backend["private rqbit v9-derived backend"]
    Backend --> Disk["downloads + state/rqbit persistence"]
    Daemon --> Config["config.json platform dir"]
    Core -->|1Hz tick| VPN["VPN detect + kill switch"]
```

## Components

| Layer | Location | Responsibility |
|-------|----------|----------------|
| Desktop app | `ui/desktop/` | Electron main process manages daemon lifecycle; React renderer talks to daemon over HTTP |
| Daemon API | `crates/orc-daemon/src/main.rs` | Axum REST API (~40 routes), auth, torrent lifecycle glue |
| Config | `crates/orc-daemon/src/config.rs` | Persistent `config.json` (listen port, kill switch, policy, search, watch folders, seeding, bandwidth, net posture) |
| Core state | `crates/orc-core/src/lib.rs` | `OrcState`, `tick()`, VPN, policy, torrent records, seeding/bandwidth/privacy logic |
| ORC Engine | `crates/orc-engine/` | ORC-owned lifecycle, snapshots, policy, capabilities, storage, and persistence boundary |
| Private backend | `crates/librqbit-v9-patched/`, `crates/rqbit-v9/` | rqbit v9.0.0-beta.2-derived TCP/uTP, IPv4/IPv6, DHT/PEX/LSD transfer core |
| API client | `ui/desktop/src/renderer/utils/api.ts` | `getJson` / `postJson` / `patchJson` to daemon |

## Daemon API (key routes)

### System
- `GET /health`, `GET /version`, `GET /engine/capabilities`

### Network / privacy
- `GET/PATCH /net/posture`, `GET /net/vpn-status`
- `GET/PATCH /net/kill-switch`, `POST /net/kill-switch/test`
- `GET /net/privacy-status`, `POST /net/privacy/preset/vpn-safety`
- `GET/PATCH /v1/policy`

### Torrents
- `GET/POST /torrents`, `GET /torrents/:id`, `GET /torrents/:id/status`
- `POST /torrents/:id/start|stop|remove|recheck|announce`
- `GET/PATCH /torrents/limits`, `PATCH /bandwidth/schedule`

### Automation
- `GET/PATCH /watch-folders`, `POST /watch-folders/test`, `GET /watch-folders/events`
- `GET/PATCH /seeding`, `GET/PATCH /torrents/:id/seeding`

### Search
- `GET/PATCH /search/settings`, `GET /search/providers`, `POST /search`
- `PUT/DELETE /search/providers/:name/credentials` (Torznab API keys; never returned by GET)
- `POST /search/providers/:name/test` (Torznab `t=caps`)
- `DELETE /search/providers/:name` (custom providers only; deletes stored secret)
- Implementation: `crates/orc-daemon/src/search.rs` plus `search/{torznab,secrets,dedup,magnet,movies}`

## Config persistence

Platform-specific path:
- **macOS:** `~/Library/Application Support/OrcTorrent/config.json`
- **Linux:** `~/.config/OrcTorrent/config.json`
- **Windows:** `%APPDATA%\OrcTorrent\config.json`

Torrent session data remains in the existing `{ORC_STATE_DIR}/rqbit` directory (desktop passes its application state directory). ORC does not rename or destructively migrate it in the engine beta.

## State model

- **OrcState** holds in-memory torrent records (UUID ids), policy, kill switch runtime, bind interface, bandwidth profile, and an ORC Engine handle.
- **tick()** runs at 1 Hz: syncs engine snapshots and enforces kill switch, seeding limits, and bandwidth schedule.
- **TorrentRecord** pairs `Torrent` metadata with `TorrentRuntime` (rates, bytes, state, seeding timestamps).

## Frontend structure

- **App.tsx** — central state, page routing (`torrents`, `settings`, `search`, `events`), polling
- **Settings tabs** — general, downloads, watch, seeding, bandwidth, search, privacy, network, interface, advanced
- **TorrentInspector** — torrent detail panel (overview, files, peers, trackers, etc.)
- **PrivacyStatusCard** — consolidated VPN/privacy status on main dashboard

## Security model

- Default bind: `127.0.0.1:8733`; non-loopback plaintext listening is refused
- Every route except `GET /health` and `GET /version` requires an exact Origin and constant-time token check
- Electron and Android proxy daemon requests natively; desktop rotates its token on every start
- Config writes are validated, synced, atomic and retain three last-known-good generations
- Torrent destinations are confined beneath the dedicated download root and reject existing symlink traversal

## Not implemented (v2.3 scope)

The following are **out of scope** and not shipped as working features:

- Overlay or anonymous routing (policy flags may exist; no overlay transport)
- I2P, WebTorrent, or Tor transport
- Plugin system or wallet integration
- Bundled search providers (users configure their own feeds or Torznab endpoints)

## Known limitations

See [KNOWN_LIMITATIONS.md](KNOWN_LIMITATIONS.md).
