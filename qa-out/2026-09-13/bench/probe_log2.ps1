$ErrorActionPreference = 'Continue'
$f = Get-ChildItem -Path 'C:\Program Files\Entech Security\UStarAPI','C:\ProgramData\Entech Security\UStarAPI' -Recurse -Include *.log -ErrorAction SilentlyContinue |
     Sort-Object LastWriteTime -Descending | Select-Object -First 1
Write-Output ("LOG: " + $f.FullName)
Write-Output '--- all sign-out poll lines in the last 200 ---'
Get-Content $f.FullName -Tail 200 | Select-String -Pattern 'Sign-out poll' | ForEach-Object { $_.Line }
Write-Output '--- any Error/Warning in the last 200 ---'
$e = Get-Content $f.FullName -Tail 200 | Select-String -Pattern '\[(ERR|WRN)\]'
if ($e) { $e | Select-Object -Last 15 | ForEach-Object { $_.Line } } else { Write-Output 'none' }
