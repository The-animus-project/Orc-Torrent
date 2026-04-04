# Building ORC Torrent on macOS

This guide walks you through building ORC Torrent from source on **macOS** (Intel or Apple Silicon). You will get a `.app` bundle (and optionally a DMG if configured in electron-builder).

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

## Step 2: Build the daemon

From the repository root:

```bash
cd crates
cargo build --release -p orc-daemon
cd ..
```

The daemon binary is produced at:

- **Intel:** `crates/target/release/orc-daemon`
- **Apple Silicon (arm64):** `crates/target/release/orc-daemon` (Rust builds for the host arch by default)

---

## Step 3: Copy the daemon into the desktop app

The Electron app expects the daemon at `ui/desktop/assets/bin/`. From the **repository root**:

```bash
mkdir -p ui/desktop/assets/bin
cp crates/target/release/orc-daemon ui/desktop/assets/bin/
```

On Apple Silicon you may need a universal binary or a separate build for the architecture you target with Electron; for a single-arch build, the above is sufficient if the daemon and Electron target match.

---

## Step 4: Build the desktop app

```bash
cd ui/desktop
npm install
npm run build
npm run dist
```

- **`npm run build`** — Builds the daemon (if the script runs it), Vite renderer, and TypeScript (main + preload).
- **`npm run dist`** — Full Electron build for macOS (e.g. `.app` in `dist/`; DMG if configured in `package.json`).

**Output:**

- Application: `ui/desktop/dist/mac/ORC TORRENT.app` (or similar path per electron-builder config)
- DMG: if enabled, in `ui/desktop/dist/`.

---

## Step 5: Run

- **From build directory:** `open "ui/desktop/dist/mac/ORC TORRENT.app"` (path may vary; check `dist/`).
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

---

## Notes

- **Apple Silicon:** Build on an arm64 Mac for native performance; the daemon and Electron will both be arm64. To build for Intel on Apple Silicon (or vice versa), use `cargo build --release --target <triple>` and copy the binary for the desired arch; ensure Electron is also targeting that arch in electron-builder if you need a universal or cross-arch build.
- **Code signing / notarization:** For distribution outside your machine, you will need to configure code signing and notarization in electron-builder (see [Electron docs](https://www.electronjs.org/docs/latest/tutorial/code-signing)).
