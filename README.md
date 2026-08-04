# ORC Torrent

![ORC Torrent](Screenshot%202026-01-30%20191541.png)

**Repository:** [github.com/The-animus-project/Orc-Torrent](https://github.com/The-animus-project/Orc-Torrent)

**Official website:** [Orclabs.io](https://orclabs.io)

ORC Torrent is a decentralized BitTorrent client built with privacy in mind. A shared Rust engine powers the Electron desktop app and the native Android shell, with React providing adaptive desktop and phone interfaces.

**ORC Torrent is compatible with Android 10+, Windows, macOS, and Linux.**

**Latest release: [v2.5.1](https://github.com/The-animus-project/Orc-Torrent/releases/tag/v2.5.1)** — Emergency fix for daemon startup on legacy search configs; includes the v2.5.0 ORC Engine stack.

**Android is here.** Phones and tablets running Android 10+ can install ORC from the signed `arm64-v8a` APK. See the [Android installation guide](Install-Instructions/Android.md) for download, verification, sideloading, and first-run setup.

<p align="center">
  <a href="https://github.com/The-animus-project/Orc-Torrent/releases/latest/download/ORC-TORRENT-Setup-2.5.1.exe">
    <img alt="Download for Windows" src="https://img.shields.io/badge/Windows-Download-0078D6?style=for-the-badge&logo=windows&logoColor=white">
  </a>
  &nbsp;
  <a href="https://github.com/The-animus-project/Orc-Torrent/releases/latest/download/ORC-TORRENT-2.5.1-mac-arm64.dmg">
    <img alt="Download for macOS" src="https://img.shields.io/badge/macOS-Download-000000?style=for-the-badge&logo=apple&logoColor=white">
  </a>
  &nbsp;
  <a href="https://github.com/The-animus-project/Orc-Torrent/releases/latest/download/ORC-TORRENT-2.5.1-linux-x86_64.AppImage">
    <img alt="Download for Linux" src="https://img.shields.io/badge/Linux-Download-FCC624?style=for-the-badge&logo=linux&logoColor=black">
  </a>
</p>
<p align="center">
  <a href="https://github.com/The-animus-project/Orc-Torrent/releases/latest/download/ORC-TORRENT-2.5.1-android-arm64-v8a.apk">
    <img alt="Download for Android" src="https://img.shields.io/badge/Android%2010%2B-Download-3DDC84?style=for-the-badge&logo=android&logoColor=white">
  </a>
</p>
<p align="center">
  <sub>Windows installer · macOS DMG (Apple Silicon and Intel) · Linux AppImage · Android APK — <a href="https://github.com/The-animus-project/Orc-Torrent/releases/latest">portable zips &amp; other formats</a></sub>
</p>
<p align="center">
  <a href="https://github.com/The-animus-project/Orc-Torrent">
    <img alt="Leave a star on GitHub" src="https://img.shields.io/github/stars/The-animus-project/Orc-Torrent?style=for-the-badge&logo=github&label=Leave%20a%20star&color=gold">
  </a>
</p>

**ORC Torrent is actively developed.** Current work centers on the **ORC Engine** — the shared transfer boundary for desktop and Android — including modern swarm networking, opt-in MSE/PE, BEP 6, and adaptive request scheduling. We update the roadmap and documentation as we go.

---

## Downloads

Pre-built installers and portable archives are published on **[GitHub Releases](https://github.com/The-animus-project/Orc-Torrent/releases)**. CI builds run on every `v*` tag.

| Platform | Portable (no install) | Installer |
|----------|----------------------|-----------|
| **Windows** (x64) | `ORC-TORRENT-<version>-win-x64.zip` | `ORC-TORRENT-Setup-<version>.exe` |
| **macOS** (arm64 / x64) | `ORC-TORRENT-<version>-mac-<arch>.zip` | `.dmg`, `.pkg` |
| **Linux** (x64) | `ORC-TORRENT-<version>-linux-x86_64.AppImage` | `.deb` |
| **Android** (arm64, Android 10+) | `ORC-TORRENT-<version>-android-arm64-v8a.apk` | Sideload the signed APK |

**Portable** builds run without an installer — extract or make executable, then launch the app. **Installers** register shortcuts, menu entries, and (on Windows/macOS) magnet / `.torrent` file associations.

### Verify a release build with PGP

Signed release builds are published with armored detached PGP signatures. Download the build and its matching `.asc` file from the same [GitHub release](https://github.com/The-animus-project/Orc-Torrent/releases), then download [`ORC-Torrent-Release-Key.asc`](ORC-Torrent-Release-Key.asc) from this repository.

Import the release key and confirm its fingerprint:

```sh
gpg --import ORC-Torrent-Release-Key.asc
gpg --fingerprint 6D0D5CE9E0DA5A92
```

The fingerprint must be:

```text
094F 3796 D3B6 99DB 5E69 A278 6D0D 5CE9 E0DA 5A92
```

Verify the downloaded build before opening or extracting it. For example:

```sh
gpg --verify ORC-TORRENT-2.5.1-linux-x86_64.AppImage.asc ORC-TORRENT-2.5.1-linux-x86_64.AppImage
```

You can also verify the signed checksum manifest and then check all downloaded builds in it:

```sh
gpg --verify SHA256SUMS.asc SHA256SUMS
shasum -a 256 -c SHA256SUMS
```

A valid result reports a good signature made by the key above. A good signature proves the file has not changed since it was signed; independently confirm the fingerprint from a trusted source before trusting the key. PGP signing is separate from Windows Authenticode and Apple Developer ID signing, so the operating system may still display an unverified-developer warning.

---

## Installation

Download the asset for your OS from the [latest release](https://github.com/The-animus-project/Orc-Torrent/releases/latest). Replace `<version>` below with the release tag (e.g. `2.5.1`).

### Windows

| Method | Steps |
|--------|--------|
| **Portable** | Download `ORC-TORRENT-<version>-win-x64.zip` → extract to any folder → run **`ORC TORRENT.exe`**. No admin rights required; safe to keep on a USB drive. |
| **Installer** | Download `ORC-TORRENT-Setup-<version>.exe` → run the wizard → start **ORC TORRENT** from the Start menu or desktop shortcut. |

On first launch, Windows SmartScreen may warn because the build is unsigned — choose **More info** → **Run anyway**. Portable and installer builds both support in-app updates (Settings → Updates).

### macOS (Apple Silicon or Intel)

| Method | Steps |
|--------|--------|
| **Portable** | Download `ORC-TORRENT-<version>-mac-arm64.zip` on Apple Silicon or `ORC-TORRENT-<version>-mac-x64.zip` on Intel → extract → open **`ORC TORRENT.app`**. |
| **DMG** | Open the `.dmg` → drag **ORC TORRENT** to **Applications**. |
| **PKG** | Run the `.pkg` installer → follow the prompts. |

macOS may block the app on first open (unverified developer). Use **right-click → Open**, or allow it under **System Settings → Privacy & Security**. Choose **arm64** for Apple Silicon or **x64** for Intel Macs.

### Linux (x64)

| Method | Steps |
|--------|--------|
| **Portable (AppImage)** | Download `ORC-TORRENT-<version>-linux-x86_64.AppImage` → `chmod +x ORC-TORRENT-*-linux-x86_64.AppImage` → run it. No root or package manager required. |
| **.deb** | `sudo dpkg -i ORC-TORRENT-<version>-linux-amd64.deb` → launch from your application menu. |

AppImages need [FUSE](https://github.com/AppImage/AppImageKit/wiki/FUSE) on some distributions (`libfuse2` on Ubuntu/Debian).

### Android 10+

Download `ORC-TORRENT-<version>-android-arm64-v8a.apk` from GitHub Releases, verify the signed checksum manifest, and allow your browser or file manager to install that APK. On first launch, create or select a dedicated ORC subfolder with Android's system folder picker. The app does not request broad storage access, and completed files remain in that shared folder after uninstall.

Transfers use unmetered Wi-Fi by default. Cellular data and automatic VPN-disconnect transfer pausing are explicit opt-ins in Settings and Privacy.

For complete download-verification, sideloading, onboarding, updating, and troubleshooting steps, read **[Install ORC Torrent on Android](Install-Instructions/Android.md)**.

### After install

1. Start **ORC TORRENT**. Desktop launches its local daemon automatically; Android starts the same Rust engine on-device.
2. Add torrents via drag-and-drop or file picker on desktop, or the Add sheet and Android Open With/Share flows on mobile. Both platforms accept magnet links and `.torrent` files.
3. Desktop can use **Settings → Updates**. Android updates are installed by downloading the next signed APK from GitHub Releases and installing it over the existing app.

To compile from source instead of using a release build, see [Building from source](#building-from-source) and [Install-Instructions](Install-Instructions/).

---

## Table of contents

- [Downloads](#downloads)
- [Verify a release build with PGP](#verify-a-release-build-with-pgp)
- [Installation](#installation)
- [Screenshots](#screenshots)
- [Features](#features)
- [What makes it different](#what-makes-it-different)
- [Speed comparison](#speed-comparison)
- [Roadmap](#roadmap)
- [Architecture](#architecture)
- [Requirements](#requirements)
- [Building from source](#building-from-source) — see [Install-Instructions](Install-Instructions/) for OS-specific guides
- [Configuration](#configuration)
- [Usage](#usage)
- [Development](#development)
- [Changelog](#changelog)
- [Author](#author)
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
| **Torrent search** | Search page for user-configured RSS/Atom/JSON feeds and **Torznab** providers (Jackett / Prowlarr compatible). ORC ships without search providers, and results are display-only until you manually add a torrent. |
| **Watch folders** | Auto-import `.torrent` files dropped into configured folders (debounced, duplicate-safe). |
| **Seeding controls** | Global ratio and seed-time limits; completed torrents stop automatically when targets are met. |
| **Bandwidth scheduling** | Normal and limited speed profiles with quiet-hours schedule. |
| **Privacy dashboard** | Consolidated VPN/kill-switch risk card with one-click VPN Safety Mode. |
| **Network page** | Adapter list, default route, DNS, VPN signal, and kill-switch enforcement status. |
| **GitHub auto-update** | Check for updates, download in the background, and restart to install from Settings → Updates. |
| **VPN transfer pause** | VPN interface detection (e.g. tun/wg); optionally closes ORC transfer/discovery sockets when the VPN disconnects. This is not an OS firewall. |
| **ORC Engine** | Shared desktop/Android transfer facade (`orc-engine`) with capabilities API, legacy/modern swarm modes, and truthful runtime privacy status. |
| **Peer traffic obfuscation** | Opt-in MSE/PE (RC4) over TCP via `orc-mse` — `off`, `prefer`, or `require`. Obfuscation only; not anonymity. |
| **Adaptive scheduling (beta)** | Opt-in `orc-scheduler` with per-peer RTT/goodput pipelines, stalled-block recovery, and bounded endgame. Legacy remains the default. |
| **BEP 6 Fast Extension** | `suggest piece`, `have all`/`none`, `reject request`, and `allowed fast`. |
| **Network posture** | Policy, bind interface, and threat presets. |
| **Security** | Required admin token and exact Origin on protected routes, path confinement, and fail-closed configuration. |
| **Desktop integration** | Magnet and `.torrent` file associations; **custom notification sounds** (multiple built-in sounds for download-complete and kill-switch; choose in settings or use your own). |

---

## What makes it different

Beyond standard BitTorrent behaviour, we’ve added:

| Feature | Description |
|---------|-------------|
| **VPN-aware transfer pause** | Detects VPN interfaces and can close ORC sockets and pause transfers when the VPN drops. It does not block other applications. |
| **GeoIP integration** | Peer and tracker data can be enriched with country info (GeoLite2) for visibility and policy. |
| **Network posture and policy** | Central policy for when network is allowed, bind-interface control, and threat presets so behaviour fits your setup. |
| **ORC Engine boundary** | Application code talks only to `orc-engine`. The private rqbit-derived backend, MSE, and scheduler can evolve without changing torrent UUIDs, REST routes, or the existing `state/rqbit` persistence directory. |
| **Hardened daemon API** | Exact Origin allowlist, required admin token on every protected route (including loopback reads), sanitized errors, and desktop token isolation from the renderer. |
| **Daemon and desktop split** | The Rust daemon runs the BitTorrent session and REST API; the Electron app manages the daemon and proxies authenticated calls. That separation keeps the engine stable and lets us update pieces independently. |
| **Socket-level bind interface** | When a bind interface is set, the engine binds TCP, uTP, DHT, tracker, and LSD sockets to that address; strict mode refuses wildcard fallback. |
| **Policy persistence** | Kill switch, net posture, seeding, bandwidth, and watch-folder settings survive daemon restarts via `config.json`. |
| **Custom notification sounds** | Multiple built-in sounds for download-complete and kill-switch events; pick one in settings or supply your own file. Enable/disable per event in the desktop app. |

---

## Speed comparison

We compared ORC Torrent with qBittorrent, Transmission, and Deluge using the same official Ubuntu torrent on the same Apple Silicon Mac. The controlled suite used an exact 512 MiB target, three runs per client, randomized execution order, fresh client state, unlimited rates, and matching 128-peer limits.

| Client | Controlled result | Median time to 512 MiB | Median target average | ORC throughput advantage |
|---|---:|---:|---:|---:|
| **ORC Torrent 2.3.3** | **3/3 completed** | **14.943 s** | **35.929 MB/s** | — |
| qBittorrent 5.2.3 | 3/3 completed | 41.685 s | 12.879 MB/s | **2.790×** |
| Transmission 4.1.3 | 3/3 completed | 268.130 s | 2.002 MB/s | **17.944×** |
| Deluge 2.2.0 | 0/3 before cutoff | >600 s each | 0.0205 MB/s partial-window median | **>40.154× lower bound** |

ORC used **64.15% less time than qBittorrent** and **94.43% less time than Transmission** to reach 512 MiB. It achieved this with a median peak of 46 observed peer rows, versus 127 for qBittorrent, suggesting that productive-peer use and request scheduling mattered more than raw connection count in this test window.

These August 2, 2026 results describe this benchmark window, not guaranteed performance for every torrent or network. Deluge ran in an ARM64 Linux container because its current native macOS setup was incompatible. See the [full multi-client benchmark](docs/benchmarks/torrent-client-comparison-2026-08-02.md) for every run, the earlier full-payload comparison, methodology, environment, machine-readable data, and limitations.

---

## Roadmap

We keep a roadmap here and update it as we progress. A more detailed, living roadmap may be added as the project grows.

| Phase | Description |
|-------|-------------|
| **ORC Engine** (current) | Own the transfer stack behind `orc-engine`: promote modern swarm `auto` when the cross-platform gate passes, harden MSE/PE and BEP 6, mature adaptive scheduling, and keep truthful capabilities/privacy status. See [ORC Engine](docs/ORC_ENGINE.md) and [adaptive scheduler](docs/ORC_ADAPTIVE_SCHEDULER.md). |
| **Cross-platform polish** (in progress) | Signed Android/desktop releases, CI matrix, docs honesty, and reliability after the v2.4.0 / v2.5.0 feature push. |
| **Daily driver** (shipped, refining) | Watch folders, privacy dashboard, VPN Safety Mode, seeding/bandwidth automation, and auto-update — shipped in **2.3.0**; ongoing UX and hardening. |
| **Ecosystem** (future) | Integrations and community-driven improvements; generic search provider interface only (no piracy indexers). |

Documentation: [Install](docs/INSTALL.md) · [Development](docs/DEVELOPMENT.md) · [ORC Engine](docs/ORC_ENGINE.md) · [Adaptive scheduler](docs/ORC_ADAPTIVE_SCHEDULER.md) · [Codebase overview](docs/CODEBASE_OVERVIEW.md) · [Privacy/VPN](docs/PRIVACY_VPN.md) · [Known limitations](docs/KNOWN_LIMITATIONS.md) · [Configuration](docs/CONFIGURATION.md) · [Testing checklist](docs/TESTING_CHECKLIST.md)

---

## Architecture

ORC Torrent is split into a shared Rust transfer stack, a daemon API, and desktop/Android frontends:

| Component | Location | Role |
|-----------|----------|------|
| **Desktop app** | `ui/desktop/` | Electron main process manages daemon lifecycle and proxies authenticated API operations; the React renderer never receives the daemon token or chooses its authority. |
| **Android app** | `ui/android/` | Capacitor shell with on-device Rust via JNI; same engine contract as desktop. |
| **Daemon** | `crates/orc-daemon/` | Authenticated Axum REST API on `127.0.0.1:8733`, with an exact Origin allowlist and deny-by-default middleware. |
| **Core** | `crates/orc-core/` | Shared state (torrents, policy, kill switch), GeoIP, VPN detection, and logic expressed through the ORC Engine contract. |
| **ORC Engine** | `crates/orc-engine/` | Public async transfer facade for lifecycle, storage, persistence, network policy, capabilities, privacy status, peers, suspension, and reconfiguration. Application crates must not depend on `librqbit` directly. |
| **MSE / scheduler** | `crates/orc-mse/`, `crates/orc-scheduler/` | Independent peer-traffic obfuscation and adaptive request scheduling owned by ORC. |
| **Private backend** | `crates/librqbit-v9-patched/`, `crates/rqbit-v9/` | rqbit [v9.0.0-beta.2](https://github.com/ikatson/rqbit/releases/tag/v9.0.0-beta.2)-derived implementation (Apache-2.0), kept behind the engine facade. Attribution: [`crates/orc-engine/NOTICE.md`](crates/orc-engine/NOTICE.md). |

**Developing the ORC Engine.** Treat `orc-engine` as the only public transfer API. Prefer additive capabilities and runtime-truthful status over silent fallbacks. Legacy networking and legacy scheduling stay the safe defaults until promotion gates pass. Local checks:

```bash
cd crates
cargo test -p orc-engine -p orc-mse -p orc-scheduler -p orc-core
cargo run -p orc-scheduler --bin scheduler-bench --release
```

Details: [docs/ORC_ENGINE.md](docs/ORC_ENGINE.md) · [docs/ORC_ADAPTIVE_SCHEDULER.md](docs/ORC_ADAPTIVE_SCHEDULER.md) · [docs/CODEBASE_OVERVIEW.md](docs/CODEBASE_OVERVIEW.md).

---

## Requirements

- **Rust** (stable) — to build the daemon
- **Node.js** 20+ and **npm** — to build and run the desktop UI
- **Platforms**: ORC Torrent runs on **Android 10+**, **Windows**, **macOS**, and **Linux**. See [Install-Instructions](Install-Instructions/) for step-by-step compiling guides per OS.

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

**Android build:** install Java 21, Android SDK 36, NDK `28.2.13676358`, Rust targets `aarch64-linux-android` and `x86_64-linux-android`, and `cargo-ndk`. Then run `npm ci` in `ui/desktop` and `ui/android`, followed by `npm run sync:web` in `ui/android` and `./gradlew assembleDebug` in `ui/android/android`.

**Publishing a release:** push a `v*` tag (e.g. `v2.5.0`) or run the [Build release](.github/workflows/build-release.yml) workflow manually. CI publishes signed Windows, macOS, and Linux packages (checksum signatures use `RELEASE_GPG_PRIVATE_KEY` and `RELEASE_GPG_PASSPHRASE`). The production Android APK is **signed locally** with a keystore that never enters the repository or CI, then uploaded to the same GitHub release — see [docs/ANDROID.md](docs/ANDROID.md). Secrets are never committed.

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
| Bind address | `DAEMON_BIND` | Default: `127.0.0.1:8733`. Plaintext non-loopback binding is refused. |
| Admin token | `DAEMON_ADMIN_TOKEN` | Required, including on loopback; minimum 32 characters. Desktop rotates a 48-character token on every daemon start. |
| Allowed Origin | `DAEMON_ALLOWED_ORIGIN` | Exact protected-route Origin. Desktop uses `orc://desktop`; opaque, missing, and wildcard origins are rejected. |
| Download directory | `ORC_DOWNLOAD_DIR` | Default: **Downloads/ORC Torrent** on Windows, macOS, and Linux. |

Every route except `GET /health` and `GET /version` requires both the exact configured Origin and `x-admin-token`, including reads and loopback requests. Browser preflights are limited to the exact Origin. Remote HTTP listening is disabled until a separate TLS/scoped-token listener is implemented.

**Manual check:** a protected request with `Origin: orc://desktop` but no token returns `401`; an unrelated web Origin returns `403` or fails CORS preflight.

### Search

- ORC Torrent ships without search providers. Add and enable your own provider in Search Settings before using search.
- Providers can use the open-content JSON format, standard RSS/Atom torrent feeds, or Torznab-compatible endpoints.
- **Torznab** providers (Jackett, Prowlarr, or compatible) can be added with securely stored API keys and optional local/private endpoint consent. See [docs/SEARCH_PROVIDERS.md](docs/SEARCH_PROVIDERS.md).
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

1. [Install](#installation) the app (portable archive or installer) from [GitHub Releases](https://github.com/The-animus-project/Orc-Torrent/releases).
2. Add torrents via drag-and-drop, file picker, or associated magnet links.
3. Use the torrent list and inspector for overview, files, peers, trackers, and transfers.
4. Configure VPN, kill switch, network posture, watch folders, seeding, and bandwidth in Settings.
5. Enable **Settings → Updates** to receive new releases from GitHub automatically.

---

## Development

We welcome contributions. The codebase is organized so the daemon, ORC Engine, and desktop/Android shells can be worked on independently.

- **ORC Engine**: Prefer changes behind `crates/orc-engine/` (plus `orc-mse` / `orc-scheduler` when needed). Do not add direct `librqbit` dependencies in `orc-core`, `orc-daemon`, or Android. See [docs/ORC_ENGINE.md](docs/ORC_ENGINE.md).
- **Rust**: From `crates/`, run `cargo build --release -p orc-daemon`; engine-focused tests with `cargo test -p orc-engine -p orc-mse -p orc-scheduler -p orc-core`.
- **Desktop**: From `ui/desktop/`, run `npm run dev` for development; `npm run build` then `npm run dist` for a full package.
- **Android**: The developer build and architecture are documented in [docs/ANDROID.md](docs/ANDROID.md); the user installation guide is [Install-Instructions/Android.md](Install-Instructions/Android.md).
- **CI**: The workflow in [.github/workflows/build-release.yml](.github/workflows/build-release.yml) runs on `workflow_dispatch` or tags `v*`, compiles Android (unsigned) and tests APIs 29/33/34/36, builds macOS, Linux, and Windows packages, PGP-signs desktop release assets, and publishes them on GitHub Releases. The signed Android APK is produced locally and attached to the release separately.

If you’re not sure where to start, check the [roadmap](#roadmap) and open issues—ORC Engine work is the current focus.

---

## Changelog

We keep a changelog of notable changes. **Last 5 updates:**

| Version | Highlights |
|---------|-------------|
| **2.5.1** | Emergency fix: daemon startup on legacy search provider configs no longer fails closed. |
| **2.5.0** | ORC Engine boundary, hardened localhost API, opt-in MSE/PE, BEP 6 Fast Extension, and adaptive request scheduling beta. |
| **2.4.0** | First Android 10+ build: signed APK, on-device Rust engine, mobile UI, SAF storage, background transfers, Wi-Fi-first policy, durable resume, and VPN-aware kill switch. |
| **2.3.4** | Torznab providers, protected API-key storage, search deduplication and UI polish, Intel macOS packages, and PGP signatures for every distributable. |
| **2.3.3** | Patch bump after v2.3.2 (next valid semver after the security release). |
| **2.3.2** | Dependabot security patches (npm + Rust openssl/webpki/serde_with/rand), Animus boot/splash polish, daemon-gated startup. |

Full history: **[CHANGELOG.md](CHANGELOG.md)**.

---

## Author

- **[Vurzumm](https://github.com/Animus-exe)** — [GitHub](https://github.com/Animus-exe) · [X @Itsvurzum](https://x.com/Itsvurzum)

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
