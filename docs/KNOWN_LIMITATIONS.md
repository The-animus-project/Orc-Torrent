# Known Limitations

## Network and privacy

- **Bind interface enforcement** — ORC Engine binds TCP, uTP, DHT, UDP trackers, HTTP trackers (where the platform client supports device binding), and LSD to the selected device. Strict mode refuses missing address families or partial socket startup instead of falling back to wildcard sockets. Cross-platform firewall-level verification remains part of the release matrix.
- **VPN transfer-pause scope** — The grace period, pause-all, stop-seeding, discovery shutdown, socket cancellation, and interface rebind are engine-enforced. This is application-level confinement, not a deterministic OS kill switch. `block_outbound` remains explicitly unsupported because ORC does not install platform firewall rules.
- **Runtime indicators** — TCP/uTP, IPv4/IPv6, DHT/PEX/LSD, binding, and suspension come from live engine state. A failed optional DHT/LSD/uTP startup is reported as degraded rather than silently shown as enabled.
- **Peer traffic obfuscation** — MSE/PE is beta and disabled until explicit consent. `prefer` may fall back to plaintext TCP and leaves uTP plaintext; `require` disables uTP and can substantially reduce swarm reachability. RC4 MSE is compatibility obfuscation, not modern secure encryption.
- **No public IP lookup** — External IP is not fetched unless explicitly added in a future optional feature.
- **No anonymity claims** — VPN + kill switch reduce accidental clearnet leaks; they do not make you anonymous.

## Features

- **Policy persistence** — Full `DesiredPolicy` is saved to `config.json` and restored on startup. Kill switch and net posture are also stored separately and kept in sync with policy fields.
- **Watch folders** — Debounced import; very large or slow copies may need extra delay before import.
- **Windows paths** — Watch folder canonicalization should be validated on Windows installs.
- **Per-torrent seeding** — API supported; UI override in torrent inspector is minimal.
- **Torznab search** — Native Torznab/Jackett/Prowlarr endpoints are supported; unrestricted Python/qBittorrent search plugins are not. DNS-rebinding mitigation relies on URL validation plus redirect host pinning (not a full pre-connect DNS pin). Some indexers that omit `t=caps` will fail the connection test even if search works.

## Packaging

- Code signing is disabled by default in CI (`CSC_IDENTITY_AUTO_DISCOVERY=false`).

## License metadata

Rust workspace `Cargo.toml` uses **AGPL-3.0**, matching the root `LICENSE`. The rqbit v9.0.0-beta.2-derived private backend remains Apache-2.0; see `crates/orc-engine/NOTICE.md`.
