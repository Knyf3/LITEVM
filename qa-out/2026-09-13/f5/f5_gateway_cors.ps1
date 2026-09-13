$ErrorActionPreference = 'Stop'
$p = 'C:\Program Files\Entech Security\UStarAPI\Settings\Settings.json'
$bak = "$p.bak-cors-20260913"
Copy-Item $p $bak -Force
Write-Output ("backup: " + $bak)

$raw = Get-Content $p -Raw
$j = $raw | ConvertFrom-Json

# The kiosk page is served at http://<host>:8123; a cross-origin POST to the
# gateway is blocked unless that exact scheme+host+port is allow-listed.
$origins = @('http://192.168.2.238:8123', 'http://localhost:8123', 'http://127.0.0.1:8123')

if (-not ($j.PSObject.Properties.Name -contains 'Cors')) {
    $j | Add-Member -NotePropertyName 'Cors' -NotePropertyValue ([pscustomobject]@{}) -Force
}
if (-not ($j.Cors.PSObject.Properties.Name -contains 'AllowedOrigins')) {
    $j.Cors | Add-Member -NotePropertyName 'AllowedOrigins' -NotePropertyValue @() -Force
}
$j.Cors.AllowedOrigins = $origins

$j | ConvertTo-Json -Depth 40 | Set-Content -Path $p -Encoding UTF8
Write-Output "--- written AllowedOrigins ---"
(Get-Content $p -Raw | ConvertFrom-Json).Cors.AllowedOrigins

Write-Output "--- restarting gateway ---"
Restart-Service UStarAPI
Start-Sleep -Seconds 6
Get-Service UStarAPI | Select-Object Status, Name | Format-List
Write-Output ("health: " + (try { (Invoke-WebRequest -Uri 'http://127.0.0.1:8091/swagger/index.html' -UseBasicParsing -TimeoutSec 20).StatusCode } catch { 'ERR ' + $_.Exception.Message }))
