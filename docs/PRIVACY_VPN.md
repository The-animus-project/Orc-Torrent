# Privacy and VPN Safety

Orc-Torrent is designed to make **network posture visible** and to reduce accidental clearnet leaks when using a VPN. It does **not** provide anonymity by itself.

## What is implemented

| Feature | Description |
|---------|-------------|
| VPN interface detection | Heuristic match on interface names (WireGuard, tun, Mullvad, NordLynx, etc.) |
| Kill switch | Honors its grace period, pauses configured torrent work, cancels engine sockets/discovery, and requires a VPN-interface socket rebuild before Armed |
| Leak protection flag | UI/policy signal when leak-proof mode is on |
| Bind interface | Recreates peer and discovery sockets on the selected device; strict mode blocks rather than using wildcard fallback |
| Privacy status dashboard | Consolidated risk state: Protected / Warning / Blocked / Unknown |
| VPN Safety Mode preset | One-click: enable kill switch, bind VPN interface if detected, enable leak protection |

## What is NOT implemented

- OS-wide outbound firewall blocking (`block_outbound` is reported unsupported)
- External public IP lookup (disabled by default; no hidden phone-home)
- Tor or I2P transport
- Legal or technical anonymity claims

## VPN transfer-pause behavior

This is an application-level ORC socket-confinement feature. It is not an operating-system firewall and is not described as an OS-wide kill switch.

When the kill switch is **engaged** after its grace period:

- Running torrents are paused
- Active peer/discovery tasks are cancelled and new engine network work is suspended
- `network_allowed` becomes false in effective policy
- Start/recheck/announce return HTTP 403 until VPN is detected again
- On reconnect, all sockets are recreated on the selected VPN interface before the kill switch returns to Armed; torrents paused by enforcement do not auto-resume

## Recommended setup

1. Connect your VPN before starting torrents.
2. Open the **Privacy status** card on the main screen.
3. Click **VPN Safety Mode** to enable kill switch and leak protection.
4. Confirm status shows **Protected** (or **Warning** with a clear reason if VPN is off).

## Honest expectations

Using a VPN with Orc-Torrent reduces the chance of accidental clearnet exposure when the kill switch works as intended. It does not hide your activity from your VPN provider, trackers, or peers you connect to.

For platform binding caveats, unsupported OS firewall blocking, and other gaps, see [KNOWN_LIMITATIONS.md](KNOWN_LIMITATIONS.md).

## VPN Safety Mode preset

`POST /net/privacy/preset/vpn-safety` applies the safest **existing** VPN-related settings in one step:

1. Enables the kill switch (if off)
2. Enables the pause-all-torrents trigger (if off)
3. Sets bind interface to the detected VPN interface (if VPN is detected)
4. Enables leak protection (if off)

The API returns a `changed` list describing each setting that was updated, plus the new `privacy_status`. Settings are persisted to `config.json` (kill switch + net posture). This does **not** claim anonymity — it configures defensive defaults only.
