; installer.nsh
; Master installer script that includes all custom NSIS functionality
; This file is referenced by electron-builder's nsis.include configuration

; Include required NSIS plugins and utilities
!include "LogicLib.nsh"
!include "FileFunc.nsh"
!include "StrFunc.nsh"
${StrStr}

; Include upgrade detection and uninstallation logic (this also includes terminate-processes.nsh)
!include "${PROJECT_DIR}\installer\upgrade.nsh"

; Include atomic installation strategy
!include "${PROJECT_DIR}\installer\custom-install.nsh"

; Include firewall rule management
!include "${PROJECT_DIR}\installer\firewall.nsh"

; Include installation logging
!include "${PROJECT_DIR}\installer\install-logging.nsh"

; Include post-install verification
!include "${PROJECT_DIR}\installer\verification.nsh"

; Include uninstaller customizations
!include "${PROJECT_DIR}\installer\uninstaller.nsh"

; Include installer options page
!include "${PROJECT_DIR}\installer\installer-options.nsh"

; Hook to add custom page before components page
!macro customHeader
  ; Add custom options page
  Page custom InstallOptionsPage InstallOptionsPageLeave
!macroend

; Initialize installation logging at the start
!macro customInit
  !insertmacro InitInstallLog
  !insertmacro LogMessage "Installer initialized"
  !insertmacro CheckAndUninstallOldVersion
!macroend

; Verify daemon binary is installed correctly
!macro VerifyDaemonBinary
  !insertmacro LogMessage "Verifying daemon binary installation..."
  ; Check if daemon binary exists in resources/bin
  ; This path is where electron-builder places extraResources
  ${If} ${FileExists} "$INSTDIR\resources\bin\orc-daemon.exe"
    !insertmacro LogMessage "Daemon binary verified: $INSTDIR\resources\bin\orc-daemon.exe"
    DetailPrint "Daemon binary verified: $INSTDIR\resources\bin\orc-daemon.exe"
  ${Else}
    ; Also check portable installation path (next to executable)
    ${If} ${FileExists} "$INSTDIR\bin\orc-daemon.exe"
      !insertmacro LogMessage "Daemon binary verified: $INSTDIR\bin\orc-daemon.exe"
      DetailPrint "Daemon binary verified: $INSTDIR\bin\orc-daemon.exe"
    ${Else}
      ; Check same directory as executable (portable fallback)
      ${If} ${FileExists} "$INSTDIR\orc-daemon.exe"
        !insertmacro LogMessage "Daemon binary verified: $INSTDIR\orc-daemon.exe"
        DetailPrint "Daemon binary verified: $INSTDIR\orc-daemon.exe"
      ${Else}
        !insertmacro LogWarning "Daemon binary not found in expected locations"
        DetailPrint "WARNING: Daemon binary not found in expected locations"
        DetailPrint "  Checked: $INSTDIR\resources\bin\orc-daemon.exe"
        DetailPrint "  Checked: $INSTDIR\bin\orc-daemon.exe"
        DetailPrint "  Checked: $INSTDIR\orc-daemon.exe"
        DetailPrint "  Installation may fail at runtime if daemon cannot be found"
      ${EndIf}
    ${EndIf}
  ${EndIf}
!macroend

; Hook into installation completion
!macro customInstall
  !insertmacro LogMessage "Starting custom installation steps..."
  
  ; Verify daemon binary
  !insertmacro VerifyDaemonBinary
  
  ; Optional: Verify daemon binary checksum (enabled by default, can be disabled)
  ; Uncomment the line below to disable checksum verification
  !insertmacro VerifyDaemonChecksum
  
  ; Desktop shortcut is created by electron-builder (createDesktopShortcut: "always") with app icon
  
  ; Register file associations based on user choice
  !insertmacro RegisterFileAssociationsConditional
  
  ; Optional: Create firewall rules (can be controlled via installer option)
  ; Check if user wants firewall rules (default: yes, but can be made optional)
  ; For now, we'll create them by default
  !insertmacro LogMessage "Creating firewall rules (optional step)..."
  !insertmacro CreateFirewallRules
  
  ; Post-install verification
  !insertmacro LogMessage "Running post-installation verification..."
  !insertmacro PostInstallVerification
  
  !insertmacro LogMessage "Custom installation steps completed"
!macroend

; Hook into installation completion (after all files are installed)
!macro customFinish
  !insertmacro LogMessage "Finalizing installation..."
  !insertmacro FinalizeInstallLog 1
  DetailPrint "Installation completed successfully."
  DetailPrint "Installation log saved to: $INSTDIR\install.log"
!macroend

; Hook into uninstaller initialization
!macro customUnInit
  ; Initialize uninstaller logging
  FileOpen $R9 "$TEMP\ORC_TORRENT_Uninstall.log" w
  FileWrite $R9 "========================================$\r$\n"
  FileWrite $R9 "ORC TORRENT Uninstallation Log$\r$\n"
  FileWrite $R9 "========================================$\r$\n"
  Call un.GetDateTime
  Pop $R8
  FileWrite $R9 "Uninstallation started: $R8$\r$\n"
  FileWrite $R9 "Install Directory: $INSTDIR$\r$\n"
  FileWrite $R9 "----------------------------------------$\r$\n"
  FileClose $R9
  
  DetailPrint "Starting uninstallation..."
  
  ; Terminate running processes before cleanup
  !insertmacro TerminateProcesses
  
  ; Remove firewall rules
  DetailPrint "Removing firewall rules..."
  !insertmacro RemoveFirewallRules
!macroend

; Hook into uninstaller completion
!macro customUnFinish
  ; Remove installer options registry (clean uninstall)
  DeleteRegKey HKCU "Software\ORC TORRENT\Installer"
  
  ; Finalize uninstaller logging
  FileOpen $R9 "$TEMP\ORC_TORRENT_Uninstall.log" a
  FileWrite $R9 "----------------------------------------$\r$\n"
  FileWrite $R9 "Uninstallation completed.$\r$\n"
  Call un.GetDateTime
  Pop $R8
  FileWrite $R9 "Uninstallation ended: $R8$\r$\n"
  FileWrite $R9 "========================================$\r$\n"
  FileClose $R9
  
  DetailPrint "Uninstallation completed."
  DetailPrint "Uninstallation log saved to: $TEMP\ORC_TORRENT_Uninstall.log"
!macroend
