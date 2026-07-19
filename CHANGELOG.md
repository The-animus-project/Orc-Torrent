# Changelog

All notable changes to ORC Torrent are documented here. The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

---

## [Unreleased]

---

## [2.3.3] — 2026-07-20

### Changed

- **Version** — Bump to 2.3.3 (next patch after 2.3.2). Four-part versions such as `2.3.2.1` are not valid for npm, Cargo, or GitHub auto-update, so this release uses the next semver patch.

---

## [2.3.2] — 2026-07-20

### Security

- **npm dependency patches (`ui/desktop`)** — Clear open Dependabot findings by bumping/overriding `vite` (≥7.3.5), `@xmldom/xmldom` (0.8.13), `form-data`, `tmp`, `tar`, `postcss`, `ip-address`, `js-yaml` (4.3.0), `@babel/core` (7.29.7), `esbuild` (≥0.28.1), and related transitive packages; `npm audit` reports 0 vulnerabilities.
- **npm dependency patches (`librqbit-patched/webui`)** — Bump `vite` (≥8.0.16), `postcss`, `@vitejs/plugin-react` (5.x for Vite 8), and overrides for `@babel/core`, `js-yaml`, `esbuild`, and `launch-editor`.
- **Rust dependency patches** — Update `openssl` to 0.10.81, `rustls-webpki` to 0.103.13, `serde_with` to 3.21.0, and `rand` to 0.8.7 / 0.9.5 in both `crates/Cargo.lock` and `crates/librqbit-patched/Cargo.lock`.

### Changed

- **Animus boot / splash** — Boot screen waits for a healthy daemon before completing, with a gated finish animation; splash and graffiti theme polish; anarchy toast icon wiring across notification surfaces.
- **Startup sequencing** — Main process waits for daemon health before revealing the window so the boot gate and splash stay in sync.

### Added

- **Asset helper** — `ui/desktop/scripts/processAnimusAssets.py` to strip solid backgrounds from Animus overlay PNGs.

---

## [2.3.1] — 2026-07-08

### Security

- **Splash screen XSS / open redirect** — Sanitize `splashLogo`, `splashEmblem`, and `splashBackground` query params to bundled relative paths only; replace `innerHTML` image injection with safe DOM APIs (`splash.html`).
- **Build script command injection** — Replace shell-string `execSync` with argument-array `spawnSync` for Windows npm and `.cmd` tooling (`scripts/dist.ts`).
- **Dependency** — Bump transitive `shell-quote` from 1.8.3 to 1.9.0 (`ui/desktop`).

### Fixed

- **Linux CI / `.deb` packaging** — Set `author` email and `linux.maintainer` in `package.json` so electron-builder can produce `.deb` packages on Ubuntu runners.
- **Windows CI packaging** — Use `spawnSync` with `shell: true` for `.cmd` shims on Windows (avoids `EINVAL` without rebuilding shell command strings).

---

## [2.3.0] — 2026-07-08

### Added

**Daemon / API**

- **Watch folders** — Auto-import `.torrent` files with debounce, duplicate info-hash detection, delete/archive after import, and recent import log (`GET/PATCH /watch-folders`, `POST /watch-folders/test`, `GET /watch-folders/events`).
- **Privacy status dashboard** — `GET /net/privacy-status` with Protected / Warning / Blocked / Unknown risk states and plain-English reasons.
- **VPN Safety Mode preset** — One-click `POST /net/privacy/preset/vpn-safety` enables kill switch, leak protection, and VPN bind interface when detected; returns what changed and the updated status.
- **Network introspection** — `GET /net/adapters`, `GET /net/route`, `GET /net/dns`, `POST /net/vpn-status/refresh`, and `GET /tor/status` for the Network page.
- **Policy persistence** — Full `DesiredPolicy` saved to `config.json` on `PATCH /v1/policy` and restored at daemon startup.
- **Socket-level bind interface** — When `net_posture.bind_interface` resolves to an IPv4 address, rqbit binds incoming TCP, outbound IPv4 peers, DHT UDP, and UDP tracker announces to that address.
- **Hot-rebind on posture change** — `PATCH /net/posture` and VPN Safety Mode recreate the rqbit session when `bind_interface` changes, re-attaching torrents by info hash without a daemon restart.
- **Seeding limits** — `GET/PATCH /seeding` for global ratio and seed-time limits; completed torrents auto-stop when targets are met.
- **Bandwidth scheduling** — Normal and limited speed profiles with quiet-hours schedule (`PATCH /bandwidth/schedule`, `GET/POST /torrents/limits`).
- **Expanded config persistence** — `config.json` now round-trips kill switch, net posture, policy, search, watch folders, seeding, and bandwidth settings at startup.
- **Watch-folder path validation** — Rejects empty paths and `..` traversal in daemon config.

