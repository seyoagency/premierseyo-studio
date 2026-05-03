param(
  [Parameter(Mandatory=$true)]
  [string]$InstallDir
)

$ErrorActionPreference = "Stop"
$LogDir = Join-Path $env:LOCALAPPDATA "PremierSEYO\logs"
$ConfigDir = Join-Path $env:APPDATA "PremierSEYO"
$HomeConfigDir = Join-Path $HOME ".config\premier-seyo"
$NodeExe = Join-Path $InstallDir "runtime\node\node.exe"
$ServerJs = Join-Path $InstallDir "daemon\server.js"
$PluginCcx = Join-Path $InstallDir "plugin\PremierSEYO.ccx"
$PluginSource = Join-Path $InstallDir "plugin-source"
$PluginInstaller = Join-Path $InstallDir "installer\install-plugin.js"
$InstallLog = Join-Path $LogDir "install.log"
$UpiaLog = Join-Path $LogDir "upia-install.log"
$DaemonLog = Join-Path $LogDir "daemon.log"
$DaemonErrLog = Join-Path $LogDir "daemon.error.log"

New-Item -ItemType Directory -Force $LogDir | Out-Null
New-Item -ItemType Directory -Force $ConfigDir | Out-Null
New-Item -ItemType Directory -Force $HomeConfigDir | Out-Null

function Log([string]$Message) {
  $Line = "$(Get-Date -Format o) $Message"
  Add-Content -Path $InstallLog -Value $Line
  Write-Host $Message
}

function Quote-PsLiteral([string]$Value) {
  return "'" + ($Value -replace "'", "''") + "'"
}

function Copy-DirectoryContents([string]$Source, [string]$Destination) {
  if (Test-Path $Destination) {
    Remove-Item -LiteralPath $Destination -Recurse -Force
  }
  New-Item -ItemType Directory -Force $Destination | Out-Null
  Get-ChildItem -LiteralPath $Source -Force | ForEach-Object {
    Copy-Item -LiteralPath $_.FullName -Destination $Destination -Recurse -Force
  }
}

function Update-PremierePluginsInfo($Manifest, [string]$PluginFolderName) {
  $InfoDir = Join-Path $env:APPDATA "Adobe\UXP\PluginsInfo\v1"
  $InfoPath = Join-Path $InfoDir "premierepro.json"
  New-Item -ItemType Directory -Force $InfoDir | Out-Null

  $Existing = $null
  if (Test-Path $InfoPath) {
    try {
      $Existing = Get-Content -LiteralPath $InfoPath -Raw | ConvertFrom-Json
    } catch {
      $Backup = "$InfoPath.invalid-$(Get-Date -Format yyyyMMddHHmmss)"
      Copy-Item -LiteralPath $InfoPath -Destination $Backup -Force
      Log "Existing PluginsInfo JSON was invalid. Backup: $Backup"
    }
  }

  $Plugins = @()
  if ($Existing -and $Existing.PSObject.Properties.Name -contains "plugins" -and $Existing.plugins) {
    $Plugins = @($Existing.plugins)
  }

  $PluginId = [string]$Manifest.id
  $Filtered = @()
  foreach ($Plugin in $Plugins) {
    if ($Plugin -and [string]$Plugin.pluginId -ne $PluginId) {
      $Filtered += $Plugin
    }
  }

  $HostMinVersion = ""
  if ($Manifest.host -and $Manifest.host.minVersion) {
    $HostMinVersion = [string]$Manifest.host.minVersion
  }

  $Filtered += [pscustomobject]@{
    hostMinVersion = $HostMinVersion
    name = [string]$Manifest.name
    path = "`$localPlugins/External/$PluginFolderName"
    pluginId = $PluginId
    status = "enabled"
    type = "uxp"
    versionString = [string]$Manifest.version
  }

  [pscustomobject]@{ plugins = $Filtered } |
    ConvertTo-Json -Depth 20 |
    Set-Content -LiteralPath $InfoPath -Encoding UTF8
}

