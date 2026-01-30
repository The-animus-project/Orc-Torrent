# Silent Installation Guide

This document describes how to perform silent (unattended) installation of ORC TORRENT on Windows systems.

## Overview

Silent installation allows you to install ORC TORRENT without user interaction, which is useful for:
- Enterprise deployments
- Automated installation scripts
- System administrators managing multiple machines
- CI/CD pipelines

## Basic Silent Installation

### Standard Silent Install

Run the installer with the `/S` flag:

```powershell
.\"ORC TORRENT Setup 2.2.0.exe" /S
```

This will:
- Install to the default location (`%LOCALAPPDATA%\Programs\ORC TORRENT`)
- Create Start Menu shortcuts
- Create Desktop shortcut (if enabled)
- Create firewall rules automatically
- Run without showing the installer UI

### Silent Install with Custom Directory

To specify a custom installation directory:

```powershell
.\"ORC TORRENT Setup 2.2.0.exe" /S /D=C:\Program Files\ORC TORRENT
```

**Note**: The `/D` parameter must be the last parameter and must not contain quotes, even if the path has spaces.

### Silent Install with Logging

To perform a silent installation and save a detailed log:

```powershell
.\"ORC TORRENT Setup 2.2.0.exe" /S /L=$env:TEMP\orc-install.log
```

The log file will contain:
- Installation start/end times
- All installation steps
- File operations
- Firewall rule creation
- Verification results
- Any errors or warnings

## Advanced Options

### Disable Desktop Shortcut

By default, the installer creates a desktop shortcut. To disable it during silent install, you can modify the installer or use registry keys (requires custom build).

### Installation Directory Options

**Per-User Installation (Default)**:
```powershell
.\"ORC TORRENT Setup 2.2.0.exe" /S
```
Installs to: `%LOCALAPPDATA%\Programs\ORC TORRENT`

**Per-Machine Installation (Requires Admin)**:
```powershell
.\"ORC TORRENT Setup 2.2.0.exe" /S /ALLUSERS
```
Installs to: `C:\Program Files\ORC TORRENT`

**Note**: Per-machine installation requires administrator privileges.

## Silent Uninstallation

### Basic Silent Uninstall

To silently uninstall ORC TORRENT:

```powershell
.\uninstall.exe /S
```

Or if you have the uninstaller path from registry:

```powershell
$uninstallPath = (Get-ItemProperty "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\ORC TORRENT").UninstallString
& $uninstallPath /S
```

### Silent Uninstall with Logging

```powershell
.\uninstall.exe /S /L=$env:TEMP\orc-uninstall.log
```

The uninstaller will:
- Terminate running processes gracefully
- Remove firewall rules
- Remove application files
- Clean up registry entries
- Remove shortcuts
- Log all operations

## Return Codes

The installer/uninstaller returns the following exit codes:

- `0` - Success
- `1` - General error
- `2` - User cancelled
- `3` - Fatal error (installation failed)

You can check the exit code in PowerShell:

```powershell
$process = Start-Process -FilePath ".\ORC TORRENT Setup 2.2.0.exe" -ArgumentList "/S" -Wait -PassThru
if ($process.ExitCode -eq 0) {
    Write-Host "Installation successful"
} else {
    Write-Host "Installation failed with code: $($process.ExitCode)"
}
```

## Firewall Rules

During silent installation, firewall rules are created automatically. The installer will:

1. Create inbound rule for daemon API port (8733)
2. Create outbound rule for daemon executable
3. Create inbound rules for peer ports (6881-6890)
4. Create UDP rules for DHT (peer discovery)

**Note**: Firewall rule creation requires administrator privileges. If the installer is not run as administrator, firewall rules will not be created, but installation will continue.

To ensure firewall rules are created during silent install:

```powershell
Start-Process -FilePath ".\ORC TORRENT Setup 2.2.0.exe" -ArgumentList "/S" -Verb RunAs -Wait
```

## Installation Logs

Installation logs are automatically created in two locations:

1. **Temporary log**: `%TEMP%\ORC_TORRENT_Install.log`
   - Created during installation
   - Contains detailed step-by-step information

2. **Installation directory log**: `%INSTALLDIR%\install.log`
   - Copied from temporary log after successful installation
   - Persists after installation completes
   - Useful for troubleshooting

## Example: Complete Silent Installation Script

Here's a complete PowerShell script for silent installation:

