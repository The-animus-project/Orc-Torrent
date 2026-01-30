# find-locker.ps1
# Identifies the process locking app.asar using multiple detection methods

param(
    [string]$FilePath = "dist\win-unpacked\resources\app.asar"
)

$ErrorActionPreference = "Continue"

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Finding process locking app.asar" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

$desktopDir = Split-Path -Parent $PSScriptRoot
$fullPath = Join-Path $desktopDir $FilePath

if (-not (Test-Path $fullPath)) {
    Write-Host "ERROR: File not found: $fullPath" -ForegroundColor Red
    exit 1
}

$fullPath = (Resolve-Path $fullPath).Path
$dirPath = Split-Path $fullPath -Parent
$winUnpackedDir = Split-Path $dirPath -Parent

Write-Host "Target file: $fullPath" -ForegroundColor Gray
Write-Host "Directory: $winUnpackedDir" -ForegroundColor Gray
Write-Host ""

# Method 1: Check processes executing from win-unpacked
Write-Host "Method 1: Processes executing from win-unpacked..." -ForegroundColor Yellow
$procsByPath = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
    Where-Object { 
        $_.ExecutablePath -and 
        $_.ExecutablePath.StartsWith($winUnpackedDir, [System.StringComparison]::OrdinalIgnoreCase)
    }

if ($procsByPath) {
    Write-Host "FOUND PROCESSES:" -ForegroundColor Red
    $procsByPath | ForEach-Object {
        Write-Host "  Process: $($_.Name)" -ForegroundColor White
        Write-Host "  PID: $($_.ProcessId)" -ForegroundColor White
        Write-Host "  Path: $($_.ExecutablePath)" -ForegroundColor Gray
        Write-Host ""
    }
} else {
    Write-Host "  No processes found" -ForegroundColor Green
}
Write-Host ""

# Method 2: Check for processes with loaded modules from the directory
Write-Host "Method 2: Processes with modules loaded from directory..." -ForegroundColor Yellow
$suspiciousProcs = @()

# Check common processes that might lock files
$processNames = @("explorer", "electron", "Code", "devenv", "MsMpEng", "AvastSvc", "node", "vite", "ORC")

foreach ($procName in $processNames) {
    $procs = Get-Process -Name $procName -ErrorAction SilentlyContinue
    foreach ($proc in $procs) {
        try {
            $modules = $proc.Modules | Where-Object { 
                $_.FileName -ne $null -and 
                $_.FileName -like "*$winUnpackedDir*" 
            }
            if ($modules) {
                $suspiciousProcs += [PSCustomObject]@{
                    Name = $proc.Name
                    Id = $proc.Id
                    Path = $modules[0].FileName
                }
            }
        } catch {
            # Access denied or process ended
        }
    }
}

if ($suspiciousProcs.Count -gt 0) {
    Write-Host "FOUND PROCESSES WITH MODULES:" -ForegroundColor Red
    $suspiciousProcs | ForEach-Object {
        Write-Host "  Process: $($_.Name)" -ForegroundColor White
        Write-Host "  PID: $($_.Id)" -ForegroundColor White
        Write-Host "  Module: $($_.Path)" -ForegroundColor Gray
        Write-Host ""
    }
} else {
    Write-Host "  No processes with modules found" -ForegroundColor Green
}
Write-Host ""

# Method 3: Check all running processes for common names
Write-Host "Method 3: All running processes matching common lockers..." -ForegroundColor Yellow
$allProcs = Get-Process -ErrorAction SilentlyContinue |
    Where-Object { 
        $_.Name -match "orc|electron|ORC|builder|app-builder|vite|node|explorer" 
    } |
    Select-Object Name, Id, Path

if ($allProcs) {
    Write-Host "RUNNING PROCESSES (potential lockers):" -ForegroundColor Yellow
    $allProcs | ForEach-Object {
        Write-Host "  $($_.Name) (PID: $($_.Id))" -ForegroundColor White
        if ($_.Path) {
            Write-Host "    Path: $($_.Path)" -ForegroundColor Gray
        }
    }
} else {
    Write-Host "  No matching processes found" -ForegroundColor Green
}
Write-Host ""

# Summary and recommendations
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "RECOMMENDATIONS" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

if ($procsByPath) {
    Write-Host "ACTION REQUIRED: Kill processes executing from win-unpacked:" -ForegroundColor Red
    $procsByPath | ForEach-Object {
        Write-Host "  taskkill /PID $($_.ProcessId) /F" -ForegroundColor White
    }
    Write-Host ""
}

if ($suspiciousProcs.Count -gt 0) {
    Write-Host "ACTION REQUIRED: Kill processes with loaded modules:" -ForegroundColor Red
    $suspiciousProcs | ForEach-Object {
        Write-Host "  taskkill /PID $($_.Id) /F" -ForegroundColor White
    }
    Write-Host ""
}

if (-not $procsByPath -and $suspiciousProcs.Count -eq 0) {
    Write-Host "No obvious process found. The lock may be from:" -ForegroundColor Yellow
    Write-Host "  1. Windows Explorer (close folder windows)" -ForegroundColor White
    Write-Host "  2. Antivirus (Defender/AV scanning the file)" -ForegroundColor White
    Write-Host "  3. Windows Search Indexer" -ForegroundColor White
    Write-Host ""
    Write-Host "Try the 'nuke from orbit' approach:" -ForegroundColor Cyan
    Write-Host "  Get-Process | Where-Object { `$_.Name -match 'orc|electron|builder|vite|node' } | Stop-Process -Force" -ForegroundColor White
    Write-Host "  Stop-Process -Name explorer -Force; Start-Process explorer" -ForegroundColor White
    Write-Host ""
}

Write-Host "For definitive identification, install Sysinternals handle.exe:" -ForegroundColor Cyan
Write-Host "  Download: https://learn.microsoft.com/en-us/sysinternals/downloads/handle" -ForegroundColor Gray
Write-Host "  Run: handle.exe -accepteula `"$fullPath`"" -ForegroundColor Gray
Write-Host ""