function Install-PluginManually {
  $TempDir = $null
  $SourceDir = $PluginSource

  if (!(Test-Path $SourceDir)) {
    if (!(Test-Path $PluginCcx)) {
      throw "Neither plugin-source nor PremierSEYO.ccx exists."
    }
    $TempDir = Join-Path $env:TEMP ("PremierSEYO-ccx-" + [guid]::NewGuid().ToString("N"))
    $ZipCopy = Join-Path $TempDir "PremierSEYO.zip"
    $SourceDir = Join-Path $TempDir "plugin"
    New-Item -ItemType Directory -Force $TempDir | Out-Null
    Copy-Item -LiteralPath $PluginCcx -Destination $ZipCopy -Force
    Expand-Archive -LiteralPath $ZipCopy -DestinationPath $SourceDir -Force
  }

  try {
    $ManifestPath = Join-Path $SourceDir "manifest.json"
    if (!(Test-Path $ManifestPath)) {
      throw "Plugin manifest not found: $ManifestPath"
    }

    $Manifest = Get-Content -LiteralPath $ManifestPath -Raw | ConvertFrom-Json
    $PluginId = [string]$Manifest.id
    $Version = [string]$Manifest.version
    if (!$PluginId -or !$Version) {
      throw "Plugin manifest is missing id or version."
    }

    $PluginFolderName = "${PluginId}_${Version}"
    $ExternalRoot = Join-Path $env:APPDATA "Adobe\UXP\Plugins\External"
    $DestDir = Join-Path $ExternalRoot $PluginFolderName
    New-Item -ItemType Directory -Force $ExternalRoot | Out-Null

    Get-ChildItem -LiteralPath $ExternalRoot -Directory -Filter "${PluginId}_*" -ErrorAction SilentlyContinue |
      Where-Object { $_.FullName -ne $DestDir } |
      ForEach-Object { Remove-Item -LiteralPath $_.FullName -Recurse -Force }

    Copy-DirectoryContents $SourceDir $DestDir
    Update-PremierePluginsInfo $Manifest $PluginFolderName
    Log "UXP plugin installed through External fallback: $DestDir"
  } finally {
    if ($TempDir -and (Test-Path $TempDir)) {
      Remove-Item -LiteralPath $TempDir -Recurse -Force -ErrorAction SilentlyContinue
    }
  }
}

function Install-UxpPlugin {
  if (Test-Path $PluginCcx) {
    Log "Installing UXP plugin through Adobe UPIA"
    & $NodeExe $PluginInstaller $PluginCcx *> $UpiaLog
    $UpiaExit = $LASTEXITCODE
    if ($UpiaExit -eq 0) {
      Log "UPIA plugin install completed"
      return
    }
    Log "UPIA plugin install failed with exit code $UpiaExit. Falling back to External install. See $UpiaLog"
  } else {
    Log "PremierSEYO.ccx not found. Using External plugin install fallback."
  }

  Install-PluginManually
}

function Write-DaemonRunner {
  $Runner = Join-Path $InstallDir "daemon\run-daemon.ps1"
  $InstallDirQ = Quote-PsLiteral $InstallDir
  $NodeExeQ = Quote-PsLiteral $NodeExe
  $ServerJsQ = Quote-PsLiteral $ServerJs
  $DaemonLogQ = Quote-PsLiteral $DaemonLog
  $DaemonErrLogQ = Quote-PsLiteral $DaemonErrLog

  $Content = @"
`$ErrorActionPreference = "Continue"
`$env:PREMIERSEYO_INSTALL_DIR = $InstallDirQ
`$env:PATH = (Join-Path $InstallDirQ "runtime\ffmpeg\bin") + [IO.Path]::PathSeparator + (Join-Path $InstallDirQ "runtime\node") + [IO.Path]::PathSeparator + `$env:PATH
& $NodeExeQ $ServerJsQ >> $DaemonLogQ 2>> $DaemonErrLogQ
"@
  Set-Content -LiteralPath $Runner -Value $Content -Encoding UTF8
  return $Runner
}

