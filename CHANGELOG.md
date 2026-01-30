# Changelog

All notable changes to ORC Torrent are documented here. The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

---

## [2.2.14] — 2026-01-30

### Added

- **Install instructions** — OS-specific build guides for Windows, macOS, and Linux in `Install-Instructions/` (prerequisites, daemon build, desktop build, packaging).
- **Cross-platform compatibility** — README and docs now state compatibility with Windows, macOS, and Linux; links to per-OS compiling guides.

### Changed

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

[2.2.14]: https://github.com/The-animus-project/Orc-Torrent/compare/v2.2.13...v2.2.14
[2.2.13]: https://github.com/The-animus-project/Orc-Torrent/compare/v2.2.12...v2.2.13
[2.2.12]: https://github.com/The-animus-project/Orc-Torrent/compare/v2.2.11...v2.2.12
[2.2.11]: https://github.com/The-animus-project/Orc-Torrent/compare/v2.2.10...v2.2.11
[2.2.10]: https://github.com/The-animus-project/Orc-Torrent/releases/tag/v2.2.10
