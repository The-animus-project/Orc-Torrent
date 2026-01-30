# fix-locks.ps1
# Quick fix for locked app.asar files during electron-builder packaging

Write-Host ""
Write-Host "Fixing file locks for electron-builder..." -ForegroundColor Cyan
Write-Host ""

$desktopDir = Split-Path -Parent $PSScriptRoot
$winUnpackedDir = Join-Path $desktopDir "dist\win-unpacked"

if (-not (Test-Path $winUnpackedDir)) {
    Write-Host "SUCCESS: dist\win-unpacked directory doesn't exist. Nothing to fix." -ForegroundColor Green
    Write-Host ""
    exit 0
}

Write-Host "Target: $winUnpackedDir" -ForegroundColor Gray
Write-Host ""

# Step 1: Kill any processes from win-unpacked
Write-Host "Step 1: Checking for processes from win-unpacked..." -ForegroundColor Cyan
$targetPath = (Resolve-Path $winUnpackedDir -ErrorAction SilentlyContinue).Path
if ($targetPath) {
    $procs = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
        Where-Object { 
            $_.ExecutablePath -and 
            $_.ExecutablePath.StartsWith($targetPath, [System.StringComparison]::OrdinalIgnoreCase)
        }
    
    if ($procs) {
        Write-Host "   Found $($procs.Count) process(es):" -ForegroundColor Yellow
        $procs | ForEach-Object {
            Write-Host "   - $($_.Name) (PID: $($_.ProcessId))" -ForegroundColor White
            try {
                Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
                Write-Host "     Terminated" -ForegroundColor Green
            } catch {
                Write-Host "     Failed to terminate" -ForegroundColor Yellow
            }
        }
        Start-Sleep -Seconds 2
    } else {
        Write-Host "   No processes found" -ForegroundColor Green
    }
}

# Step 2: Kill common Electron/ORC processes
Write-Host ""
Write-Host "Step 2: Checking for Electron/ORC processes..." -ForegroundColor Cyan
$commonProcs = Get-Process -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -match "electron|ORC|orc" }
    
if ($commonProcs) {
    Write-Host "   Found $($commonProcs.Count) process(es):" -ForegroundColor Yellow
    $commonProcs | ForEach-Object {
        Write-Host "   - $($_.Name) (PID: $($_.Id))" -ForegroundColor White
        try {
            Stop-Process -Id $_.Id -Force -ErrorAction SilentlyContinue
            Write-Host "     Terminated" -ForegroundColor Green
        } catch {
            Write-Host "     Failed to terminate" -ForegroundColor Yellow
        }
    }
    Start-Sleep -Seconds 2
} else {
    Write-Host "   No processes found" -ForegroundColor Green
}

# Step 3: Try to delete the directory
Write-Host ""
Write-Host "Step 3: Attempting to delete directory..." -ForegroundColor Cyan

# Remove read-only attributes
try {
    attrib -r "$winUnpackedDir\*" /s /d 2>$null | Out-Null
} catch {}

# Try multiple deletion methods
$deleted = $false

# Method 1: PowerShell Remove-Item
try {
    Remove-Item -Path $winUnpackedDir -Recurse -Force -ErrorAction Stop
    $deleted = $true
    Write-Host "   SUCCESS: Deleted using PowerShell" -ForegroundColor Green
} catch {
    # Continue to next method
}

# Method 2: cmd rmdir
if (-not $deleted) {
    try {
        $result = cmd /c "rmdir /s /q `"$winUnpackedDir`"" 2>&1
        Start-Sleep -Seconds 1
        if (-not (Test-Path $winUnpackedDir)) {
            $deleted = $true
            Write-Host "   SUCCESS: Deleted using cmd rmdir" -ForegroundColor Green
        }
    } catch {
        # Continue
    }
}

# Method 3: Rename then delete
if (-not $deleted) {
    try {
        $tempName = "${winUnpackedDir}_delete_$(Get-Date -Format 'yyyyMMddHHmmss')"
        Rename-Item -Path $winUnpackedDir -NewName $tempName -ErrorAction Stop
        Start-Sleep -Seconds 2
        Remove-Item -Path $tempName -Recurse -Force -ErrorAction Stop
        $deleted = $true
        Write-Host "   SUCCESS: Deleted using rename-then-delete" -ForegroundColor Green
    } catch {
        # Failed
    }
}

if (-not $deleted) {
    Write-Host ""
    Write-Host "WARNING: Could not delete directory. It may be locked by:" -ForegroundColor Yellow
    Write-Host "   - Windows Explorer (close any windows viewing this folder)" -ForegroundColor White
    Write-Host "   - Antivirus scanner (temporarily disable or add exclusion)" -ForegroundColor White
    Write-Host "   - Windows Search Indexer" -ForegroundColor White
    Write-Host ""
    Write-Host "Solutions:" -ForegroundColor Cyan
    Write-Host "   1. Close all File Explorer windows" -ForegroundColor White
    Write-Host "   2. Run: `$env:USE_TEMP_OUTPUT_ON_LOCK='1'; npm run dist" -ForegroundColor White
    Write-Host "   3. Or manually delete after closing Explorer" -ForegroundColor White
    Write-Host ""
    exit 1
}

Write-Host ""
Write-Host "SUCCESS: File locks resolved! You can now run: npm run dist" -ForegroundColor Green
Write-Host ""
