Place app icons, images, and bundled binaries here.

## Folder structure

- **icons/** – Icon files (`.ico`)
  - `icon.ico` – Windows app icon (recommended sizes: 16x16, 32x32, 48x48, 256x256)
  - `orc_ico(1).ico` – Source icon used to generate `icon.ico` if needed

- **images/** – Images and animations (`.png`, `.gif`)
  - `orc-torrent.png` – App icon as PNG
  - `orctorrent-logo.png` – Logo image
  - `spinner.gif` – Loading animation
  - `icon.png` – Alternate icon as PNG

- **bin/** – Bundled binaries (e.g. `orc-daemon.exe`)

## Icon requirements

For Windows builds, place an `.ico` file at `icons/icon.ico`.

The icon will be used by electron-builder for:
- The installer executable
- The application executable
- Desktop shortcuts
- Taskbar icon

**Note**: If `icons/icon.ico` is not present, electron-builder will use the default Electron icon. To create an icon file, you can:
1. Use an online converter to convert PNG/SVG to ICO format
2. Use tools like IcoFX or GIMP to create multi-resolution ICO files
3. Ensure the ICO file contains multiple sizes (16x16, 32x32, 48x48, 256x256) for best results
