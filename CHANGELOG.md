# Changelog

All notable changes to ORC Torrent are documented here. The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

---

## [Unreleased]

### Changed

- **Android release signing** — Production APKs are signed locally; CI compiles an unsigned release APK and runs emulator tests without storing the Android keystore in repository secrets.
- **CodeQL Java/Kotlin** — Switch from default buildless scanning to an advanced workflow that traces a Gradle debug compile so Kotlin sources and dependencies resolve above CodeQL quality thresholds.

---

## [2.5.1] — 2026-08-04

### Fixed

- **Emergency: daemon startup on legacy search configs** — Migrate removed built-in search providers before config validation so older `config.json` files (e.g. `yts` without `feed_url`) no longer fail closed with "daemon did not become healthy".

---

## [2.5.0] — 2026-08-04

### Added

- **ORC-owned engine boundary** — Introduce `orc-engine` as the shared desktop/Android contract for torrent lifecycle, storage, persistence, network policy, capabilities, privacy status, peer snapshots, suspension, and reconfiguration. The private backend is derived from tagged rqbit `v9.0.0-beta.2` with its Apache-2.0 lineage documented.
- **Modern swarm beta** — Add explicit legacy and modern networking modes covering TCP, uTP, IPv4/IPv6, DHT, PEX, and LSD. Beta `auto` remains mapped to legacy until the cross-platform promotion gate passes.
- **Peer traffic obfuscation** — Add the independent `orc-mse` implementation of inbound and outbound BitTorrent MSE/PE over TCP and SOCKS-carried TCP, with `off`, explicit-consent `prefer`, and downgrade-resistant `require` modes. The UI and API describe this as RC4 peer-traffic obfuscation, not anonymity or modern encryption.
- **Adaptive request scheduler** — Add the independent `orc-scheduler` boundary with per-peer RTT, goodput, choke/reject rates, timeout history, availability, outstanding-byte tracking, bandwidth-delay-product pipelines, stalled-block reassignment, and deterministic legacy/adaptive benchmark profiles. Adaptive scheduling remains opt-in.
- **BEP 6 Fast Extension** — Support `suggest piece`, `have all`, `have none`, `reject request`, and `allowed fast`, including suggestion priority, choked-peer allowed-fast requests, immediate rejection recovery, and upload cancellation.
- **Bounded endgame recovery** — Duplicate at most two copies of a block during adaptive endgame and cancel losing requests as soon as useful data arrives.
- **Engine capabilities API** — Add `GET /engine/capabilities` and additive runtime-backed transport, discovery, binding, suspension, MSE, scheduler, and live peer-protection status.

### Changed

- **Private backend isolation** — Route ORC Core, daemon, desktop, and Android integrations through ORC-owned engine and storage types while preserving torrent UUIDs, REST routes, catalog data, Android SAF storage, and the existing `state/rqbit` directory.
- **Truthful privacy policy** — Compute effective behavior from runtime capabilities, enforce private-torrent discovery restrictions, report unsupported OS-wide outbound blocking honestly, and distinguish requested settings from active sockets and negotiated peer protection.
- **VPN enforcement lifecycle** — Move network suspension to the engine, close active peer/discovery work after the configured grace period, recreate sockets on the selected interface, and preserve manual-pause/no-auto-resume behavior.
- **Desktop engine controls** — Add modern swarm and MSE/PE controls, runtime warnings, negotiated plaintext/RC4 peer counts, and transport/discovery indicators driven by engine state.

### Security

- **Localhost API origin isolation** — Require a strong admin token and exact configured Origin on every protected route, including loopback reads; keep only health and version public; reject missing, opaque, wildcard, and unrelated web origins.
- **Desktop authority isolation** — Rotate a 48-character daemon token on startup and keep it in the Electron main process, proxying renderer requests without exposing authority to web content.
- **Fail-closed configuration** — Validate configuration before networking starts, restore only validated last-known-good generations, atomically replace and sync configuration files, and return persistence failures instead of silently accepting volatile privacy changes.
- **Electron navigation and IPC boundary** — Block unexpected navigation and redirects, validate the calling window/main frame for privileged IPC, narrow daemon proxy operations, and apply a packaged-renderer Content Security Policy.
- **Search-provider SSRF and memory limits** — Resolve and validate every IPv4/IPv6 answer, reject mixed public/private sets, pin approved addresses for each redirect hop, reject oversized `Content-Length`, stream response bodies to a hard limit, and disable response compression.
- **Download path confinement** — Default desktop downloads to the dedicated `Downloads/ORC Torrent` root and reject unsafe parent/symlink escapes before handing storage paths to the engine.
- **Strict network binding** — Refuse wildcard fallback when strict interface binding cannot resolve or create all requested TCP, uTP, DHT, tracker, and LSD sockets.
- **MSE hardening** — Bound public keys, padding, synchronization scans, initial payloads, total buffered data, and negotiation time; validate DH public values; use constant-time comparisons and zeroized secrets.
- **XML parser advisories** — Upgrade all search-provider and UPnP XML parsing to `quick-xml` 0.41.0, resolving `RUSTSEC-2026-0194` and `RUSTSEC-2026-0195` before release.

