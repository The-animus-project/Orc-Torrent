# Changelog

All notable changes to ORC Torrent are documented here. The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

---

## [Unreleased]

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

[2.2.16]: https://github.com/The-animus-project/Orc-Torrent/compare/v2.2.15...v2.2.16
[2.2.15]: https://github.com/The-animus-project/Orc-Torrent/compare/v2.2.14...v2.2.15
[2.2.14]: https://github.com/The-animus-project/Orc-Torrent/compare/v2.2.13...v2.2.14
[2.2.13]: https://github.com/The-animus-project/Orc-Torrent/compare/v2.2.12...v2.2.13
[2.2.12]: https://github.com/The-animus-project/Orc-Torrent/compare/v2.2.11...v2.2.12
[2.2.11]: https://github.com/The-animus-project/Orc-Torrent/compare/v2.2.10...v2.2.11
[2.2.10]: https://github.com/The-animus-project/Orc-Torrent/releases/tag/v2.2.10
