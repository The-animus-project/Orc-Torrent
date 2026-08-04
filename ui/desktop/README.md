# ORC Torrent Desktop App

Electron + React desktop client for the ORC Torrent daemon.

Official website: [Orclabs.io](https://orclabs.io)

The official website is shown on both loading experiences, in the General settings tab, and at the bottom of each desktop GUI shell. Website actions open the system browser through the validated `window.orc.openExternalUrl` bridge.

## Requirements

- Node.js 20+
- npm
- Built `orc-daemon` binary (see repository root [README](../README.md) or [Install-Instructions](../Install-Instructions/))

## Development

```bash
npm install
npm run dev
```

The renderer talks to the daemon at `http://127.0.0.1:8733` (see `src/renderer/utils/api.ts`).

## Production build

```bash
npm run build
```

Type-check only:

```bash
npm run lint:types
```

## Settings tabs

| Tab | Component | Purpose |
|-----|-----------|---------|
| general | Summary + notifications | System status, quick links |
| downloads | Session rate limits | Global upload/download caps |
| watch | `WatchFoldersSettings` | Auto-import `.torrent` files |
| seeding | `SeedingSettingsPanel` | Ratio and seed-time limits |
| bandwidth | `BandwidthSettingsPanel` | Schedule and profiles |
| search | `SearchSettingsPanel` | Torrent search providers |
| privacy | `SecuritySettings` | Policy profiles and encryption |
| network | `NetworkPostureCenter` | VPN, bind interface, kill switch |
| interface | Theme controls | Light/dark/auto |
| advanced | `DaemonControl` | Daemon lifecycle |

## Key paths

| Path | Role |
|------|------|
| `src/main/main.ts` | Electron main process, daemon spawn, IPC |
| `src/preload/preload.ts` | `window.orc` bridge |
| `src/renderer/ui/App.tsx` | Main UI state and routing |
| `src/renderer/utils/api.ts` | Daemon HTTP client |
