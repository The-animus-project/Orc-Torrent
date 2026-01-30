; upgrade.nsh
; Handles automatic upgrade detection and uninstallation of existing versions
; Detects any existing installation and uninstalls it before installing the new version

!include "${PROJECT_DIR}\installer\terminate-processes.nsh"

!macro CheckAndUninstallOldVersion
  ; Registry key for per-user installation
  ReadRegStr $R0 HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${UNINSTALL_APP_KEY}" "DisplayVersion"
  
  ; If not found in per-user, check per-machine
  StrCmp $R0 "" 0 check_version
    ReadRegStr $R0 HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\${UNINSTALL_APP_KEY}" "DisplayVersion"
  
  check_version:
  StrCmp $R0 "" fresh_install
    ; Version found - uninstall existing version regardless of version number
    ; This ensures we overwrite the existing installation to save disk space
    DetailPrint "Found installed version: $R0"
    DetailPrint "Installer version: ${VERSION}"
    DetailPrint "Upgrading existing installation: Uninstalling version $R0 before installing ${VERSION}..."
    DetailPrint "This will replace the existing installation to save disk space."
    
    ; Terminate running processes
    !insertmacro TerminateProcesses
    
    ; Get uninstaller path
    ReadRegStr $R2 HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${UNINSTALL_APP_KEY}" "UninstallString"
    StrCmp $R2 "" 0 found_uninstaller
      ReadRegStr $R2 HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\${UNINSTALL_APP_KEY}" "UninstallString"
    
    found_uninstaller:
    StrCmp $R2 "" no_uninstaller
      ; Remove quotes from uninstaller path if present
      StrCpy $R3 $R2 1
      StrCmp $R3 '"' 0 run_uninstall
        ; Extract path between quotes
        StrCpy $R4 $R2 "" 1
        StrLen $R5 $R4
        IntOp $R5 $R5 - 1
        StrCpy $R2 $R4 $R5
    
    run_uninstall:
      ; Run uninstaller silently
      DetailPrint "Running uninstaller: $R2"
      ExecWait '"$R2" /S _?=$INSTDIR' $R6
      
      IntCmp $R6 0 uninstall_success
        DetailPrint "Warning: Uninstaller returned error code $R6"
        Goto uninstall_done
      uninstall_success:
        DetailPrint "Previous version uninstalled successfully."
      uninstall_done:
      ; Wait a bit for cleanup
      Sleep 500
      Goto end_check
    
    no_uninstaller:
      DetailPrint "Warning: Could not find uninstaller path in registry. Installation may proceed with file overwrites."
      Goto end_check
  
  fresh_install:
    ; No previous version found - fresh install
    DetailPrint "No previous version detected. Performing fresh installation..."
  
  end_check:
!macroend
