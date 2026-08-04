# Private AnimUS edition (local only)

Copy this folder to `ui/desktop/local-edition/` and edit `manifest.json`.
That directory is **gitignored** and will not be pushed to GitHub.

## Build your private copy

```bash
cd ui/desktop
npm run dev:animus    # development
npm run dist:animus   # installer → dist/animus/
```

## Branding & theme

- Place your logo at `local-edition/branding/animus_edition.png` (synced automatically on build)
- Neon lime graffiti UI theme with glow buttons, spray-paint background, and street fonts
- **AnimUS Edition** badge in the toolbar

## What AnimUS enables

- No bundled search providers; add and enable your own in Search settings
- Download policy blocks executables and non-media files (subtitles still allowed)
- Separate config folder: `OrcTorrent-AnimUS` (won't mix with the public build)
- No GitHub auto-update (private build)

All editions require users to add their own search providers.
