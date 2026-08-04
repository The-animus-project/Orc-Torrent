# ORC Engine

`orc-engine` is the public transfer boundary shared by desktop and Android. Application code must not depend on `librqbit` directly. The private backend is currently derived from tagged rqbit v9.0.0-beta.2 and lives behind the facade so lifecycle, policy, storage, snapshots, persistence, and networking can evolve without changing ORC's public APIs.

## Compatibility contract

- External torrent UUIDs, REST routes, the ORC torrent catalog, and the existing `{ORC_STATE_DIR}/rqbit` persistence directory remain unchanged.
- The v9 backend reads the v8.1.1 JSON session shape and fast-resume sidecars in place. ORC does not rename or destructively migrate that state in this milestone.
- Android SAF reaches backend storage only through `orc-engine`; `orc-core`, `orc-daemon`, and Android have no direct `librqbit` dependency.
- Upstream attribution and patch lineage are recorded in [`crates/orc-engine/NOTICE.md`](../crates/orc-engine/NOTICE.md).

## Network modes

| Mode | TCP | uTP | IPv4 | IPv6 | DHT | PEX | LSD |
|---|---:|---:|---:|---:|---:|---:|---:|
| Legacy | on | off | on | off | on | on | off |
| Modern Standard | on | on | on | on | on | on | on |
| Hardened profile | on | on | on | on | off | off | off |

During the beta, `auto` resolves to Legacy. Explicit Legacy remains Legacy when `auto` is later promoted. Automatic port mapping is disabled for Hardened and throughout this beta.

Private torrents always suppress DHT, PEX, LSD, metadata exchange, and session-wide trackers. They use only their torrent-declared tracker set.

## Runtime truth

`GET /engine/capabilities` reports API/backend lineage, live TCP/uTP and IP-family state, discovery state, persistence, suspension, unsupported security features, and degraded reasons. `/net/privacy-status` exposes the same runtime transport/discovery posture additively while retaining its compatibility fields.

ORC owns an additive MSE/PE implementation in `orc-mse`. It ships off until `peer_encryption_opt_in` records explicit consent and is described only as peer traffic obfuscation. `prefer` attempts RC4 MSE on TCP, permits one fresh-socket plaintext fallback, and leaves uTP plaintext. `require` accepts only RC4 MSE, disables uTP in effective policy, closes the prior session before activation returns, and never downgrades. Live RC4/plaintext peer counts and negotiation diagnostics are memory-only runtime data.

MSE/PE does not protect trackers, DHT, PEX, LSD, or uTP, and it is not anonymity, authenticated encryption, or modern confidentiality.

`block_outbound` is not an OS firewall. Capabilities report it unsupported until a real platform firewall integration exists.

## Verification

The backend test matrix includes offline multi-peer downloads over TCP and uTP on both IPv4 and IPv6. Keep it small locally with:

```bash
cd crates
E2E_NUM_SERVERS=2 E2E_NUM_FILES=2 E2E_FILE_LENGTH=524288 \
  cargo test -p librqbit tests::e2e::test_e2e_download -- --test-threads=1
```

ORC Engine tests also validate and restore a v8.1.1 session fixture in place with forced-paused recovery. The platform release matrix (Linux IPv4/IPv6 leak checks plus Windows, macOS, Linux, and Android packaged smoke tests) remains a release gate rather than a single-host developer test.
