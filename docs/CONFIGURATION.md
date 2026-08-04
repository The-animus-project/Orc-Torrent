# Configuration

## Config file location

| OS | Path |
|----|------|
| macOS | `~/Library/Application Support/OrcTorrent/config.json` |
| Linux | `~/.config/OrcTorrent/config.json` |
| Windows | `%APPDATA%\OrcTorrent\config.json` |

File permissions on Unix: `0600`.

## Environment variables

| Variable | Default | Description |
|----------|---------|-------------|
| `DAEMON_BIND` | `127.0.0.1:8733` | Loopback API bind address; non-loopback plaintext binds are refused |
| `DAEMON_ADMIN_TOKEN` | none | Required on every start, including loopback; minimum 32 characters |
| `DAEMON_ALLOWED_ORIGIN` | `orc://desktop` | Exact protected-route Origin allowlist |
| `ORC_DOWNLOAD_DIR` | `~/Downloads/ORC Torrent` | Dedicated default torrent output root |

Only `GET /health` and `GET /version` are public. Every other API operation requires the exact Origin and the `x-admin-token` header. The desktop and Android applications proxy these operations in a native process so JavaScript does not receive the token.

Configuration writes are validated, serialized, flushed, synced and atomically replaced. Three `config.json.bak.N` generations are retained; startup restores a valid last-known-good generation or fails before torrent networking starts.

## `config.json` schema (summary)

```json
{
  "listen_port": 49000,
  "kill_switch": { "enabled": false, "...": "..." },
  "search": {
    "enabled": false,
    "default_provider": null,
    "default_result_limit": 25,
    "allow_private_remote_urls": false,
    "providers": [
      {
        "name": "local_jackett",
        "enabled": false,
        "label": "Local Jackett",
        "feed_url": "http://127.0.0.1:9117/api/v2.0/indexers/all/results/torznab/",
        "format": "torznab",
        "categories": ["2000", "5000"],
        "credential_ref": "search-provider:local_jackett",
        "allow_private_url": true,
        "timeout_seconds": 10
      }
    ]
  },
  "watch_folders": {
    "enabled": false,
    "folders": [{
      "id": "uuid",
      "enabled": true,
      "folder_path": "/path/to/watch",
      "default_save_path": null,
      "auto_start": true,
      "delete_after_import": false,
      "archive_folder": null
    }]
  },
  "seeding": {
    "ratio_limit_enabled": false,
    "ratio_limit": 2.0,
    "seed_time_limit_enabled": false,
    "seed_time_minutes": 0,
    "action": "stop_torrent"
  },
  "bandwidth": {
    "normal_download_bps": null,
    "normal_upload_bps": null,
    "limited_download_bps": null,
    "limited_upload_bps": null,
    "schedule_enabled": false,
    "schedule_start": "22:00",
    "schedule_end": "07:00",
    "schedule_days": [0,1,2,3,4,5,6]
  },
  "net_posture": {
    "bind_interface": null,
    "leak_proof_enabled": false
  },
  "policy": {
    "anonymous_mode": false,
    "peer_encryption": "prefer",
    "peer_encryption_opt_in": false,
    "dht_hardening": true,
    "enforce_private_torrents": false,
    "ip_blocklist": false,
    "kill_switch": false,
    "bind_interface_only": false,
    "overlay_padding": "off",
    "sybil_resistance": false,
    "relay_pow_required": false,
    "relay_subnet_diversity": false,
    "relay_reputation_weighting": false,
    "ipv6_enabled": true,
    "upnp_natpmp_enabled": true,
    "circuit_rotation_enabled": false,
    "deny_direct_exits": false,
    "minimize_fingerprinting": false,
    "profile": "standard"
  }
}
```

No search providers are bundled. The example `local_jackett` entry is user-supplied; a new installation starts with an empty `providers` array.

`policy` stores the full `DesiredPolicy` and is updated by `PATCH /v1/policy`. Kill switch and net posture fields are also stored separately and kept in sync.

## REST API (automation-related)

| Method | Route | Purpose |
|--------|-------|---------|
| GET/PATCH | `/v1/policy` | Security policy (persisted to config) |
| GET | `/engine/capabilities` | Live ORC Engine features, lineage, persistence, and degradation state |
| GET/PATCH | `/watch-folders` | Watch folder settings |
| POST | `/watch-folders/test` | Test folder access |
| GET | `/watch-folders/events` | Recent import events |
| GET/PATCH | `/seeding` | Global seeding limits |
| GET/PATCH | `/torrents/:id/seeding` | Per-torrent seeding override |
| GET/POST | `/torrents/limits` | Session rate limits + active profile |
| PATCH | `/bandwidth/schedule` | Bandwidth schedule settings |
| GET | `/net/privacy-status` | Consolidated privacy dashboard |
| POST | `/net/privacy/preset/vpn-safety` | Apply VPN Safety Mode preset |
| GET/PATCH | `/search/settings` | Search feature settings (no API keys) |
| GET | `/search/providers` | Provider list + non-sensitive status |
| POST | `/search` | Federated search |
| PUT/DELETE | `/search/providers/:name/credentials` | Store/clear Torznab API key |
| POST | `/search/providers/:name/test` | Torznab capabilities test |
| DELETE | `/search/providers/:name` | Remove custom provider + secret |

Torznab API keys are stored in the OS keyring when available, otherwise in an encrypted file under the config directory (`search-secrets.bin`). They are never written into `config.json`. See [SEARCH_PROVIDERS.md](SEARCH_PROVIDERS.md).

Torrent session data remains under `{ORC_STATE_DIR}/rqbit` in the existing rqbit-compatible format. The engine beta reads it in place and performs no destructive migration.
