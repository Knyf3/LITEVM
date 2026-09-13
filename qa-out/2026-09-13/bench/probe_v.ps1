$ErrorActionPreference = 'Continue'
$j = Get-Content 'C:\Program Files\Entech Security\UStarAPI\Settings\Settings.json' -Raw | ConvertFrom-Json
$v = $j.Litevm.Verification
Write-Output ("Verification Face=" + $v.Face + " Qr=" + $v.Qr + " Card=" + $v.Card)
Write-Output ("CardPool " + $j.Litevm.CardPoolMin + ".." + $j.Litevm.CardPoolMax + " | SheetId tail " + $j.Litevm.SheetId.Substring($j.Litevm.SheetId.Length-4))
Write-Output ("SignOut.PollIntervalSeconds=" + $j.SignOut.PollIntervalSeconds)
