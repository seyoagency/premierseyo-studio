param(
  [string]$NodeRuntime = $env:PREMIERSEYO_NODE_WIN_DIR,
  [string]$FfmpegRuntime = $env:PREMIERSEYO_FFMPEG_WIN_DIR,
  [string]$Makensis = $env:MAKENSIS_EXE
)

$ErrorActionPreference = "Stop"
$RepoRoot = Resolve-Path (Join-Path $PSScriptRoot "..\..")
$PackageJson = Get-Content (Join-Path $RepoRoot "package.json") -Raw | ConvertFrom-Json
$Version = $PackageJson.version
$StagingRoot = Join-Path $RepoRoot "dist\windows\staging"
$AppRoot = Join-Path $StagingRoot "app"
$PluginSource = Join-Path $AppRoot "plugin-source"
$PluginDir = Join-Path $AppRoot "plugin"
$CcxPath = Join-Path $PluginDir "PremierSEYO.ccx"
$OutFile = Join-Path $RepoRoot "dist\PremierSEYO-Setup-x64-$Version.exe"

Push-Location $RepoRoot
try {
  npm run build:assets

  if ($NodeRuntime) { $env:PREMIERSEYO_NODE_WIN_DIR = $NodeRuntime }
  if ($FfmpegRuntime) { $env:PREMIERSEYO_FFMPEG_WIN_DIR = $FfmpegRuntime }
  node scripts/package-windows.js

  if (!(Test-Path $PluginDir)) { New-Item -ItemType Directory -Force $PluginDir | Out-Null }
  if (Test-Path $CcxPath) { Remove-Item $CcxPath -Force }
  $ZipPath = Join-Path $PluginDir "PremierSEYO.zip"
  if (Test-Path $ZipPath) { Remove-Item $ZipPath -Force }
  Compress-Archive -Path (Join-Path $PluginSource "*") -DestinationPath $ZipPath -Force
  Move-Item $ZipPath $CcxPath -Force
  # Keep plugin-source in the installer. windows-install.ps1 uses it as a
  # fallback when Adobe UPIA is missing or rejects the unsigned local CCX.

  if (!$Makensis) {
    $Candidates = @(
      (Join-Path ${env:ProgramFiles(x86)} "NSIS\makensis.exe"),
      (Join-Path $env:ProgramFiles "NSIS\makensis.exe"),
      "makensis.exe"
    )
    foreach ($Candidate in $Candidates) {
      if ($Candidate -eq "makensis.exe") {
        $Found = Get-Command $Candidate -ErrorAction SilentlyContinue
        if ($Found) { $Makensis = $Found.Source; break }
      } elseif (Test-Path $Candidate) {
        $Makensis = $Candidate; break
      }
    }
  }
  if (!$Makensis -or !(Test-Path $Makensis)) {
    throw "NSIS makensis.exe not found. Install NSIS or set MAKENSIS_EXE."
  }

  if (Test-Path $OutFile) { Remove-Item $OutFile -Force }
  & $Makensis "/DVERSION=$Version" "/DSTAGING_DIR=$AppRoot" "/DOUTFILE=$OutFile" (Join-Path $PSScriptRoot "PremierSEYO.nsi")
  Write-Host "[installer:win] $OutFile"
}
finally {
  Pop-Location
}
