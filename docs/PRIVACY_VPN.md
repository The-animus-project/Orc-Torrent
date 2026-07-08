# Privacy and VPN Safety

Orc-Torrent is designed to make **network posture visible** and to reduce accidental clearnet leaks when using a VPN. It does **not** provide anonymity by itself.

## What is implemented

| Feature | Description |
|---------|-------------|
| VPN interface detection | Heuristic match on interface names (WireGuard, tun, Mullvad, NordLynx, etc.) |
| Kill switch | When enabled, pauses torrents if VPN disconnects |
| Leak protection flag | UI/policy signal when leak-proof mode is on |
| Bind interface (advisory) | Records preferred interface; not fully enforced at socket level |
| Privacy status dashboard | Consolidated risk state: Protected / Warning / Blocked / Unknown |
| VPN Safety Mode preset | One-click: enable kill switch, bind VPN interface if detected, enable leak protection |

## What is NOT implemented

- Guaranteed socket binding to VPN interface (rqbit does not fully enforce this today)
- External public IP lookup (disabled by default; no hidden phone-home)
- Tor or I2P transport
- Legal or technical anonymity claims

## Kill switch behavior

When the kill switch is **engaged**:

- Running torrents are paused
- `network_allowed` becomes false in effective policy
- Start/recheck/announce return HTTP 403 until VPN is detected again

Some kill-switch trigger fields in config (`stop_seeding`, `disable_dht_pex_lpd`, `grace_period_sec`) are stored but not all are enforced in the engine yet.

## Recommended setup

1. Connect your VPN before starting torrents.
2. Open the **Privacy status** card on the main screen.
3. Click **VPN Safety Mode** to enable kill switch and leak protection.
4. Confirm status shows **Protected** (or **Warning** with a clear reason if VPN is off).

## Honest expectations

Using a VPN with Orc-Torrent reduces the chance of accidental clearnet exposure when the kill switch works as intended. It does not hide your activity from your VPN provider, trackers, or peers you connect to.

For bind-interface advisory behavior, partial kill-switch triggers, and other gaps, see [KNOWN_LIMITATIONS.md](KNOWN_LIMITATIONS.md).

## VPN Safety Mode preset

`POST /net/privacy/preset/vpn-safety` applies the safest **existing** VPN-related settings in one step:

1. Enables the kill switch (if off)
2. Enables the pause-all-torrents trigger (if off)
3. Sets bind interface to the detected VPN interface (if VPN is detected)
4. Enables leak protection (if off)

The API returns a `changed` list describing each setting that was updated, plus the new `privacy_status`. Settings are persisted to `config.json` (kill switch + net posture). This does **not** claim anonymity — it configures defensive defaults only.