**Desktop UI**

- **Privacy status card** — Dashboard card with VPN Safety Mode action and honest anonymity disclaimer.
- **Network page** — Adapter table, default route, DNS, VPN signal details, kill-switch enforcement state, and refresh/re-check actions.
- **Seeding settings** — Settings → Seeding for ratio and seed-time limits.
- **Bandwidth settings** — Settings → Bandwidth for normal/limited caps and schedule window.
- **Watch folder settings** — Settings → Watch with folder browse, test access, delete/archive options, and recent imports log.
- **Compliant torrent search** — Search page and Settings → Search with Internet Archive, open-content JSON, and user-defined RSS/Atom/JSON custom feeds (no piracy indexers).
- **GitHub auto-update** — `electron-updater` with Settings → Updates: auto-check toggle, manual check, download progress, and restart-to-install; daemon shuts down gracefully before install.
- **Folder browse dialog** — `showSaveFolderDialog` IPC for watch-folder paths and add-torrent save path.
- **Kawaii Pink notification theme** — Fourth animated banner and toast theme with pastel pink styling, shimmer sweep, and heart ring; selectable in Notification settings.
- **Notification registries** — Shared banner/toast theme registry (`notificationVisualThemeRegistry.ts`) and bundled sound registry (`notificationSoundRegistry.ts`) as the single source of truth for Settings, IPC, and playback.
- **Adaptive polling** — Tiered refresh intervals (focused / blurred / background) based on window focus, visibility, and minimize state.
- **Torrent table virtualization** — `@tanstack/react-virtual` for large torrent lists.
- **Renderer hooks** — `usePrivacyStatus`, `useTorrentData`, `useDaemonHealth`, and `usePollingController` extract polling and VPN/kill-switch logic from `App.tsx`.

**Build / CI / docs**

- **Documentation** — [`docs/CODEBASE_OVERVIEW.md`](docs/CODEBASE_OVERVIEW.md), [`docs/PRIVACY_VPN.md`](docs/PRIVACY_VPN.md), [`docs/KNOWN_LIMITATIONS.md`](docs/KNOWN_LIMITATIONS.md), [`docs/CONFIGURATION.md`](docs/CONFIGURATION.md), expanded [`docs/TESTING_CHECKLIST.md`](docs/TESTING_CHECKLIST.md), [`ui/desktop/README.md`](ui/desktop/README.md).
- **Prettier** — `.prettierrc` and `npm run format` for TypeScript/TSX sources.
- **Package size audit** — `npm run audit:size` (`scripts/audit-size.ts`).
- **CI auto-update metadata** — `build-release.yml` uploads `latest*.yml` and `*.blockmap` for electron-updater.

### Changed