```powershell
# Silent Installation Script for ORC TORRENT
$installerPath = ".\ORC TORRENT Setup 2.2.0.exe"
$logPath = "$env:TEMP\orc-install-$(Get-Date -Format 'yyyyMMdd-HHmmss').log"
$installDir = "$env:LOCALAPPDATA\Programs\ORC TORRENT"

Write-Host "Starting silent installation of ORC TORRENT..."
Write-Host "Installer: $installerPath"
Write-Host "Install Directory: $installDir"
Write-Host "Log File: $logPath"

# Run installer silently
$process = Start-Process -FilePath $installerPath `
    -ArgumentList "/S", "/D=$installDir", "/L=$logPath" `
    -Wait -PassThru -NoNewWindow

if ($process.ExitCode -eq 0) {
    Write-Host "Installation completed successfully!"
    Write-Host "Exit Code: $($process.ExitCode)"
    Write-Host "Log saved to: $logPath"
    
    # Check if installation log exists in install directory
    $installLog = Join-Path $installDir "install.log"
    if (Test-Path $installLog) {
        Write-Host "Installation log also saved to: $installLog"
    }
} else {
    Write-Host "Installation failed!"
    Write-Host "Exit Code: $($process.ExitCode)"
    Write-Host "Check log file: $logPath"
    exit $process.ExitCode
}
```

## Example: Silent Uninstallation Script

```powershell
# Silent Uninstallation Script for ORC TORRENT
$uninstallKey = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\ORC TORRENT"
$logPath = "$env:TEMP\orc-uninstall-$(Get-Date -Format 'yyyyMMdd-HHmmss').log"

# Get uninstaller path from registry
if (Test-Path $uninstallKey) {
    $uninstallPath = (Get-ItemProperty $uninstallKey).UninstallString
    
    # Remove quotes if present
    $uninstallPath = $uninstallPath -replace '"', ''
    
    Write-Host "Starting silent uninstallation..."
    Write-Host "Uninstaller: $uninstallPath"
    Write-Host "Log File: $logPath"
    
    # Run uninstaller silently
    $process = Start-Process -FilePath $uninstallPath `
        -ArgumentList "/S", "/L=$logPath" `
        -Wait -PassThru -NoNewWindow
    
    if ($process.ExitCode -eq 0) {
        Write-Host "Uninstallation completed successfully!"
    } else {
        Write-Host "Uninstallation failed with exit code: $($process.ExitCode)"
        exit $process.ExitCode
    }
} else {
    Write-Host "ORC TORRENT is not installed (registry key not found)"
    exit 1
}
```

## Troubleshooting

### Installation Fails Silently

1. Check the installation log file:
   ```powershell
   Get-Content "$env:TEMP\ORC_TORRENT_Install.log" | Select-Object -Last 50
   ```

2. Check the exit code:
   ```powershell
   echo $LASTEXITCODE
   ```

3. Try running with verbose logging:
   ```powershell
   .\"ORC TORRENT Setup 2.2.0.exe" /S /L=$env:TEMP\orc-install-verbose.log
   ```

### Firewall Rules Not Created

Firewall rule creation requires administrator privileges. Ensure the installer is run with elevated permissions:

```powershell
Start-Process -FilePath ".\ORC TORRENT Setup 2.2.0.exe" -ArgumentList "/S" -Verb RunAs
```

### Installation Directory Issues

If you encounter issues with custom installation directories:

1. Ensure the path exists or can be created
2. Ensure you have write permissions
3. Avoid paths with special characters
4. Use forward slashes or escaped backslashes in scripts

### Process Still Running After Uninstall

If processes are still running after uninstallation:

1. Check the uninstall log for termination errors
2. Manually terminate processes:
   ```powershell
   Stop-Process -Name "ORC TORRENT" -Force -ErrorAction SilentlyContinue
   Stop-Process -Name "orc-daemon" -Force -ErrorAction SilentlyContinue
   ```

## Best Practices

1. **Always use logging**: Include `/L=path` parameter to capture installation details
2. **Check exit codes**: Verify installation success by checking the exit code
3. **Test first**: Test silent installation on a non-production system
4. **Review logs**: Always review installation logs for warnings or errors
5. **Elevate when needed**: Use administrator privileges for firewall rules and per-machine installs
6. **Verify installation**: After installation, verify that files exist and the application can start

## Additional Resources

- NSIS Documentation: https://nsis.sourceforge.io/Docs/
- Electron Builder NSIS Options: https://www.electron.build/configuration/nsis
- Windows Firewall Configuration: https://docs.microsoft.com/en-us/windows/security/threat-protection/windows-firewall/
