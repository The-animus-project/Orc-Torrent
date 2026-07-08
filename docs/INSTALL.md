# Installation

See also the OS-specific guides in [Install-Instructions](../Install-Instructions/).

## Requirements

- **Rust** (stable)
- **Node.js** 20+ and **npm**
- **Windows**, **macOS**, or **Linux**

## Quick build (all platforms)

```bash
cd ui/desktop
npm install
npm run build
```

This compiles the Rust daemon (`orc-daemon`) and bundles the Electron desktop app.

## Packaging

```bash
cd ui/desktop
npm run dist
```

Platform-specific installers (DMG, AppImage, NSIS, etc.) are produced by `electron-builder`. See:

- [Install-Instructions/Windows.md](../Install-Instructions/Windows.md)
- [Install-Instructions/macOS.md](../Install-Instructions/macOS.md)
- [Install-Instructions/Linux.md](../Install-Instructions/Linux.md)

## Configuration after install

Daemon settings are stored in:

| OS | Path |
|----|------|
| macOS | `~/Library/Application Support/OrcTorrent/config.json` |
| Linux | `~/.config/OrcTorrent/config.json` |
| Windows | `%APPDATA%\OrcTorrent\config.json` |

See [CONFIGURATION.md](CONFIGURATION.md) for the full schema.
