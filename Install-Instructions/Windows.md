# Building ORC Torrent on Windows

This guide walks you through building ORC Torrent from source on **Windows** (64-bit). You will get the NSIS installer and/or a portable zip.

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

## Step 1: Clone the repository

If you have not already:

```powershell
git clone https://github.com/The-animus-project/Orc-Torrent.git
cd Orc-Torrent
```

Use the actual repo URL. You should be at the **repository root** (where `README.md` and `crates/` are).

---

## Step 2: Build the daemon

From the repository root:

```powershell
cd crates
cargo build --release -p orc-daemon
cd ..
```

The daemon binary is produced at:

- `crates\target\release\orc-daemon.exe`

---

## Step 3: Copy the daemon into the desktop app

The Electron app expects the daemon at `ui\desktop\assets\bin\`. From the **repository root**:

```powershell
copy crates\target\release\orc-daemon.exe ui\desktop\assets\bin\
```

Create `ui\desktop\assets\bin\` if it does not exist.

---

## Step 4: Build the desktop app

```powershell
cd ui\desktop
npm install
npm run build
npm run dist
```

- **`npm run build`** — Builds the daemon (if the script runs it), Vite renderer, and TypeScript (main + preload).
- **`npm run dist`** — Full Electron build: Windows NSIS installer and portable zip (x64).

**Output:**

- Installer: `ui\desktop\dist\ORC TORRENT Setup 2.x.x.exe`
- Portable: `ui\desktop\dist\ORC TORRENT x.x.x-win-x64.zip` (or similar, depending on `package.json`)

---

## Step 5: Run

- **Installer:** Run the `.exe` and follow the installer. Launch **ORC TORRENT** from the Start Menu or desktop shortcut.
- **Portable:** Unzip the zip, then run `ORC TORRENT.exe` from the unpacked folder.

---

## Development (no installer)

To run in development mode without building an installer:

```powershell
cd ui\desktop
npm install
npm run dev
```

This starts the daemon (if needed), Vite dev server, and Electron with hot-reload.

---

## Troubleshooting

- **“Rust/Cargo is not installed”** — Install Rust from [rustup.rs](https://rustup.rs/), restart the terminal, then run `cargo --version`.
- **“Rust binary not found”** — Ensure Step 2 completed and `crates\target\release\orc-daemon.exe` exists. Run `npm run build:daemon` from `ui\desktop` to rebuild the daemon.
- **“Cannot delete app.asar” / file lock** — Another process (e.g. a running ORC TORRENT, antivirus, Explorer) may be locking `dist\win-unpacked`. Close the app and any scans of that folder, or use the cleanup script under `ui\desktop\scripts\` if available.
- **Symlink errors** — electron-builder may need symlink support. Enable **Developer Mode** in Windows Settings (Privacy & Security → For developers) or run the build in an elevated terminal and clear the electron-builder cache if needed.

For more Windows-specific tips, see [ui/desktop/README.md](../ui/desktop/README.md).
