$ErrorActionPreference = 'Continue'
$roots = @('C:\Program Files\Entech Security\UStarAPI', 'C:\ProgramData\Entech Security\UStarAPI', 'C:\ProgramData\UStarAPI')
$f = Get-ChildItem -Path $roots -Recurse -Include *.log,*.txt -ErrorAction SilentlyContinue |
     Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (-not $f) { Write-Output 'NO_LOG_FILE_FOUND'; Write-Output ("searched: " + ($roots -join ', ')); exit }
Write-Output ("LOG: " + $f.FullName + "  (" + $f.Length + " bytes, last write " + $f.LastWriteTime + ")")
Write-Output '--- sign-out / provision / identify lines ---'
Get-Content $f.FullName -Tail 400 | Select-String -Pattern 'signout|sign-out|signOut|SignOut|provision|provisioned|DeletePerson|identify|candidate' |
    Select-Object -Last 40 | ForEach-Object { $_.Line }
Write-Output '--- last 8 lines (any) ---'
Get-Content $f.FullName -Tail 8