function Test-DaemonPing {
  for ($i = 0; $i -lt 8; $i++) {
    try {
      $Response = Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:53117/ping" -TimeoutSec 2
      if ($Response.StatusCode -eq 200) { return $true }
    } catch {}
    Start-Sleep -Milliseconds 750
  }
  return $false
}

function Stop-ExistingDaemonProcesses {
  try {
    $EscapedServer = [Regex]::Escape($ServerJs)
    Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
      Where-Object { $_.CommandLine -and $_.CommandLine -match $EscapedServer } |
      ForEach-Object {
        try {
          Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
          Log "Stopped existing daemon process: PID $($_.ProcessId)"
        } catch {}
      }
  } catch {
    Log "Existing daemon process cleanup skipped: $($_.Exception.Message)"
  }
}

function Get-PowerShellExe {
  $PowerShellExe = Join-Path $env:SystemRoot "System32\WindowsPowerShell\v1.0\powershell.exe"
  if (Test-Path $PowerShellExe) { return $PowerShellExe }
  return "powershell.exe"
}

function Remove-LegacyScheduledTask {
  try {
    $LegacyTask = Get-ScheduledTask -TaskName "PremierSEYO Daemon" -ErrorAction SilentlyContinue
    if ($LegacyTask) {
      Stop-ScheduledTask -TaskName "PremierSEYO Daemon" -ErrorAction SilentlyContinue
      Unregister-ScheduledTask -TaskName "PremierSEYO Daemon" -Confirm:$false -ErrorAction SilentlyContinue
      Log "Removed legacy Scheduled Task autostart entry"
    }
  } catch {}
}

function Install-DaemonAutostart {
  Log "Installing daemon autostart through HKCU Run"

  $Runner = Write-DaemonRunner
  $PowerShellExe = Get-PowerShellExe
  $RunKey = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Run"
  $RunName = "PremierSEYO Daemon"
  $RunValue = "`"$PowerShellExe`" -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$Runner`""

  Stop-ExistingDaemonProcesses
  Remove-LegacyScheduledTask
  New-Item -Path $RunKey -Force | Out-Null
  Set-ItemProperty -Path $RunKey -Name $RunName -Value $RunValue
  Log "Installed HKCU Run autostart entry: $RunName"

  Start-Process -FilePath $PowerShellExe -ArgumentList @("-NoProfile", "-ExecutionPolicy", "Bypass", "-WindowStyle", "Hidden", "-File", $Runner) -WindowStyle Hidden
  if (!(Test-DaemonPing)) {
    throw "Daemon did not answer after HKCU Run start. See $DaemonErrLog"
  }
  Log "PremierSEYO daemon started through HKCU Run"
}

try {
  Log "Starting PremierSEYO Windows install. InstallDir=$InstallDir"

  if (!(Test-Path $NodeExe)) { throw "Bundled node.exe not found: $NodeExe" }
  if (!(Test-Path $ServerJs)) { throw "Daemon server.js not found: $ServerJs" }
  if (!(Test-Path $PluginInstaller)) { throw "Plugin installer helper not found: $PluginInstaller" }
  if (!(Test-Path $PluginCcx) -and !(Test-Path $PluginSource)) {
    throw "Plugin payload not found. Missing both $PluginCcx and $PluginSource"
  }

  Install-UxpPlugin
  Install-DaemonAutostart

  Log "PremierSEYO Windows install completed"
  exit 0
} catch {
  Log "ERROR: $($_.Exception.Message)"
  if ($_.ScriptStackTrace) { Log $_.ScriptStackTrace }
  Write-Host "ERROR: $($_.Exception.Message)"
  exit 1
}