### Fixed

- **Incoming feature negotiation** — Inspect the remote peer's handshake for extension support instead of ORC's own outbound handshake.
- **Rejected and stalled blocks** — Release ownership immediately, cancel obsolete requests, and make the block available to another peer without waiting for connection failure.
- **Fast-extension uploads** — Return `reject request` for unavailable or invalid blocks when supported and honor peer cancellation before queued disk reads.
- **Legacy persistence compatibility** — Validate and restore v8.1.1 session and fast-resume fixtures in place without renaming or destructively migrating user state.

### Tests

- Add deterministic scheduler, endgame, BEP 6 message, MSE transcript/fragmentation, policy compatibility, and engine capability coverage.
- Keep backend TCP/uTP and MSE transfer coverage across IPv4 and IPv6, plus v8 persistence restoration and the desktop/Android release matrix.

### Credit

- **Vurzumm**

---

## [2.4.0] — 2026-08-03

### Added

- **Android 10+ application** — Ship a standalone, signed `arm64-v8a` APK with the shared Rust torrent engine running on-device through JNI and the React interface packaged with Capacitor.
- **Phone-first interface** — Add onboarding, bottom navigation, torrent cards, an Add sheet, torrent overview and file-priority views, Privacy and Settings screens, safe-area handling, Android back navigation, and system light/dark theme support.
- **Android import and file actions** — Accept magnet links and `.torrent` document intents, provide native file and folder pickers, and open or share completed files through Android content URIs.
- **Persistent shared storage** — Use Android's Storage Access Framework with a persisted user-selected ORC folder, positional descriptor I/O, path-traversal protection, and recovery when a grant or removable volume becomes unavailable.
- **Background transfers** — Use user-initiated data-transfer jobs on Android 14+ and a `dataSync` foreground service on Android 10–13, with aggregate progress, Pause All and Open notification actions, and persisted retry state.
- **Android release automation** — Build and test API 29, 33, 34, and 36 emulator targets, produce the production APK, sign it with the Android release keystore, and publish PGP signatures and a signed checksum manifest with the cross-platform release.

### Changed

- **Reusable daemon runtime** — Refactor `orc-daemon` into a library plus desktop binary with explicit runtime directories, authentication policy, network provider, storage factory, graceful shutdown handle, and preserved desktop environment-variable behavior.
- **Authenticated mobile API** — Bind the Android daemon to a random loopback port, require a per-install admin token on every route except health/version, restrict CORS to the Capacitor origin, and bootstrap the URL and token through the native bridge.
- **Durable queue restoration** — Persist torrent identity, metadata, file priorities, pause state, seeding progress, catalog data, and rqbit fast-resume state so process and device restarts do not redownload completed pieces.
- **Transfer defaults** — Default Android transfers and ratio-1.0 seeding to unmetered Wi-Fi; cellular use, VPN kill switch, seed ratio, and seed time limits remain explicit user settings.
- **Platform bridge** — Introduce shared Electron and Capacitor implementations for bootstrap, storage selection, torrent picking, file actions, lifecycle events, transfer policy, and deep links.
- **Removal API** — Extend `POST /torrents/:id/remove` with optional `{ "delete_data": true }`; an omitted body continues to forget the torrent while keeping downloaded files.
- **Build dependencies** — Update `electron-builder` to 26.15.3 and `quinn-proto` to 0.11.16 before producing the cross-platform packages.

### Security

