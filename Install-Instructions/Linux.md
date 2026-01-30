# Building ORC Torrent on Linux

This guide walks you through building ORC Torrent from source on **Linux** (x64). You can produce an AppImage, a .deb package, or run in development mode.

---

## Prerequisites

Install the following and ensure they are on your `PATH`:

| Tool | Version | Notes |
|------|---------|--------|
| **Rust** | Stable | Install via [rustup](https://rustup.rs/): `curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs \| sh` |
| **Node.js** | 20 or later | Use [NodeSource](https://github.com/nodesource/distributions) or [nvm](https://github.com/nvm-sh/nvm). |
| **npm** | (bundled with Node) | Verify with `npm --version`. |
| **Build essentials** | — | e.g. `build-essential` on Debian/Ubuntu for C toolchain used by some Rust crates. |

**Debian/Ubuntu example:**

```bash
sudo apt update
sudo apt install -y build-essential curl
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
# Install Node.js 20+ via NodeSource or nvm, then:
```

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

- `crates/target/release/orc-daemon`

---

## Step 3: Copy the daemon into the desktop app

The Electron app expects the daemon at `ui/desktop/assets/bin/`. From the **repository root**:

```bash
mkdir -p ui/desktop/assets/bin
cp crates/target/release/orc-daemon ui/desktop/assets/bin/
```

---

## Step 4: Build the desktop app

```bash
cd ui/desktop
npm install
npm run build
npm run dist
```

- **`npm run build`** — Builds the daemon (if the script runs it), Vite renderer, and TypeScript (main + preload).
- **`npm run dist`** — Full Electron build for Linux. With the default `package.json` you get:
  - **AppImage:** `ui/desktop/dist/ORC TORRENT-x.x.x-x86_64.AppImage` (or similar)
  - **.deb:** `ui/desktop/dist/orc-torrent_x.x.x_amd64.deb` (or similar, depending on product name)

**Output location:** `ui/desktop/dist/`. Exact filenames depend on `package.json` and electron-builder version.

---

## Step 5: Run

- **AppImage:** Make it executable and run:
  ```bash
  chmod +x "ui/desktop/dist/ORC TORRENT-"*".AppImage"
  ./ui/desktop/dist/ORC\ TORRENT-*.AppImage
  ```
- **.deb:** Install with your package manager, then run the application from your app menu:
  ```bash
  sudo dpkg -i ui/desktop/dist/*.deb
  ```

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

- **Desktop integration:** After installation, ORC Torrent should appear in your application menu and support magnet and `.torrent` file associations if configured in electron-builder.
- **Dependencies:** If the Electron app fails to start, you may need extra libraries (e.g. for graphics or audio). See [Electron Linux requirements](https://www.electronjs.org/docs/latest/tutorial/support#linux) for common packages (e.g. `libgtk-3-0`, `libnotify`, etc.).
- **Other distros:** The same steps apply on Fedora, Arch, etc.; install Rust, Node.js 20+, and a C/build toolchain appropriate for your distribution.
