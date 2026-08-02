# Search plugin architecture (future)

This document describes the intended multi-phase direction for Orc Torrent’s search-plugin ecosystem. **Only Phase 1 is implemented today.**

## Phase roadmap

### Phase 1 — Native Torznab providers (implemented)

- User-configured Torznab endpoints (Jackett, Prowlarr, compatible services)
- Secure API-key storage
- Concurrent, isolated provider execution
- Normalised `SearchResult` records and manual add only
- No arbitrary script execution

### Phase 2 — Orc JSON Lines external-provider protocol

A versioned, permission-controlled protocol for external provider helpers:

- Versioned manifests
- JSON Lines messaging over stdio or a local IPC channel
- Explicit permissions (network allow-lists, timeouts, output limits)
- No inherited environment secrets
- No default filesystem access
- No default subprocess access
- Protocol version negotiation
- Crash quarantine for misbehaving helpers

### Phase 3 — Signed provider packages

- Publisher signatures
- Hash verification of package contents
- Install only after signature + permission review
- Revocation / quarantine support

### Phase 4 — WASM sandbox runtime

- Optional WASM providers for portable logic
- Capability-based host imports (network/fetch only where permitted)
- Memory / CPU / output limits
- Still no unrestricted native code execution

### Phase 5 — Optional qBittorrent compatibility bridge

- A **bridge**, not a primary plugin standard
- May translate a constrained subset of qBittorrent search plugin behaviour into the Orc protocol
- Must not become “run arbitrary Python inside the daemon”

## Non-goals

Unrestricted Python scripts must **not** become Orc’s primary plugin standard. Any compatibility layer must remain outside the daemon’s trusted computing base or run under the same permission model as Phase 2+.

## Contract principles

Future Orc provider packages should declare:

| Concern | Requirement |
|---------|-------------|
| Identity | Name, version, publisher |
| Permissions | Explicit network hosts / schemes |
| Limits | Timeouts, max response bytes, max results |
| Secrets | Injected by reference; never inherited blindly |
| Filesystem | Denied by default |
| Subprocess | Denied by default |
| Integrity | Signature + content hash |
| Failure | Crash quarantine and clear user-visible errors |

## Relationship to Phase 1

Phase 1 Torznab support is the foundation: the UI, settings model, secret store, concurrent registry, sanitisation, and manual-add workflow should be reused by later phases rather than replaced.
