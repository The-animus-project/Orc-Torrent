# Manual Testing Checklist

Use this checklist before a release or after changing daemon/UI integration.

## Core torrent operations

- [ ] Add magnet link
- [ ] Add `.torrent` file (dialog)
- [ ] Start / stop / remove torrent
- [ ] Recheck torrent
- [ ] Force announce (tracker)
- [ ] File priority change in inspector
- [ ] Restart app — torrent list resumes from rqbit session

## Watch folders

- [ ] Enable watch folder in Settings → Watch
- [ ] Add valid folder path; Test access succeeds
- [ ] Drop valid `.torrent` into folder — imports automatically
- [ ] Drop duplicate `.torrent` — no duplicate torrent in library
- [ ] Drop invalid file — error in recent imports log
- [ ] Toggle delete-after-import or archive folder
- [ ] Restart daemon — settings persist

## Seeding limits

- [ ] Enable ratio limit globally; complete a small torrent; verify stop when ratio reached
- [ ] Enable seed-time limit; verify stop after configured hours
- [ ] Confirm downloading torrent is NOT stopped by limits
- [ ] Settings persist after restart

## Bandwidth schedule

- [ ] Set normal upload/download caps; verify apply
- [ ] Set limited caps + schedule window; verify **Limited** profile during window
- [ ] Verify **Normal** profile outside window
- [ ] Settings persist after restart

## Torznab search providers

- [ ] Add Torznab provider (`local_jackett` or similar) with endpoint + API key
- [ ] Enable local/private endpoint for loopback Jackett/Prowlarr
- [ ] Save — API key field shows saved state and is not re-populated
- [ ] Test connection — capabilities succeed
- [ ] Search All Providers / single Torznab provider for a lawful open-source item
- [ ] Confirm duplicates merge and provider latency/errors are shown
- [ ] Confirm Add is required before a torrent starts
- [ ] Disable provider — excluded from All Providers
- [ ] Remove provider — credential deleted
- [ ] Automated: `cd crates && cargo test -p orc-daemon`
- [ ] Automated: `cd ui/desktop && npm test`

## Privacy / VPN (v2.3)

- [ ] Privacy card disclaimer visible (no anonymity claims)
- [ ] Leak-proof indicator shows "Configured" not "CONFIRMED SAFE"
- [ ] Anonymous profile/mode copy says overlay routing is not implemented
- [ ] Hot-rebind: change bind interface in Settings → Network without restarting app; torrents remain listed
- [ ] Privacy card shows correct state with VPN on/off
- [ ] Kill switch engages when VPN drops (if enabled)
- [ ] VPN Safety Mode preset lists changes applied
- [ ] Status bar DHT/PEX/LSD reflect privacy-status (not hardcoded)
- [ ] Kill switch visible on dashboard without digging into settings

## Watch folders (Windows)

- [ ] Watch folder path `C:\Users\...\Downloads` imports correctly
- [ ] Test access succeeds for Windows paths with backslashes

## Persistence

- [ ] Change seeding, bandwidth, watch folder, net posture settings
- [ ] Restart daemon (or full app)
- [ ] Confirm all settings restored

## Build quality

```bash
cd crates && cargo fmt --all -- --check && cargo clippy --workspace --all-targets -- -D warnings && cargo test --workspace
cd ui/desktop && npm ci && npm run lint:types && npm test && npm run build
```

## Platform notes

| Platform | Notes |
|----------|-------|
| Windows | Test watch folder with `C:\Users\...` paths; NSIS installer |
| macOS | Test `~/Downloads` watch path; DMG packaging |
| Linux | Test AppImage; fuse for AppImage in CI |