- **Native Android signing** — Release APKs are signed with the repository's protected Android keystore, while distributables and release checksums receive detached PGP signatures in CI.
- **Patched HTTP tooling** — Resolve the current Axios advisories in the desktop build toolchain by locking Axios 1.19.0; `npm audit` reports no known vulnerabilities.
- **Scoped storage** — Request no broad storage permission; reject traversal, read-only destinations, non-seekable providers, revoked grants, and insufficient-capacity destinations before transfer I/O.
- **VPN-aware kill switch** — Detect Android VPN transport through `ConnectivityManager`, bind the process before creating Rust sockets, pause real rqbit transfers immediately on VPN loss, prevent fallback to a clear network, and require manual resume after reconnection.
- **Network policy** — Block metered/cellular transfers by default and reschedule active Android work when the user changes the policy.

### Fixed

- **Reliable shutdown and restoration** — Persist the catalog and fast-resume state during lifecycle stops and operating-system interruptions, then restore pause state and priorities on the next host start.
- **Storage deletion errors** — Surface failed SAF deletion and revoked-storage errors instead of reporting a successful remove.
- **Loopback startup races** — Reserve the selected random port through server startup and handle authenticated CORS preflight requests without exposing the daemon to the LAN.
- **VPN reconnection** — Rebind to the newly available VPN network and recreate transfer sockets only when the user explicitly resumes.
- **Android ABI packaging** — Let Gradle's APK split configuration own the arm64 and x86_64 filters, avoiding a conflicting duplicate NDK filter during release and emulator builds.
- **Capacitor 8 Kotlin compatibility** — Use Capacitor's current `PluginMethod` package, pass `Exception` causes to plugin rejections, and provide long-valued UIDT network estimates.
- **Android instrumentation identity** — Assert the production `com.orc.torrent` application ID instead of Capacitor's generated template package in emulator tests.
- **Android test dependency alignment** — Keep Capacitor and Cordova instrumentation APKs on Kotlin 2.2.20, preventing duplicate standard-library classes from older transitive dependencies.
- **Android API 36 emulator stability** — Enable KVM acceleration in CI so current Android images remain responsive to ADB during connected tests.

### Tests

- Add Rust coverage for Android storage-path validation and keep the expanded core and daemon regression suites running against the reusable runtime.
- Add React coverage for runtime API configuration and authenticated requests used by the Capacitor bridge.
- Add Kotlin unit coverage for SAF path policy and Wi-Fi/cellular/VPN transfer-policy decisions, plus the API 29, 33, 34, and 36 emulator CI matrix.

### Credit

- **Vurzum**

---

## [2.3.4] — 2026-08-02

### Added

- **Torznab search providers** — Add Jackett, Prowlarr, and compatible Torznab endpoints with capability discovery, connection testing, category selection, and explicit consent for private or local endpoints.
- **Protected search credentials** — Store provider API keys outside `config.json` using the operating-system keyring, with an encrypted AES-GCM file fallback protected by restrictive file permissions.
- **Search result deduplication** — Merge duplicate results across providers while retaining the strongest metadata and source attribution.
- **Intel macOS builds** — Publish x86_64 DMG, ZIP, and PKG artifacts alongside Apple Silicon builds.
- **Cross-client benchmarks** — Add reproducible download-speed methodology, randomized run data, and documented comparisons with other torrent clients.

### Changed

- **Search experience** — Expand the toolbar, provider settings, result presentation, Animus styling, and API types for multi-provider movie and TV searches.
- **Search documentation** — Document provider setup, credential handling, endpoint safety rules, plugin architecture, configuration, limitations, and test coverage.
- **Release verification** — Publish detached PGP signatures for every distributable plus a signed `SHA256SUMS` manifest.
- **Release automation** — Add a dedicated GitHub Actions Intel macOS job using the supported `macos-15-intel` runner.

### Fixed

- **Provider parsing and deduplication** — Harden movie and TV provider parsing, normalize result identity, and prevent repeated entries from overlapping sources.
- **macOS network reporting** — Improve platform route and DNS handling used by the network-status UI.

### Tests

- Add Torznab settings tests, daemon credential-store coverage, provider parsing tests, deduplication coverage, and endpoint validation scenarios.

### Credit

- **Vurzum**

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

[Unreleased]: https://github.com/The-animus-project/Orc-Torrent/compare/v2.5.1...HEAD
[2.5.1]: https://github.com/The-animus-project/Orc-Torrent/compare/v2.5.0...v2.5.1
[2.5.0]: https://github.com/The-animus-project/Orc-Torrent/compare/v2.4.0...v2.5.0
[2.4.0]: https://github.com/The-animus-project/Orc-Torrent/compare/v2.3.4...v2.4.0
[2.3.4]: https://github.com/The-animus-project/Orc-Torrent/compare/v2.3.3...v2.3.4
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
