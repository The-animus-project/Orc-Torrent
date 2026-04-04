# kill-cursor-locks.ps1
# Kills Cursor.exe processes that may be locking app.asar during electron-builder packaging

$ErrorActionPreference = "Continue"

Write-Host ""
Write-Host "Killing Cursor.exe processes that may lock app.asar..." -ForegroundColor Cyan
Write-Host ""

$cursorProcs = Get-Process -Name "Cursor" -ErrorAction SilentlyContinue

if ($cursorProcs) {
    Write-Host "Found $($cursorProcs.Count) Cursor.exe process(es):" -ForegroundColor Yellow
    $cursorProcs | ForEach-Object {
        Write-Host "  PID: $($_.Id) - $($_.Path)" -ForegroundColor White
        try {
            Stop-Process -Id $_.Id -Force -ErrorAction Stop
            Write-Host "    Terminated" -ForegroundColor Green
        } catch {
            Write-Host "    Failed to terminate: $_" -ForegroundColor Red
        }
    }
    Start-Sleep -Seconds 2
    Write-Host ""
    Write-Host "Cursor processes terminated. File handles should be released." -ForegroundColor Green
} else {
    Write-Host "No Cursor.exe processes found." -ForegroundColor Green
}

Write-Host ""
