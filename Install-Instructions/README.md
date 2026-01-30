# Install instructions

Step-by-step guides to build and run ORC Torrent from source on each supported platform.

| Platform | Guide |
|----------|--------|
| **Windows** | [Windows.md](Windows.md) — NSIS installer, portable zip |
| **macOS** | [macOS.md](macOS.md) — .app bundle, DMG (if configured) |
| **Linux** | [Linux.md](Linux.md) — AppImage, .deb |

All platforms share the same layout: build the Rust daemon, place it in the desktop app’s `assets/bin/`, then build the Electron app. Each guide lists prerequisites and OS-specific commands.

See the main [README](../README.md) for a quick overview.
