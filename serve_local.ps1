# LITEVM — Local Kiosk Static Server (Windows, zero dependencies)
#
# Serves the local verify kiosk from this folder using PowerShell's
# built-in HttpListener. No Python, no Node, no install required.
#
# Usage:    powershell -ExecutionPolicy Bypass -File serve_local.ps1
# URL:      http://localhost:8123/verifylocal.html
#
# NOTE: config.local.js must exist next to verifylocal.html
#       (copy from config/config.local.js and fill in values)

param(
    [int]$Port = 8123
)

$root = (Get-Location).Path
$listener = [System.Net.HttpListener]::new()
$listener.Prefixes.Add("http://localhost:$Port/")
$listener.Start()

Write-Host "LITEVM local kiosk serving $root at http://localhost:$Port/"
Write-Host "Press Ctrl+C to stop."

while ($listener.IsListening) {
    $context = $listener.GetContext()
    $requestPath = $context.Request.Url.AbsolutePath

    # Root request serves the kiosk entry page
    if ($requestPath -eq '/' -or $requestPath -eq '') {
        $requestPath = '/verifylocal.html'
    }

    $relativePath = $requestPath.TrimStart('/').Replace('/', [IO.Path]::DirectorySeparatorChar)
    $filePath = Join-Path $root $relativePath

    if (Test-Path $filePath -PathType Leaf) {
        $bytes = [IO.File]::ReadAllBytes($filePath)
        $extension = [IO.Path]::GetExtension($filePath).ToLower()

        switch ($extension) {
            '.html' { $context.Response.ContentType = 'text/html' }
            '.js'   { $context.Response.ContentType = 'application/javascript' }
            '.css'  { $context.Response.ContentType = 'text/css' }
            '.png'  { $context.Response.ContentType = 'image/png' }
            '.jpg'  { $context.Response.ContentType = 'image/jpeg' }
            '.svg'  { $context.Response.ContentType = 'image/svg+xml' }
            '.json' { $context.Response.ContentType = 'application/json' }
            default { $context.Response.ContentType = 'application/octet-stream' }
        }

        $context.Response.OutputStream.Write($bytes, 0, $bytes.Length)
    }
    else {
        $context.Response.StatusCode = 404
    }

    $context.Response.Close()
}
