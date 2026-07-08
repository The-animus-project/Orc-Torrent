# ORC Torrent

![ORC Torrent](Screenshot%202026-01-30%20191541.png)

**Repository:** [github.com/The-animus-project/Orc-Torrent](https://github.com/The-animus-project/Orc-Torrent)

ORC Torrent is a decentralized BitTorrent client built with privacy in mind. We use a Rust backend for the engine and API, and an Electron + React desktop app for the interface—so you get a secure, maintainable client that we can keep improving over time.

**ORC Torrent is compatible with Windows, macOS, and Linux.** You can build and run it on any of these platforms.

**Latest release: [v2.3.1](https://github.com/The-animus-project/Orc-Torrent/releases/tag/v2.3.1)** — security hardening plus portable installers for all three platforms, with in-app GitHub auto-update.

**ORC Torrent is actively developed.** We update the roadmap and documentation as we go. If you’re interested in where we’re headed or how to contribute, read on.

---

## Downloads

Pre-built installers and portable archives are published on **[GitHub Releases](https://github.com/The-animus-project/Orc-Torrent/releases)**. CI builds run on every `v*` tag.

| Platform | Portable (no install) | Installer |
|----------|----------------------|-----------|
| **Windows** (x64) | `ORC-TORRENT-<version>-win-x64.zip` | `ORC-TORRENT-Setup-<version>.exe` |
| **macOS** (arm64) | `ORC-TORRENT-<version>-mac-arm64.zip` | `.dmg`, `.pkg` |
| **Linux** (x64) | `ORC-TORRENT-<version>-linux-x86_64.AppImage` | `.deb` |

The desktop app checks GitHub for updates automatically (Settings → Updates). Unsigned builds may show a security prompt on first launch — see [Install-Instructions](Install-Instructions/) per OS.

---

## Table of contents

- [Downloads](#downloads)
- [Screenshots](#screenshots)
- [Features](#features)
- [What makes it different](#what-makes-it-different)
- [Roadmap](#roadmap)
- [Architecture](#architecture)
- [Requirements](#requirements)
- [Building from source](#building-from-source) — see [Install-Instructions](Install-Instructions/) for OS-specific guides
- [Configuration](#configuration)
- [Usage](#usage)
- [Development](#development)
- [Changelog](#changelog)
- [Authors and contributors](#authors-and-contributors)
- [License](#license)

---

## Screenshots

Screenshots of the ORC Torrent desktop client:

| | |
|:---:|:---:|
| **Loading animation** | **Main interface** |
| ![Loading animation](Screenshot%202026-01-30%20191742.png) | ![Main interface](Screenshot%202026-01-30%20191541.png) |
| **Client view** | **Client view** |
| ![ORC Torrent client](Screenshot%202026-01-30%20191145.png) | ![ORC Torrent client](Screenshot%202026-01-30%20191351.png) |

---

## Features

| Area | Description |
|------|-------------|
| **Torrent management** | Add via magnet links or `.torrent` files; list, start, stop, remove, recheck, and announce torrents. |
| **File control** | Per-file priority and content view; resume from existing downloads. |
| **Peers and trackers** | Inspect connected peers and tracker status. |
| **Torrent search** | Compliant search page with Internet Archive, open-content JSON, and user-defined RSS/Atom/JSON feeds. Results are display-only until you manually add a torrent. |
| **Watch folders** | Auto-import `.torrent` files dropped into configured folders (debounced, duplicate-safe). |
| **Seeding controls** | Global ratio and seed-time limits; completed torrents stop automatically when targets are met. |
| **Bandwidth scheduling** | Normal and limited speed profiles with quiet-hours schedule. |
| **Privacy dashboard** | Consolidated VPN/kill-switch risk card with one-click VPN Safety Mode. |
| **Network page** | Adapter list, default route, DNS, VPN signal, and kill-switch enforcement status. |
| **GitHub auto-update** | Check for updates, download in the background, and restart to install from Settings → Updates. |
| **VPN and kill switch** | VPN interface detection (e.g. tun/wg); optional kill switch to pause all torrents when the VPN disconnects. |
| **Network posture** | Policy, bind interface, and threat presets. |
| **Security** | Request validation, error sanitization, optional admin token for remote or network use. |
| **Desktop integration** | Magnet and `.torrent` file associations; **custom notification sounds** (multiple built-in sounds for download-complete and kill-switch; choose in settings or use your own). |

---

## What makes it different

Beyond standard BitTorrent behaviour, we’ve added:

| Feature | Description |
|---------|-------------|
| **VPN-aware kill switch** | Detects VPN interfaces (tun/wg and common provider names) and can pause all torrents when the VPN drops to reduce accidental clearnet exposure. |
| **GeoIP integration** | Peer and tracker data can be enriched with country info (GeoLite2) for visibility and policy. |
| **Network posture and policy** | Central policy for when network is allowed, bind-interface control, and threat presets so behaviour fits your setup. |
| **Hardened daemon API** | Request validation, torrent ID checks, body size and concurrency limits, sanitized errors, constant-time admin token check, and security headers. |
| **Daemon and desktop split** | The Rust daemon runs the BitTorrent session and REST API; the Electron app manages the daemon and provides the UI. That separation keeps the engine stable and lets us update pieces independently. |
| **Socket-level bind interface** | When a bind interface is set, the engine binds TCP, DHT, and tracker traffic to that address; posture changes hot-rebind without a daemon restart. |
| **Policy persistence** | Kill switch, net posture, seeding, bandwidth, and watch-folder settings survive daemon restarts via `config.json`. |
| **Custom notification sounds** | Multiple built-in sounds for download-complete and kill-switch events; pick one in settings or supply your own file. Enable/disable per event in the desktop app. |

---

## Roadmap

We keep a roadmap here and update it as we progress. A more detailed, living roadmap may be added as the project grows.

| Phase | Description |
|-------|-------------|
| **Stabilization** (current) | Cross-platform polish, CI releases, tests, docs honesty, and reliability fixes after the v2.3.0 feature push. |
| **Daily driver** (in progress) | Watch folders, privacy dashboard, VPN Safety Mode, seeding/bandwidth automation, and auto-update — shipped in **2.3.0**; ongoing hardening and UX refinement. |
| **Ecosystem** (future) | Integrations and community-driven improvements; generic search provider interface only (no piracy indexers). |

Documentation: [Install](docs/INSTALL.md) · [Development](docs/DEVELOPMENT.md) · [Codebase overview](docs/CODEBASE_OVERVIEW.md) · [Privacy/VPN](docs/PRIVACY_VPN.md) · [Known limitations](docs/KNOWN_LIMITATIONS.md) · [Configuration](docs/CONFIGURATION.md) · [Testing checklist](docs/TESTING_CHECKLIST.md)

---

## Architecture

ORC Torrent is split into a backend daemon and a desktop frontend:

| Component | Location | Role |
|-----------|----------|------|
| **Desktop app** | `ui/desktop/` | Electron main process manages daemon lifecycle (start, health checks, restarts); React renderer talks to the daemon over HTTP. |
| **Daemon** | `crates/orc-daemon/` | Axum REST API (default: `127.0.0.1:8733`). Handles routing, validation, permissive CORS on loopback only, and security headers. |
| **Core** | `crates/orc-core/` | Shared state (torrents, policy, kill switch), GeoIP, VPN detection, and all logic that uses the BitTorrent engine. |
| **BitTorrent engine** | `crates/librqbit-patched/` | Patched [rqbit](https://github.com/nicksrandall/rqbit) 8.1.1 for peer stats and full API support. |

A more detailed technical overview is in [docs/CODEBASE_OVERVIEW.md](docs/CODEBASE_OVERVIEW.md).

---

## Requirements

- **Rust** (stable) — to build the daemon
- **Node.js** 20+ and **npm** — to build and run the desktop UI
- **Platforms**: ORC Torrent runs on **Windows**, **macOS**, and **Linux**. See [Install-Instructions](Install-Instructions/) for step-by-step compiling guides per OS.

---

## Building from source

For detailed, OS-specific steps (prerequisites, build order, packaging), see **[Install-Instructions](Install-Instructions/)** (Windows, macOS, Linux).

### Windows: one command from the repo root

From the **repository root**, after Rust and Node are installed:

- **`build.cmd`** — compile daemon + UI (no installer).
- **`build.cmd -Dist`** — same, then run electron-builder (NSIS installer + portable zip).

From **PowerShell**, you can use **`.\build.ps1`** with the same optional **`-Dist`**. From **Command Prompt**, use **`build.cmd`** so `build.ps1` does not open in Notepad. See [Install-Instructions/Windows.md](Install-Instructions/Windows.md).

### All platforms: `npm` in `ui/desktop`

Quick overview:

### 1. Build the daemon (optional)

`npm run build` (step 3) already compiles the daemon and copies it into `ui/desktop/assets/bin/`. To build only the Rust binary by hand, from the **repository root**:

```bash
cd crates
cargo build --release -p orc-daemon
```

The binary is at `crates/target/release/orc-daemon` (or `orc-daemon.exe` on Windows).

### 2. Install the daemon for the desktop app (optional)

Only if you skipped the integrated build and built the daemon manually:

- **Windows**: `copy crates\target\release\orc-daemon.exe ui\desktop\assets\bin\`
- **Linux / macOS**: `cp crates/target/release/orc-daemon ui/desktop/assets/bin/`

### 3. Build and package the desktop app

```bash
cd ui/desktop
npm install
npm run clean    # optional: remove old compile + release artifacts
npm run build
npm run dist
```

- `npm run build` — release-builds `orc-daemon`, copies it to `assets/bin/`, then Vite renderer and TypeScript for main and preload. Output is under `ui/desktop/dist/` (main, preload, renderer); this is not the final installer until you package.
- `npm run dist` — runs `build`, then full Electron packaging. Installers and portable archives are written to `ui/desktop/release/` (e.g. Windows NSIS + zip; Linux AppImage + `.deb`; macOS `.dmg` + `.zip` + `.pkg`).

**Linux via Docker** (from macOS or Windows hosts): `./scripts/build-linux-docker.sh` from the repo root.

**Publishing a release:** push a `v*` tag (e.g. `v2.3.0`) or run the [Build release](.github/workflows/build-release.yml) workflow manually. Artifacts are attached to the matching GitHub Release.

To run in development without packaging:

```bash
cd ui/desktop
npm run dev
```

---

## Configuration

### Daemon

| Item | Environment variable | Description |
|------|----------------------|-------------|
| Bind address | `DAEMON_BIND` | Default: `127.0.0.1:8733`. Non-loopback binding requires `DAEMON_ADMIN_TOKEN`. |
| Admin token | `DAEMON_ADMIN_TOKEN` | Optional on **loopback** (default desktop). **Required** when `DAEMON_BIND` is not a loopback address; the daemon will not start without it. |
| Download directory | `ORC_DOWNLOAD_DIR` | Default: the user’s **Downloads** folder on Windows, macOS, and Linux. |

**Non-loopback (LAN / remote) behavior:** Send the same token as the `x-admin-token` HTTP header on **every** `POST`, `PATCH`, and `DELETE` request (including adding torrents, policy changes, and `/admin/shutdown`). Cross-origin browser access uses a restrictive CORS policy in this mode; native clients and same-machine tools are unaffected. The bundled desktop app binds the daemon to loopback and does not send this header on normal UI traffic—use remote bind only with custom clients that supply the header.

**Manual checks (optional):** With `DAEMON_BIND=127.0.0.1:8733`, `POST /torrents` without `x-admin-token` should succeed (empty token). With a non-loopback bind and token set, the same request without the header should return `401`; with a matching `x-admin-token`, it should succeed.

### Search

- ORC Torrent ships a development `Mock Provider` and a strict `Open Content Feed` provider for legal/public-domain/open-license catalogs.
- Optional built-in movie search providers (`YTS`, `The Pirate Bay`, `1337x`) are **disabled by default**; enable them in Search Settings if you want movie index results alongside Internet Archive.
- Custom providers can be added with either the built-in open-content JSON format or standard RSS/Atom torrent feeds for compliant catalogs.
- Search results are display-only until the user manually clicks **Add**; the client never auto-downloads from search.
- The UI reminder is: *Only use torrents you have the legal right to download.*

**Config file** (e.g. listen port):

- **Windows**: `%APPDATA%\OrcTorrent\config.json`
- **macOS**: `~/Library/Application Support/OrcTorrent/config.json`
- **Linux**: `~/.config/OrcTorrent/config.json`

### Desktop

The desktop UI reads and writes settings (including notifications and security) through the daemon API; the daemon configuration above applies.

### Windows release code signing (optional)

Packaging in `ui/desktop/package.json` keeps `forceCodeSigning` and `signAndEditExecutable` off so local `npm run dist` works without a certificate. For signed installers in CI, configure a standard code-signing PFX: add repository secrets `CSC_LINK` (file path or URL to the PFX) and `CSC_KEY_PASSWORD`, set `CSC_IDENTITY_AUTO_DISCOVERY` to `true` in `.github/workflows/build-release.yml` when using a hosted runner with the cert available, and set the Windows `forceCodeSigning` / `signAndEditExecutable` fields in `package.json` to `true` for release builds that should enforce signing.

---

## Usage

1. Download the installer or portable archive for your OS from [GitHub Releases](https://github.com/The-animus-project/Orc-Torrent/releases).
2. Start **ORC TORRENT**. The app starts the daemon automatically and waits until it’s healthy before showing the UI.
3. Add torrents via drag-and-drop, file picker, or associated magnet links.
4. Use the torrent list and inspector for overview, files, peers, trackers, and transfers.
5. Configure VPN, kill switch, network posture, watch folders, seeding, and bandwidth in Settings.
6. Enable **Settings → Updates** to receive new releases from GitHub automatically.

---

## Development

We welcome contributions. The codebase is organized so the daemon and desktop can be worked on independently.

- **Rust**: From `crates/`, run `cargo build --release -p orc-daemon`; run tests with `cargo test`.
- **Desktop**: From `ui/desktop/`, run `npm run dev` for development; `npm run build` then `npm run dist` for a full package.
- **CI**: The workflow in [.github/workflows/build-release.yml](.github/workflows/build-release.yml) runs on `workflow_dispatch` or tags `v*`, builds macOS, Linux, and Windows installers, and attaches them to the GitHub Release.

If you’re not sure where to start, check the [roadmap](#roadmap) and open issues—we’re happy to point you to a good first task.

---

## Changelog

We keep a changelog of notable changes. **Last 5 updates:**

| Version | Highlights |
|---------|-------------|
| **2.3.1** | CodeQL security fixes (splash XSS/redirect sanitization, build-script shell hardening), `shell-quote` dependency bump. |
| **2.3.0** | Watch folders, privacy dashboard, VPN Safety Mode, GitHub auto-update, network introspection, seeding/bandwidth limits, kill-switch fixes, and honest trust copy. |
| **2.2.17** | Security dependency patches and CodeQL build-script fixes. |
| **2.2.16** | Animated notification themes, notification sound playback fixes, upgrade uninstall flow, and enforced app icon in installers. |
| **2.2.15** | XSS hardening, firewall IPC, log watcher OOM fix, and torrent-table performance improvements. |
| **2.2.14** | Install instructions for Windows, macOS, and Linux; notification sound preview and settings UI refresh. |

Full history: **[CHANGELOG.md](CHANGELOG.md)**.

---

## Authors and contributors

ORC Torrent is developed and maintained by **ORC Torrent** and **the ANIMUS PROJECT**.

**Contributors:** See **[CONTRIBUTORS.md](CONTRIBUTORS.md)** for the full list.

- **[Animus-exe](https://github.com/Animus-exe)** (Vurzumm) — [GitHub](https://github.com/Animus-exe) · [Twitter @vurzumm](https://x.com/vurzumm)
- BuGmaN

```
  /\_/\  (
 ( ^.^ ) _)
   \"/  (
 ( | | )
(__d b__)
```

---

## License

This project is licensed under the **GNU Affero General Public License v3.0 (AGPL-3.0)**.  
Copyright (C) 2026 ORC Torrent and The ANIMUS PROJECT.  
See the [LICENSE](LICENSE) file for the full text, or <https://www.gnu.org/licenses/agpl-3.0.html>.

---

![ORC Torrent](orcgit.png)
