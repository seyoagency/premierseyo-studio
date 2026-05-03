Unicode true

!include MUI2.nsh
!include LogicLib.nsh

!ifndef VERSION
  !define VERSION "0.0.0"
!endif
!ifndef STAGING_DIR
  !error "STAGING_DIR define is required"
!endif
!ifndef OUTFILE
  !define OUTFILE "PremierSEYO-Setup-x64.exe"
!endif

Name "PremierSEYO"
OutFile "${OUTFILE}"
InstallDir "$LOCALAPPDATA\Programs\PremierSEYO"
InstallDirRegKey HKCU "Software\PremierSEYO" "InstallDir"
RequestExecutionLevel user

!define MUI_ABORTWARNING
!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "English"

Section "Install"
  SetShellVarContext current

  DetailPrint "Removing previous per-user install..."
  nsExec::ExecToLog 'powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "Remove-ItemProperty -Path ''HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'' -Name ''PremierSEYO Daemon'' -ErrorAction SilentlyContinue"'
  Pop $0
  RMDir /r "$INSTDIR"

  SetOutPath "$INSTDIR"
  File /r "${STAGING_DIR}\*"

  CreateDirectory "$LOCALAPPDATA\PremierSEYO\logs"
  CreateDirectory "$APPDATA\PremierSEYO"

  DetailPrint "Installing UXP plugin and starting daemon..."
  nsExec::ExecToLog 'powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$INSTDIR\installer\windows-install.ps1" -InstallDir "$INSTDIR"'
  Pop $0
  ${If} $0 != 0
    MessageBox MB_ICONSTOP "PremierSEYO setup failed. Check $LOCALAPPDATA\PremierSEYO\logs\install.log for details."
    Abort
  ${EndIf}

  WriteUninstaller "$INSTDIR\Uninstall.exe"
  WriteRegStr HKCU "Software\PremierSEYO" "InstallDir" "$INSTDIR"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\PremierSEYO" "DisplayName" "PremierSEYO"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\PremierSEYO" "DisplayVersion" "${VERSION}"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\PremierSEYO" "Publisher" "SEYO"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\PremierSEYO" "UninstallString" '"$INSTDIR\Uninstall.exe"'
  WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\PremierSEYO" "NoModify" 1
  WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\PremierSEYO" "NoRepair" 1
SectionEnd

Section "Uninstall"
  SetShellVarContext current
  nsExec::ExecToLog 'powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$INSTDIR\installer\windows-uninstall.ps1" -InstallDir "$INSTDIR"'
  DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\PremierSEYO"
  DeleteRegKey HKCU "Software\PremierSEYO"
  RMDir /r "$INSTDIR"
SectionEnd
