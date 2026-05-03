param(
  [string]$InstallDir = (Join-Path $env:LOCALAPPDATA "Programs\PremierSEYO")
)

$ErrorActionPreference = "Stop"
$SourceRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$InstallDir = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($InstallDir)
$LogDir = Join-Path $env:LOCALAPPDATA "PremierSEYO\logs"
$InstallLog = Join-Path $LogDir "install.log"

New-Item -ItemType Directory -Force $LogDir | Out-Null

function Log([string]$Message) {
  $Line = "$(Get-Date -Format o) $Message"
  Add-Content -Path $InstallLog -Value $Line
  Write-Host $Message
}

function Get-PowerShellExe {
  $PowerShellExe = Join-Path $env:SystemRoot "System32\WindowsPowerShell\v1.0\powershell.exe"
  if (Test-Path $PowerShellExe) { return $PowerShellExe }
  return "powershell.exe"
}

function Write-UninstallRegistry {
  $ManifestPath = Join-Path $InstallDir "plugin-source\manifest.json"
  $Version = "0.0.0"
  if (Test-Path $ManifestPath) {
    try {
      $Version = [string]((Get-Content -LiteralPath $ManifestPath -Raw | ConvertFrom-Json).version)
    } catch {}
  }

  $PowerShellExe = Get-PowerShellExe
  $UninstallScript = Join-Path $InstallDir "installer\windows-uninstall.ps1"
  $UninstallCommand = "`"$PowerShellExe`" -NoProfile -ExecutionPolicy Bypass -File `"$UninstallScript`" -InstallDir `"$InstallDir`""
  $UninstallKey = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\PremierSEYO"

  New-Item -Path $UninstallKey -Force | Out-Null
  Set-ItemProperty -Path $UninstallKey -Name "DisplayName" -Value "PremierSEYO"
  Set-ItemProperty -Path $UninstallKey -Name "DisplayVersion" -Value $Version
  Set-ItemProperty -Path $UninstallKey -Name "Publisher" -Value "SEYO"
  Set-ItemProperty -Path $UninstallKey -Name "InstallLocation" -Value $InstallDir
  Set-ItemProperty -Path $UninstallKey -Name "UninstallString" -Value $UninstallCommand
  New-ItemProperty -Path $UninstallKey -Name "NoModify" -PropertyType DWord -Value 1 -Force | Out-Null
  New-ItemProperty -Path $UninstallKey -Name "NoRepair" -PropertyType DWord -Value 1 -Force | Out-Null
}

function Copy-Payload {
  $Source = $SourceRoot.TrimEnd("\")
  $Destination = $InstallDir.TrimEnd("\")
  if ($Source -ieq $Destination) {
    Log "Portable payload is already in install directory"
    return
  }

  if (Test-Path $InstallDir) {
    Remove-Item -LiteralPath $InstallDir -Recurse -Force
  }
  New-Item -ItemType Directory -Force $InstallDir | Out-Null
  Get-ChildItem -LiteralPath $SourceRoot -Force |
    Copy-Item -Destination $InstallDir -Recurse -Force
}

try {
  Log "Starting PremierSEYO portable Windows install. SourceRoot=$SourceRoot InstallDir=$InstallDir"
  if (!(Test-Path (Join-Path $SourceRoot "daemon\server.js"))) {
    throw "Portable payload is incomplete. Missing daemon\server.js under $SourceRoot"
  }

  Copy-Payload

  try {
    Get-ChildItem -LiteralPath $InstallDir -Recurse -Force -ErrorAction SilentlyContinue |
      Unblock-File -ErrorAction SilentlyContinue
  } catch {}

  $InstallScript = Join-Path $InstallDir "installer\windows-install.ps1"
  & (Get-PowerShellExe) -NoProfile -ExecutionPolicy Bypass -File $InstallScript -InstallDir $InstallDir
  if ($LASTEXITCODE -ne 0) {
    throw "windows-install.ps1 failed with exit code $LASTEXITCODE"
  }

  Write-UninstallRegistry
  Log "PremierSEYO portable Windows install completed"
  exit 0
} catch {
  Log "ERROR: $($_.Exception.Message)"
  if ($_.ScriptStackTrace) { Log $_.ScriptStackTrace }
  Write-Host "ERROR: $($_.Exception.Message)"
  exit 1
}
