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
| `DAEMON_BIND` | `127.0.0.1:8733` | HTTP API bind address |
| `DAEMON_ADMIN_TOKEN` | (empty) | Required for non-loopback; header `x-admin-token` |
| `ORC_DOWNLOAD_DIR` | `~/Downloads` | Default torrent output directory |

## `config.json` schema (summary)

```json
{
  "listen_port": 49000,
  "kill_switch": { "enabled": false, "...": "..." },
  "search": { "...": "..." },
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

`policy` stores the full `DesiredPolicy` and is updated by `PATCH /v1/policy`. Kill switch and net posture fields are also stored separately and kept in sync.

## REST API (automation-related)

| Method | Route | Purpose |
|--------|-------|---------|
| GET/PATCH | `/v1/policy` | Security policy (persisted to config) |
| GET/PATCH | `/watch-folders` | Watch folder settings |
| POST | `/watch-folders/test` | Test folder access |
| GET | `/watch-folders/events` | Recent import events |
| GET/PATCH | `/seeding` | Global seeding limits |
| GET/PATCH | `/torrents/:id/seeding` | Per-torrent seeding override |
| GET/POST | `/torrents/limits` | Session rate limits + active profile |
| PATCH | `/bandwidth/schedule` | Bandwidth schedule settings |
| GET | `/net/privacy-status` | Consolidated privacy dashboard |
| POST | `/net/privacy/preset/vpn-safety` | Apply VPN Safety Mode preset |

Torrent session data is stored separately at `{ORC_DOWNLOAD_DIR}/session.json` by the rqbit engine.
