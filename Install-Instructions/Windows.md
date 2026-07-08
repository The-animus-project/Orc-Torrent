# Building ORC Torrent on Windows

This guide walks you through building ORC Torrent from source on **Windows** (64-bit). You can use a **single script from the repository root** or follow the **manual `npm` steps** in `ui/desktop`.

---

## Prerequisites

Install the following and ensure they are on your `PATH`:

| Tool | Version | Notes |
|------|---------|--------|
| **Rust** | Stable | Install via [rustup](https://rustup.rs/). After install, restart your terminal. |
| **Node.js** | 20 or later | [Download](https://nodejs.org/). LTS is fine. |
| **npm** | (bundled with Node) | Verify with `npm --version`. |

**Verify installations:**

```powershell
rustc --version
cargo --version
node --version
npm --version
```

---

## Quick build from the repository root (recommended)

Open a terminal at the **repository root** (where `README.md`, `crates/`, `build.cmd`, and `build.ps1` live).

| Goal | Command |
|------|---------|
| **Compile only** (daemon + UI bundles, no installer) | `build.cmd` or `powershell -NoProfile -ExecutionPolicy Bypass -File .\build.ps1` |
| **Compile + installer + portable zip** | `build.cmd -Dist` or `powershell -NoProfile -ExecutionPolicy Bypass -File .\build.ps1 -Dist` |

- **`build.cmd`** — Use this from **Command Prompt** or double-click scenarios. It invokes PowerShell for you.
- **`build.ps1`** — Run from **PowerShell** as `.\build.ps1` (with optional `-Dist`, `-Install`, `-SkipInstall`).  
  **Do not** run `.\build.ps1` from **cmd.exe**; Windows may open the file in **Notepad** instead of executing it. From cmd, use **`build.cmd`** instead.

**Flags (PowerShell script only; pass the same args through `build.cmd`):**

| Flag | Meaning |
|------|--------|
| `-Dist` | After `npm run build`, run **`npm run dist`** (electron-builder: NSIS + zip). |
| `-Install` | Always run **`npm install`** in `ui/desktop` first. |
| `-SkipInstall` | Never run `npm install` (fails if `node_modules` is missing). |

If `node_modules` is missing, the script runs **`npm install`** once unless you passed `-SkipInstall`.

---

## What gets built and where

After **`npm run build`** (or a build without `-Dist`):

| Output | Location |
|--------|----------|
| Daemon | `ui\desktop\assets\bin\orc-daemon.exe` (copied from `crates\target\release\`) |
| Electron bundles | `ui\desktop\dist\main\`, `dist\preload\`, `dist\renderer\` |

There is **no** standalone “ORC TORRENT.exe” in `dist\` until you package. **`dist\`** holds compiled JS/HTML/CSS plus, **after `npm run dist`**, the **installer and zip** next to those folders.

After **`npm run dist`** (or **`build.cmd -Dist`**), typical artifacts under **`ui\desktop\release\`** include:

- **NSIS installer:** `ORC-TORRENT-Setup-<version>.exe`
- **Portable zip:** `ORC-TORRENT-<version>-win-x64.zip`
- **Unpacked app (for testing):** `release\win-unpacked\` → run **`ORC TORRENT.exe`** inside that folder.

Exact filenames depend on **`version`** in `ui\desktop\package.json` and your electron-builder version.

---

## Manual build (same as other platforms)

From the **repository root**:

```powershell
cd ui\desktop
npm install
npm run build
```

- **`npm run build`** — `cargo build --release -p orc-daemon` (from `crates\`), copies `orc-daemon.exe` to `assets\bin\`, then Vite + TypeScript for Electron.

To create the **installer and zip**:

```powershell
npm run dist
```

(`dist` runs `build` first, then electron-builder.)

---

## Optional: build only the Rust daemon by hand

Useful for debugging the daemon without the full desktop pipeline:

```powershell
cd crates
cargo build --release -p orc-daemon
cd ..
copy crates\target\release\orc-daemon.exe ui\desktop\assets\bin\
```

Then from `ui\desktop` you can run **`npm run build:electron`** if you only need to rebuild the UI (no Rust). Normally **`npm run build`** is enough.

---

## Run the app

- **Installer:** Run **`ORC TORRENT Setup … .exe`**, then start **ORC TORRENT** from the Start menu or desktop shortcut.
- **Portable zip:** Extract the zip, then run **`ORC TORRENT.exe`** from the unpacked folder (or use **`win-unpacked\ORC TORRENT.exe`** after a local `dist` build).
- **Development (no installer):**

  ```powershell
  cd ui\desktop
  npm install
  npm run dev
  ```

  This starts the Vite dev server, Electron, and the usual dev lifecycle.

---

## Troubleshooting

- **Running `.\build.ps1` from cmd opens Notepad** — Use **`build.cmd`** from Command Prompt, or run **`powershell -ExecutionPolicy Bypass -File .\build.ps1`** with your flags.
- **“Rust/Cargo is not installed”** — Install Rust from [rustup.rs](https://rustup.rs/), restart the terminal, then run `cargo --version`.
- **“Rust binary not found” / daemon missing** — Run **`npm run build`** from `ui\desktop`, or **`npm run build:daemon`** from `ui\desktop` to rebuild only the daemon and copy it.
- **“Cannot delete app.asar” / file locks** — Close ORC TORRENT and any Explorer windows on `dist\win-unpacked`. See **`ui\desktop\scripts\`** (`fix-locks.ps1`, `find-locker.ps1`, `kill-cursor-locks.ps1`) if electron-builder reports locks.
- **Symlink errors** — electron-builder may need symlink support. Enable **Developer Mode** in Windows Settings (**Privacy & security → For developers**) or see electron-builder / winCodeSign cache notes.

For more detail, see [ui/desktop/README.md](../ui/desktop/README.md) if present.
