@echo off
REM LITEVM — Local Kiosk launcher
REM Starts the PowerShell static server for the local verify kiosk.
REM URL: http://localhost:8123/verifylocal.html
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0serve_local.ps1"
