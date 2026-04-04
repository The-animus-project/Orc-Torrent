; upgrade.nsh
; Handles automatic upgrade detection and uninstallation of existing versions
; Detects any existing installation and uninstalls it before installing the new version

!include "${PROJECT_DIR}\installer\terminate-processes.nsh"

!macro CheckAndUninstallOldVersion
  ; $R0=DisplayVersion, $R1=InstallLocation, $R2=UninstallString
  ; $R3=working/uninstaller path, $R4=temp, $R5=len, $R6=exit code
  ; $R7=install dir to uninstall from, $R8=registry hive label
  StrCpy $R0 ""
  StrCpy $R1 ""
  StrCpy $R2 ""
  StrCpy $R7 ""
  StrCpy $R8 ""

  ; Prefer per-user first, then per-machine.
  ReadRegStr $R0 HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${UNINSTALL_APP_KEY}" "DisplayVersion"
  ReadRegStr $R1 HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${UNINSTALL_APP_KEY}" "InstallLocation"
  ReadRegStr $R2 HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${UNINSTALL_APP_KEY}" "UninstallString"
  StrCmp $R0 "" +2 0
    StrCpy $R8 "HKCU"

  ; If we did not find enough metadata in HKCU, check HKLM.
  StrCmp $R8 "" 0 detect_done
  StrCmp $R2 "" 0 detect_done
    ReadRegStr $R0 HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\${UNINSTALL_APP_KEY}" "DisplayVersion"
    ReadRegStr $R1 HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\${UNINSTALL_APP_KEY}" "InstallLocation"
    ReadRegStr $R2 HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\${UNINSTALL_APP_KEY}" "UninstallString"
    StrCmp $R0 "" +2 0
      StrCpy $R8 "HKLM"
    StrCmp $R2 "" +2 0
      StrCpy $R8 "HKLM"

  detect_done:
  ; Nothing found -> fresh install.
  StrCmp $R0 "" +2 0
    Goto found_existing
  StrCmp $R2 "" fresh_install found_existing

  found_existing:
    StrCmp $R0 "" 0 +2
      StrCpy $R0 "unknown"
    StrCmp $R8 "" 0 +2
      StrCpy $R8 "unknown-hive"
    StrCmp $R1 "" 0 +2
      StrCpy $R1 "$INSTDIR"
    StrCpy $R7 $R1

    DetailPrint "Found existing ORC install (version: $R0, source: $R8)."
    DetailPrint "Detected install location: $R7"
    DetailPrint "Installer version: ${VERSION}"
    DetailPrint "Attempting uninstall of old version before installing ${VERSION}..."

    ; Terminate running processes first.
    !insertmacro TerminateProcesses

    ; Try uninstall string from registry first.
    StrCmp $R2 "" try_fallback_uninstall
      DetailPrint "Running uninstall command from registry: $R2"
      ExecWait '$R2 /S' $R6
      IntCmp $R6 0 uninstall_success
      DetailPrint "Warning: Registry uninstall command returned code $R6"

      ; Parse quoted executable path and retry with explicit _? location.
      StrCpy $R3 $R2
      StrCpy $R4 $R3 1
      StrCmp $R4 '"' 0 try_fallback_uninstall
        StrCpy $R3 $R3 "" 1
        StrLen $R5 $R3
        IntOp $R5 $R5 - 1
        StrCpy $R3 $R3 $R5
      DetailPrint "Retrying uninstaller executable directly: $R3"
      ExecWait '"$R3" /S _?=$R7' $R6
      IntCmp $R6 0 uninstall_success
      DetailPrint "Warning: Direct uninstaller retry returned code $R6"

    try_fallback_uninstall:
      ; Fallback #1: electron-builder uninstaller naming pattern.
      StrCpy $R3 "$R7\Uninstall ${PRODUCT_FILENAME}.exe"
      ${If} ${FileExists} "$R3"
        DetailPrint "Fallback uninstall path found: $R3"
        ExecWait '"$R3" /S _?=$R7' $R6
        IntCmp $R6 0 uninstall_success
        DetailPrint "Warning: Fallback uninstaller returned code $R6"
      ${EndIf}

      ; Fallback #2: common generic uninstaller name.
      StrCpy $R3 "$R7\Uninstall.exe"
      ${If} ${FileExists} "$R3"
        DetailPrint "Fallback uninstall path found: $R3"
        ExecWait '"$R3" /S _?=$R7' $R6
        IntCmp $R6 0 uninstall_success
        DetailPrint "Warning: Generic fallback uninstaller returned code $R6"
      ${EndIf}

      DetailPrint "Warning: Could not fully uninstall previous version. Continuing with overwrite install."
      Sleep 500
      Goto end_check

    uninstall_success:
      DetailPrint "Previous version uninstall completed successfully."
      Sleep 500
      Goto end_check

  fresh_install:
    DetailPrint "No previous version detected. Performing fresh installation..."

  end_check:
!macroend
