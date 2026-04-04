# Installer Configuration

## Overview

The ORC TORRENT installer is configured to:

1. **Automatically upgrade existing installations** - When installing over an existing version, the installer will:
   - Detect the existing installation
   - Uninstall the old version completely
   - Install the new version
   - This saves disk space by replacing rather than duplicating files

2. **User Options** - The installer provides options for:
   - **Desktop Shortcut**: Optional checkbox to create a desktop icon
   - **Set as Default Torrent Client**: Optional checkbox to associate .torrent files and magnet: links with ORC TORRENT

## Configuration Files

- `installer.nsh` - Main installer script that includes all custom functionality
- `installer-options.nsh` - Custom options page for user preferences
- `upgrade.nsh` - Handles automatic upgrade/uninstall of existing versions
- `package.json` - Electron-builder configuration

## How It Works

### Upgrade Process

The installer automatically detects existing installations via the Windows registry:
- Checks both per-user (HKCU) and per-machine (HKLM) registry keys
- If found, runs the uninstaller silently before installing the new version
- This ensures a clean upgrade that replaces files rather than duplicating them

### User Options

The installer includes a custom options page (before the installation directory selection) that allows users to:
- Choose whether to create a desktop shortcut (default: yes)
- Choose whether to set ORC TORRENT as the default torrent client (default: yes)

These choices are stored in the registry and applied during installation.

## File Associations

File associations are registered based on user choice:
- `.torrent` files → ORC TORRENT
- `magnet:` protocol → ORC TORRENT

If the user unchecks "Set as default torrent client", these associations are not registered, allowing the user to keep their current default torrent client.

## Desktop Shortcut

The desktop shortcut is created conditionally based on user choice. If unchecked, no desktop shortcut is created, but the Start Menu shortcut is always created.
