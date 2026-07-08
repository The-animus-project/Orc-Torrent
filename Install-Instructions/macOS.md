# Building ORC Torrent on macOS

This guide walks you through building ORC Torrent from source on **macOS** (Intel or Apple Silicon). You will get a `.app` bundle (and optionally a DMG if configured in electron-builder).

On **Windows**, the repository includes **`build.cmd`** / **`build.ps1`** at the root to run `npm run build` and optionally packaging; on **macOS** use the **`npm`** commands in `ui/desktop` below (same end result as a manual Windows build).

---

## Prerequisites

Install the following and ensure they are on your `PATH`:

| Tool | Version | Notes |
|------|---------|--------|
| **Rust** | Stable | Install via [rustup](https://rustup.rs/): `curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs \| sh` |
| **Node.js** | 20 or later | [Download](https://nodejs.org/) or use [nvm](https://github.com/nvm-sh/nvm). |
| **npm** | (bundled with Node) | Verify with `npm --version`. |

**Verify installations:**

```bash
rustc --version
cargo --version
node --version
npm --version
```

---

## Step 1: Clone the repository

If you have not already:

```bash
git clone https://github.com/The-animus-project/Orc-Torrent.git
cd Orc-Torrent
```

Use the actual repo URL. You should be at the **repository root** (where `README.md` and `crates/` are).

---

## Step 2: Build the daemon (optional if using `npm run build`)

You can build the daemon manually, or skip this and **Step 3** and go straight to **Step 4** — **`npm run build`** in `ui/desktop` runs `cargo build --release -p orc-daemon` from `crates/` and copies the binary into `ui/desktop/assets/bin/`.

Manual daemon build from the **repository root**:

```bash
cd crates
cargo build --release -p orc-daemon
cd ..
```

The binary is at **`crates/target/release/orc-daemon`** (host arch: Intel or Apple Silicon).

---

## Step 3: Copy the daemon (only if you built manually in Step 2)

Skip if you will use **`npm run build`** only.

```bash
mkdir -p ui/desktop/assets/bin
cp crates/target/release/orc-daemon ui/desktop/assets/bin/
```

On Apple Silicon, for a single-arch build, ensure the daemon arch matches the Electron target you package.

---

## Step 4: Build the desktop app

```bash
cd ui/desktop
npm install
npm run build    # daemon + Vite + TypeScript (no .app installer yet)
npm run dist     # electron-builder: .app / DMG as configured
```

- **`npm run build`** — Release-builds `orc-daemon`, copies it to `assets/bin/`, then Vite renderer and TypeScript (main + preload).
- **`npm run dist`** — Runs `build`, then full Electron packaging for macOS (e.g. `.app` under `dist/`; DMG if configured in `package.json`).

**Output:**

- Application: `ui/desktop/release/mac-arm64/ORC TORRENT.app`
- Installers and portable archives: `ui/desktop/release/ORC-TORRENT-<version>-mac-arm64.{dmg,zip,pkg}`

---

## Step 5: Run

- **From build directory:** `open "ui/desktop/release/mac-arm64/ORC TORRENT.app"`
- **First run:** You may need to allow the app in **System Settings → Privacy & Security** if macOS blocks it (unverified developer).

---

## Development (no packaging)

To run in development mode without building a distributable:

```bash
cd ui/desktop
npm install
npm run dev
```

This starts the daemon (if needed), Vite dev server, and Electron with hot-reload.

If this is your first run on a fresh checkout, the dev script now auto-builds the Rust daemon and copies it into `ui/desktop/assets/bin/` when missing.

---

## Notes

- **Cross-target daemon:** Set `ORC_DAEMON_CARGO_TARGET` or `CARGO_BUILD_TARGET` to a Rust triple when running `npm run build` / `npm run dist` so `cargo` uses `--target` and the script copies from `target/<triple>/release/`. Same variables apply to `npm run dev` when it auto-builds the daemon.
- **Rustls (optional):** For advanced cross-compiles you can build the daemon with `cargo build --release -p orc-daemon --no-default-features --features tls-rustls` from `crates/`, then copy `orc-daemon` into `ui/desktop/assets/bin/` (or set `ORC_USE_EXISTING_DAEMON=1` if the binary is already in place). Default builds use native TLS via `with-native-tls`.
- **Apple Silicon:** Build on an arm64 Mac for native performance; the daemon and Electron will both be arm64. To build for Intel on Apple Silicon (or vice versa), use `cargo build --release --target <triple>` and copy the binary for the desired arch; ensure Electron is also targeting that arch in electron-builder if you need a universal or cross-arch build.
- **Code signing / notarization:** For distribution outside your machine, you will need to configure code signing and notarization in electron-builder (see [Electron docs](https://www.electronjs.org/docs/latest/tutorial/code-signing)).
