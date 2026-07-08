# Known Limitations

## Network and privacy

- **Bind interface enforcement** — When a bind interface with an IPv4 address is configured, incoming TCP listener, outbound IPv4 peer connections, DHT UDP, and UDP tracker announces use that address. Changing bind interface via `PATCH /net/posture` or VPN Safety Mode triggers a **hot-rebind** that recreates the rqbit session and re-attaches torrents without a full daemon restart.
- **Kill switch triggers** — Only `pause_all_torrents` is reliably enforced; `grace_period_sec`, `stop_seeding`, and `disable_dht_pex_lpd` are partially schema-only.
- **DHT/PEX/LSD indicators** — Privacy dashboard derives PEX/LSD from policy; DHT uses session stats when available.
- **No public IP lookup** — External IP is not fetched unless explicitly added in a future optional feature.
- **No anonymity claims** — VPN + kill switch reduce accidental clearnet leaks; they do not make you anonymous.

## Features

- **Policy persistence** — Full `DesiredPolicy` is saved to `config.json` and restored on startup. Kill switch and net posture are also stored separately and kept in sync with policy fields.
- **Watch folders** — Debounced import; very large or slow copies may need extra delay before import.
- **Windows paths** — Watch folder canonicalization should be validated on Windows installs.
- **Per-torrent seeding** — API supported; UI override in torrent inspector is minimal.

## Packaging

- Code signing is disabled by default in CI (`CSC_IDENTITY_AUTO_DISCOVERY=false`).

## License metadata

Rust workspace `Cargo.toml` uses **AGPL-3.0**, matching the root `LICENSE`. Vendored `librqbit-patched` remains Apache-2.0.
