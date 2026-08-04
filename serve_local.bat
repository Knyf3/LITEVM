@echo off
REM ============================================================
REM  LITEVM — Local Kiosk Server (Windows, zero dependencies)
REM  Serves the local verify kiosk from this folder.
REM  No Python, no Node — uses PowerShell's built-in HttpListener.
REM
REM  Usage:  double-click serve_local.bat
REM  URL:    http://localhost:8123/verifylocal.html
REM
REM  NOTE:  config.local.js must exist next to verifylocal.html
REM         (copy from config/config.local.js and fill in values)
REM ============================================================
setlocal
set PORT=8123
echo Starting LITEVM local kiosk on http://localhost:%PORT%/ ...
echo Press Ctrl+C to stop.
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$port = %PORT%;" ^
  "$root = (Get-Location).Path;" ^
  "$listener = [System.Net.HttpListener]::new();" ^
  "$listener.Prefixes.Add('http://localhost:' + $port + '/');" ^
  "$listener.Start();" ^
  "Write-Host ('Serving ' + $root + ' at http://localhost:' + $port + '/');" ^
  "while ($listener.IsListening) {" ^
  "  $ctx = $listener.GetContext();" ^
  "  $path = $ctx.Request.Url.AbsolutePath;" ^
  "  if ($path -eq '/' -or $path -eq '') { $path = '/verifylocal.html' }" ^
  "  $file = Join-Path $root ($path.TrimStart('/').Replace('/', [IO.Path]::DirectorySeparatorChar));" ^
  "  if (Test-Path $file) {" ^
  "    $bytes = [IO.File]::ReadAllBytes($file);" ^
  "    $ext = [IO.Path]::GetExtension($file).ToLower();" ^
  "    $mime = switch ($ext) { '.html' {'text/html'} '.js' {'application/javascript'} '.css' {'text/css'} '.png' {'image/png'} '.jpg' {'image/jpeg'} '.svg' {'image/svg+xml'} '.json' {'application/json'} default {'application/octet-stream'} };" ^
  "    $ctx.Response.ContentType = $mime;" ^
  "    $ctx.Response.OutputStream.Write($bytes, 0, $bytes.Length);" ^
  "  } else { $ctx.Response.StatusCode = 404 }" ^
  "  $ctx.Response.Close();" ^
  "}"