# ORC TORRENT Installer Documentation

This directory contains NSIS (Nullsoft Scriptable Install System) scripts that customize the Windows installer for ORC TORRENT.

## File Structure

### Core Installer Files

- **`installer.nsh`** - Main installer script that includes and orchestrates all other scripts
- **`uninstaller.nsh`** - Custom uninstaller functions and cleanup logic

### Feature Modules

- **`firewall.nsh`** - Windows Firewall rule management (creation and removal)
- **`install-logging.nsh`** - Comprehensive installation logging functionality
- **`verification.nsh`** - Post-installation verification and checksum validation
- **`upgrade.nsh`** - Upgrade detection and automatic uninstallation of previous versions
- **`terminate-processes.nsh`** - Graceful process termination before install/uninstall
- **`custom-install.nsh`** - Atomic installation strategy (framework for future enhancement)

### Documentation

- **`SILENT_INSTALLATION.md`** - Complete guide for silent/unattended installation
- **`README.md`** - This file

## Features

### 1. Firewall Rule Management

**File**: `firewall.nsh`

Automatically creates Windows Firewall rules during installation:
- Inbound rule for daemon API port (8733)
- Outbound rule for daemon executable
- Inbound rules for peer ports (6881-6890)
- UDP rules for DHT (peer discovery)

Firewall rules are automatically removed during uninstallation.

**Note**: Firewall rule creation requires administrator privileges. If the installer is not run as administrator, firewall rules will not be created, but installation will continue.

### 2. Installation Logging

**File**: `install-logging.nsh`

Comprehensive logging of all installation steps:
- Installation start/end times
- All file operations
- Firewall rule creation
- Verification results
- Errors and warnings

Logs are saved to:
- `%TEMP%\ORC_TORRENT_Install.log` (temporary, during installation)
- `%INSTALLDIR%\install.log` (permanent, after successful installation)

### 3. Post-Installation Verification

**File**: `verification.nsh`

Verifies that installation completed successfully:
- Installation directory exists
- Main executable exists
- Daemon binary exists and is not empty
- Shortcuts created (if applicable)
- Registry entries created (if applicable)

### 4. Daemon Binary Checksum Verification

**File**: `verification.nsh`

Validates the integrity of the daemon binary by comparing its SHA256 hash against an expected checksum. The checksum is generated during the build process and embedded in the installer.

**Build Integration**: The build script (`scripts/build-full-installer.ps1`) automatically generates a checksum file (`assets/bin/orc-daemon.exe.sha256`) during the build process.

### 5. Upgrade Detection

**File**: `upgrade.nsh`

Automatically detects and uninstalls previous versions before installing a new version:
- Checks both per-user and per-machine registry locations
- Gracefully terminates running processes
- Runs previous uninstaller silently
- Proceeds with fresh installation

### 6. Process Termination

**File**: `terminate-processes.nsh`

Gracefully terminates running ORC TORRENT processes before installation/uninstallation:
- Attempts graceful shutdown via window messages
- Falls back to force termination if needed
- Handles both UI (`ORC TORRENT.exe`) and daemon (`orc-daemon.exe`) processes

## Usage

### Building the Installer

The installer is built automatically when you run:

```powershell
.\scripts\build-full-installer.ps1 release
```

This will:
1. Build the Rust daemon
2. Generate daemon binary checksum
3. Build the Electron application
4. Create the Windows installer with all customizations

### Customization

To customize the installer behavior, edit the appropriate `.nsh` file:

- **Firewall rules**: Edit `firewall.nsh` to modify ports or rule names
- **Logging**: Edit `install-logging.nsh` to change log locations or format
- **Verification**: Edit `verification.nsh` to add additional checks
- **Process termination**: Edit `terminate-processes.nsh` to modify shutdown behavior

### Disabling Features

To disable a feature, comment out the relevant macro call in `installer.nsh`:

```nsis
; Disable checksum verification
; !insertmacro VerifyDaemonChecksum

; Disable firewall rule creation
; !insertmacro CreateFirewallRules
```

## NSIS Macros Reference

### Installation Macros

- `!insertmacro InitInstallLog` - Initialize installation logging
- `!insertmacro LogMessage "message"` - Log a message
- `!insertmacro LogError "message"` - Log an error
- `!insertmacro LogWarning "message"` - Log a warning
- `!insertmacro CreateFirewallRules` - Create Windows Firewall rules
- `!insertmacro VerifyDaemonBinary` - Verify daemon binary exists
- `!insertmacro VerifyDaemonChecksum` - Verify daemon binary checksum
- `!insertmacro PostInstallVerification` - Run post-installation verification
- `!insertmacro FinalizeInstallLog 1` - Finalize installation logging (1 = success, 0 = failure)

### Uninstallation Macros

- `!insertmacro TerminateProcesses` - Terminate running processes
- `!insertmacro RemoveFirewallRules` - Remove Windows Firewall rules

## Troubleshooting

### Installer Fails to Create Firewall Rules

**Symptom**: Installation succeeds but firewall rules are not created.

**Solution**: Run the installer with administrator privileges:
```powershell
Start-Process -FilePath ".\ORC TORRENT Setup 2.2.0.exe" -Verb RunAs
```

### Checksum Verification Fails

**Symptom**: Installation log shows checksum verification failed.

**Possible Causes**:
1. Checksum file not included in installer (check `package.json` extraResources)
2. Binary was modified after checksum generation
3. File corruption during installation

**Solution**: Check the installation log for details. If the checksum file is missing, ensure the build script generates it and it's included in `extraResources`.

### Installation Log Not Created

**Symptom**: No installation log found after installation.

**Possible Causes**:
1. Installation failed before logging initialized
2. Insufficient permissions to write to `%TEMP%`
3. Installation was cancelled

**Solution**: Check `%TEMP%\ORC_TORRENT_Install.log` for temporary log, or check installer exit code.

## Development Notes

### Adding New Features

1. Create a new `.nsh` file for the feature (e.g., `my-feature.nsh`)
2. Define macros in the new file
3. Include the file in `installer.nsh`:
   ```nsis
   !include "${PROJECT_DIR}\installer\my-feature.nsh"
   ```
4. Call the macro in the appropriate hook:
   ```nsis
   !macro customInstall
     !insertmacro MyNewFeature
   !macroend
   ```

### Testing

To test installer changes:

1. Build the installer:
   ```powershell
   .\scripts\build-full-installer.ps1 release
   ```

2. Test installation:
   ```powershell
   .\ui\desktop\dist\*.exe
   ```

3. Check installation log:
   ```powershell
   Get-Content "$env:LOCALAPPDATA\Programs\ORC TORRENT\install.log"
   ```

4. Test uninstallation:
   ```powershell
   $uninstallPath = (Get-ItemProperty "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\ORC TORRENT").UninstallString
   & $uninstallPath
   ```

## References

- [NSIS Documentation](https://nsis.sourceforge.io/Docs/)
- [Electron Builder NSIS](https://www.electron.build/configuration/nsis)
- [Windows Firewall Configuration](https://docs.microsoft.com/en-us/windows/security/threat-protection/windows-firewall/)
