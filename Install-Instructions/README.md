# Install instructions

**Pre-built releases:** Download portable archives or installers from [GitHub Releases](https://github.com/The-animus-project/Orc-Torrent/releases) — see the [Installation](../README.md#installation) section in the main README. No compilation required.

**Build from source:** Step-by-step guides below for each supported platform.

| Platform | Guide |
|----------|--------|
| **Windows** | [Windows.md](Windows.md) — one-command build (`build.cmd` / `build.ps1`), NSIS installer, portable zip |
| **macOS** | [macOS.md](macOS.md) — `.app` bundle, DMG (if configured) |
| **Linux** | [Linux.md](Linux.md) — AppImage, `.deb` |
| **Android 10+** | [Android.md](Android.md) — install and verify the signed `arm64-v8a` APK |

## Shared layout

The desktop app needs a **release build of `orc-daemon`** in `ui/desktop/assets/bin/`. The **`npm run build`** script (used by the Windows repo-root helpers and by manual `ui/desktop` workflows) compiles the daemon from `crates/`, copies it into `assets/bin/`, then builds the Electron renderer and main/preload.

**Installers and portable archives** (NSIS, zip, AppImage, `.deb`, etc.) are produced only when you run **`npm run dist`** from `ui/desktop` — or, on Windows, **`build.cmd -Dist`** / **`build.ps1 -Dist`** from the repository root.

See the main [README](../README.md) for a quick overview.
