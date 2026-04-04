<#
.SYNOPSIS
  Build the full ORC Torrent stack (Rust daemon + Electron renderer + main/preload) in one step.

.DESCRIPTION
  Runs from the repo root. Ensures npm dependencies exist in ui/desktop, then:
  - Default: npm run build  (cargo release orc-daemon, Vite, TypeScript)
  - With -Dist: npm run dist (same pipeline, then electron-builder installer)

.PARAMETER Dist
  After compiling, run electron-builder packaging (full installer flow).

.PARAMETER Install
  Run npm install in ui/desktop before building (ignored if -SkipInstall).

.PARAMETER SkipInstall
  Never run npm install, even when node_modules is missing.

.EXAMPLE
  .\build.ps1

.EXAMPLE
  .\build.ps1 -Dist

.EXAMPLE
  .\build.ps1 -Install

.NOTES
  From Command Prompt (cmd.exe), .\build.ps1 may open in Notepad. Use either:
    powershell -ExecutionPolicy Bypass -File .\build.ps1 -Dist
  or the wrapper (same args as build.ps1):
    build.cmd -Dist
#>

[CmdletBinding()]
param(
    [switch] $Dist,
    [switch] $Install,
    [switch] $SkipInstall
)

$ErrorActionPreference = "Stop"

$RepoRoot = $PSScriptRoot
$DesktopDir = Join-Path (Join-Path $RepoRoot "ui") "desktop"

if (-not (Test-Path $DesktopDir)) {
    Write-Error "Expected desktop app at: $DesktopDir"
}

function Assert-Command {
    param([string] $Name, [string] $Hint)
    if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
        Write-Error "'$Name' not found in PATH. $Hint"
    }
}

Assert-Command "npm" "Install Node.js LTS from https://nodejs.org/"
Assert-Command "cargo" "Install Rust from https://rustup.rs/"

Push-Location $DesktopDir
try {
    $hasModules = Test-Path (Join-Path $DesktopDir "node_modules")
    if (-not $SkipInstall) {
        if ($Install -or -not $hasModules) {
            Write-Host "npm install (ui/desktop)..." -ForegroundColor Cyan
            npm install
            if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
        }
    } elseif (-not $hasModules) {
        Write-Error "node_modules missing. Run without -SkipInstall or run 'npm install' in ui/desktop."
    }

    if ($Dist) {
        Write-Host "npm run dist (build + electron-builder)..." -ForegroundColor Cyan
        npm run dist
    } else {
        Write-Host "npm run build..." -ForegroundColor Cyan
        npm run build
    }
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

    Write-Host "`nDone." -ForegroundColor Green
} finally {
    Pop-Location
}
