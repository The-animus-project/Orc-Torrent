# Development Guide

## Repository layout

- `crates/orc-daemon` — Axum HTTP API server
- `crates/orc-core` — shared state, VPN, policy, automation logic
- `crates/orc-engine` — public ORC transfer-engine boundary
- `crates/librqbit-v9-patched` and `crates/rqbit-v9` — private rqbit v9.0.0-beta.2-derived backend
- `ui/desktop` — Electron + React UI

See [CODEBASE_OVERVIEW.md](CODEBASE_OVERVIEW.md) for architecture details.

## Local development

### Daemon only

```bash
cd crates
cargo run -p orc-daemon
```

Environment variables:

- `DAEMON_BIND` — default `127.0.0.1:8733`
- `ORC_DOWNLOAD_DIR` — torrent download root
- `DAEMON_ADMIN_TOKEN` — required for non-loopback binds

### Full desktop dev

```bash
cd ui/desktop
npm install
npm run dev
```

### Tests

```bash
cd crates
cargo test -p orc-engine -p orc-core -p orc-daemon
# Android uses the mutually exclusive rustls/SHA feature set; check separately.
cargo check -p orc-android --no-default-features
cargo fmt --check
```

### TypeScript check

```bash
cd ui/desktop
npm run lint:types
```

## Adding API endpoints

1. Add types and logic in `orc-core` when shared with the daemon loop.
2. Add route + handler in `orc-daemon/src/main.rs`.
3. Add client helper under `ui/desktop/src/renderer/utils/`.
4. Document the route in [CONFIGURATION.md](CONFIGURATION.md) or this overview.

## Coding conventions

- Persist user settings in `config.json` via `orc-daemon/src/config.rs`.
- Validate paths before filesystem access; reject `..` traversal.
- Keep the daemon bound to loopback by default; do not weaken auth for remote access.
