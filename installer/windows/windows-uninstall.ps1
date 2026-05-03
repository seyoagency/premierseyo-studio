param(
  [Parameter(Mandatory=$true)]
  [string]$InstallDir
)

$TaskName = "PremierSEYO Daemon"
$RunKey = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Run"
$RunName = "PremierSEYO Daemon"

try {
  if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
    Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
  }
} catch {
  Write-Host "Scheduled Task cleanup skipped: $($_.Exception.Message)"
}

try {
  Remove-ItemProperty -Path $RunKey -Name $RunName -ErrorAction SilentlyContinue
} catch {
  Write-Host "HKCU Run cleanup skipped: $($_.Exception.Message)"
}

$Escaped = [Regex]::Escape((Join-Path $InstallDir "daemon\server.js"))
Get-CimInstance Win32_Process |
  Where-Object { $_.CommandLine -match $Escaped } |
  ForEach-Object {
    try { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue } catch {}
  }

Write-Host "PremierSEYO daemon startup entry removed. Config and API key are preserved under %APPDATA%\PremierSEYO."