- **Roadmap** — Honest phases: Stabilization (current) → Daily driver (next) → Ecosystem (future).
- **Trust copy** — README, privacy settings, leak-proof UI, and Security settings no longer claim anonymity or "CONFIRMED SAFE" protection; anonymous/overlay routing labeled as not implemented.
- **Leak-proof indicator** — Shows **Configured** / **Not configured** instead of "CONFIRMED SAFE".
- **Network posture center** — Shows Configured / Leak risk / Unconfigured and embeds the privacy status card.
- **Status bar DHT/PEX/LSD** — Driven by `privacy-status` API instead of hardcoded values.
- **Watch folder UI** — Browse buttons for folder paths; removed stale "future update" placeholder.
- **Kill switch triggers** — Toggle changes auto-save immediately via `PATCH /net/kill-switch` using the real daemon schema (`pause_all_torrents`, `stop_seeding`, `disable_dht_pex_lpd`, `block_outbound`).
- **Kill switch / leak-proof sync** — `leak_proof_enabled` (`/net/posture`) and `kill_switch.enabled` (`/net/kill-switch`) stay in sync and persist to `config.json`.
- **Privacy kill switch drawer** — Fetches fresh config when opened; trigger toggles auto-save instead of being overwritten by polling.
- **Faster startup** — Splash minimum display time set to 0 ms (dismiss when daemon and renderer are ready).
- **Polling intervals** — Adaptive tiers reduce background CPU and network use; offline daemon ping no longer polls at 500 ms.
- **Dependency updates** — lru, vite, axios, openssl, postcss, and `@xmldom/xmldom` bumped since v2.2.17.

### Fixed

- **Network page empty adapters** — Daemon now implements the endpoints the Network page calls; adapters, route, and DNS populate correctly.
- **Kill switch split state** — Enabling kill switch in one UI surface no longer leaves the other disarmed.
- **Kill switch triggers not saved** — Trigger panel now uses the daemon schema and persists correctly.
- **Torrent stopped event** — `useTorrentEvents` now emits `torrent_stopped` instead of `torrent_started` when a torrent stops.
- **Kill switch auto-resume** — Uses `POST /torrents/:id/start` instead of an incorrect GET.
- **DHT session initialization** — Falls back to a non-persistent or DHT-disabled rqbit session when persistent DHT socket init fails.
- **Network adapter VPN flag** — VPN detection on adapters uses interface name heuristics consistently.

### Security

- **Watch-folder path hardening** — Folder paths validated against `..` traversal before save and import.
- **Config file permissions** — Documented `0600` on Unix for `config.json` in [`docs/CONFIGURATION.md`](docs/CONFIGURATION.md).

### Tests

- Config persistence round-trip (watch folders, net posture, policy, kill switch)
- Watch-folder path validation (empty paths, `..`, delete/archive mutual exclusion)
- Duplicate info-hash detection and privacy risk-state calculation
- VPN Safety Mode preset idempotency and bind-interface behavior
- Seeding limit triggers (ratio, seed-time, zero-download edge case)
- Bandwidth schedule validation and network route parsing
- Search provider tests (magnet parsing, provider-specific parsers)
- Expanded `cargo test` coverage across `orc-core` and `orc-daemon`

### Removed

- Stale watch-folder "coming in a future update" placeholder copy.
- Misleading auto-update placeholder in Settings (replaced by functional Update settings).
- Redundant inline VPN/kill-switch polling blocks from `App.tsx` (moved to hooks).

---

## [2.2.17] — 2026-04-04

### Security

- **Dependency patches** — npm and Rust dependency updates addressing reported vulnerabilities.
- **CodeQL** — Resolved security alerts in build scripts.

---

## [2.2.16] — 2026-04-04

### Added

- **Animated notification themes** — Three animated banner and toast themes (Flames, Electric, Matrix) with a selector in Notification settings and a "Test popup theme" preview button.
- **Desktop notification test** — "Send test desktop notification" button in Notification settings to verify sound and popup together.
- **Upgrade uninstall flow** — NSIS installer now detects and uninstalls any existing ORC Torrent installation before proceeding, with multiple fallback strategies and detailed installer progress logging. Continues with overwrite if uninstall fails.

### Fixed

- **Notification tone playback** — Changing the notification sound now works correctly. Audio is fetched as raw bytes via IPC and played as Blob URLs, with fallback to direct URL and a built-in oscillator tone.
- **Theme dropdown visibility** — Popup theme selector no longer disappears when changing notification sounds; theme controls are sticky at the top of the scrollable area.
- **Notifications settings scrollability** — Notifications card scrolls vertically when content exceeds the visible area instead of clipping controls.
- **Installed application icon** — Build and installer pipelines strictly enforce `icons/orc-torrent.ico` as the app icon for the executable, desktop shortcut, and `.torrent`/`magnet` file associations, preventing fallback to the default Electron icon.

