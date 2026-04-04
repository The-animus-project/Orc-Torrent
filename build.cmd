@echo off
REM Run from cmd.exe or double-click (avoids .ps1 opening in Notepad).
REM Usage: build.cmd          -> full compile
REM        build.cmd -Dist    -> compile + electron-builder installer
setlocal
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0build.ps1" %*
exit /b %ERRORLEVEL%