### Changed

- **Notification sound IPC** — New `notification-sound:get-audio` IPC channel returns raw audio bytes for robust cross-protocol playback.
- **App identity** — `app.setAppUserModelId("com.orc.torrent")` set for consistent Windows taskbar grouping and notification icons.
- **`app://` protocol** — Registered as privileged with stream and fetch API support for reliable media loading.
- **Accessibility** — Animated notification themes respect `prefers-reduced-motion` media query.
- **Icon resolution** — `getIconPath()` in main process now checks six fallback locations in both dev and packaged modes to ensure the ORC icon is always found.

---

## [2.2.15] — 2026-04-04

### Security

- **XSS hardening** — Fallback error handler in `index.html` now escapes the error message before inserting into the DOM. Null check added when updating the root element.
- **Electron** — `setWindowOpenHandler` added on main and splash windows to block `window.open()` from the renderer.
- **IPC validation** — `daemon:read-logs` now clamps and validates the `lines` parameter (integer, 1–10000) to prevent abuse.
- **Firewall IPC** — Implemented missing `firewall:check`, `firewall:check-managed`, `firewall:add-rule`, `firewall:add-rules-batch`, and `firewall:remove-rule` handlers with validated options (port range, protocol, profile, batch size limit).
- **Add-torrent save_path** — Daemon now canonicalizes and restricts `save_path` to the download directory or user home to prevent path traversal.

### Added

- **CI audits** — `npm audit --audit-level=high` and `cargo audit` steps in the build-release workflow (reports only; `continue-on-error` can be removed once findings are addressed).

### Fixed

- **Log watcher** — Daemon log tail now reads by offset (only new bytes) instead of the full file, with a 2 MB cap per read to avoid OOM on large logs.
- **Toast dismiss race** — Safety-net timer in `App.tsx` extended from 3.2 s to 5 s so the `Toast` component's closing animation always completes before the fallback fires.
- **Custom sound preview** — Choosing a custom notification sound file now immediately plays it back so the user hears the selection before leaving Settings.

### Changed

- **Torrent table** — Comment added suggesting virtualization (e.g. react-window) for very large lists.
- **Polling consolidation** — `TorrentRowSignal` merged two high-frequency polls (150 ms heartbeat + 800 ms pieces) into a single 2 s interval, dramatically reducing per-row network requests.
- **Memoised sorting** — `TorrentTable` sort logic wrapped in `useMemo` so the torrent list is only re-sorted when data or sort criteria actually change.
- **Stable callbacks** — Inline arrow functions passed to `AppShell` and `NavigationRail` in `App.tsx` converted to `useCallback` to avoid unnecessary re-renders of memoised children.
- **VPN kill-switch effect** — `App.tsx` uses `useRef` for `torrents` and `torrentStatuses` inside the kill-switch `useEffect`, preventing it from re-running on every 2 s poll cycle.
- **ETA calculation** — `useEmaEta` refactored from multiple `useEffect`/`setInterval` hooks to a single synchronous `useMemo`, eliminating redundant timers.
- **Banner theming** — "Connecting to daemon…" banner and its button switched from inline `style` to CSS classes (`.banner.info`, `.btn.ghost`) for consistent theming.
- **Toast theming** — `.toast.error` and `.toast.info` now have distinct `border-left` accents and differentiated `.toastTitle` opacity for clearer visual distinction.

### Removed

- **Dead code** — Unused `filteredTorrents` `useMemo` computation, its `useDebounce` import, and the never-imported `previewNotificationSoundUrl` export removed.

---

## [2.2.14] — 2026-01-30

### Added

- **Install instructions** — OS-specific build guides for Windows, macOS, and Linux in `Install-Instructions/` (prerequisites, daemon build, desktop build, packaging).
- **Cross-platform compatibility** — README and docs now state compatibility with Windows, macOS, and Linux; links to per-OS compiling guides.

### Fixed

- **Notification sound preview** — Sound sampling in Settings now plays the selected sound instead of always playing the built-in tone. Preview uses IPC-fetched audio bytes (main process reads the file and returns raw bytes to the renderer) so playback works regardless of protocol loading. List UI: each sound has a Play button to sample and a Use button to set it as active.

### Changed

- **Notification sound settings UI** — Replaced dropdown with a card-based list: Built-in tone, bundled sounds, and Custom sound (when set) each appear as a row with Play and Use. Shorter copy, clearer toggles (“When a download finishes”, “When kill switch activates or releases”), and “Custom file…” in the card header. Selected sound is highlighted and shown with an “In use” badge.
- **Settings page** — Clearer header with “Settings” title and short intro line; “Jump to” in-page links (Network & VPN, Security, Notifications, Daemon) for quick navigation; optional one-line description under each section card; single h1 per page and one h2 per section for accessibility; Daemon section uses “Status & control” label instead of duplicate heading; Security profile callouts and tips use CSS classes (success/warning/info) for consistent theming; Daemon status row visually separated from action buttons.
- Documentation and README structure updated for clarity and professional tone.

---

## [2.2.13] — 2026-01

### Changed

- **License** — Project licensed under the GNU Affero General Public License v3.0 (AGPL-3.0). Full `LICENSE` file added with project copyright (ORC Torrent / The ANIMUS PROJECT, authors Vurzum, BuGmaN).

---

## [2.2.12] — 2026-01

### Added

- **Custom notification sounds** — Multiple built-in notification sounds for download-complete and kill-switch events; users can choose from several bundled sounds or use a custom file. Settings UI for enabling/disabling notifications and selecting sound.
- **Roadmap** — Public roadmap in README (Stabilization → Ecosystem); stated as actively updated.

### Changed

- README reworked for clarity, professional tone, and active-development messaging.

---

## [2.2.11] — 2025-12

### Changed

- **Daemon security** — Request validation, torrent ID format checks, body size and concurrency limits, sanitized error responses (no paths/tokens), constant-time admin token check, and security headers (X-Content-Type-Options, X-Frame-Options, etc.).
- Content-Type enforcement for POST/PATCH with JSON bodies.

---

## [2.2.10] — 2025-12

### Added

- **Multi-platform support** — Explicit support and build targets for Windows (NSIS + zip), Linux (AppImage, .deb), and macOS (.app, protocols and file associations).
- **Authors and contributors** — README and metadata credit ORC Torrent, The ANIMUS PROJECT, Vurzum, and BuGmaN.

### Changed

- Codebase overview and documentation updates; table of contents and structure improvements in README.

---

[2.3.3]: https://github.com/The-animus-project/Orc-Torrent/compare/v2.3.2...v2.3.3
[2.3.2]: https://github.com/The-animus-project/Orc-Torrent/compare/v2.3.1...v2.3.2
[2.3.1]: https://github.com/The-animus-project/Orc-Torrent/compare/v2.3.0...v2.3.1
[2.3.0]: https://github.com/The-animus-project/Orc-Torrent/compare/v2.2.17...v2.3.0
[2.2.17]: https://github.com/The-animus-project/Orc-Torrent/compare/v2.2.16...v2.2.17
[2.2.16]: https://github.com/The-animus-project/Orc-Torrent/compare/v2.2.15...v2.2.16
[2.2.15]: https://github.com/The-animus-project/Orc-Torrent/compare/v2.2.14...v2.2.15
[2.2.14]: https://github.com/The-animus-project/Orc-Torrent/compare/v2.2.13...v2.2.14
[2.2.13]: https://github.com/The-animus-project/Orc-Torrent/compare/v2.2.12...v2.2.13
[2.2.12]: https://github.com/The-animus-project/Orc-Torrent/compare/v2.2.11...v2.2.12
[2.2.11]: https://github.com/The-animus-project/Orc-Torrent/compare/v2.2.10...v2.2.11
[2.2.10]: https://github.com/The-animus-project/Orc-Torrent/releases/tag/v2.2.10
