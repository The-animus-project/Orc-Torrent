; verification.nsh
; Post-installation verification and daemon binary checksum verification
; Verifies that installation completed successfully and files are intact

!macro PostInstallVerification
  DetailPrint "Performing post-installation verification..."
  !insertmacro LogMessage "Starting post-installation verification"
  
  ; Verify installation directory exists
  ${IfNot} ${FileExists} "$INSTDIR\*.*"
    !insertmacro LogError "Installation directory does not exist: $INSTDIR"
    MessageBox MB_OK|MB_ICONSTOP "Installation verification failed: Installation directory not found."
    Abort
  ${EndIf}
  !insertmacro LogMessage "Installation directory verified: $INSTDIR"
  
  ; Verify main executable exists
  ${IfNot} ${FileExists} "$INSTDIR\ORC TORRENT.exe"
    !insertmacro LogError "Main executable not found: $INSTDIR\ORC TORRENT.exe"
    MessageBox MB_OK|MB_ICONSTOP "Installation verification failed: Main executable not found."
    Abort
  ${EndIf}
  !insertmacro LogMessage "Main executable verified: $INSTDIR\ORC TORRENT.exe"
  
  ; Verify daemon binary exists (check all possible locations)
  StrCpy $R0 ""
  ${If} ${FileExists} "$INSTDIR\resources\bin\orc-daemon.exe"
    StrCpy $R0 "$INSTDIR\resources\bin\orc-daemon.exe"
  ${ElseIf} ${FileExists} "$INSTDIR\bin\orc-daemon.exe"
    StrCpy $R0 "$INSTDIR\bin\orc-daemon.exe"
  ${ElseIf} ${FileExists} "$INSTDIR\orc-daemon.exe"
    StrCpy $R0 "$INSTDIR\orc-daemon.exe"
  ${EndIf}
  
  ${If} $R0 == ""
    !insertmacro LogError "Daemon binary not found in any expected location"
    MessageBox MB_OK|MB_ICONSTOP "Installation verification failed: Daemon binary not found."
    Abort
  ${EndIf}
  !insertmacro LogMessage "Daemon binary verified: $R0"
  
  ; Verify daemon binary is not empty (FileOpen/FileSeek/FileClose - no GetFileSize in NSIS)
  FileOpen $R9 $R0 "r"
  FileSeek $R9 0 END $R1
  FileClose $R9
  ${If} $R1 == 0
    !insertmacro LogError "Daemon binary is empty or invalid (size: 0 bytes)"
    MessageBox MB_OK|MB_ICONSTOP "Installation verification failed: Daemon binary is invalid."
    Abort
  ${EndIf}
  !insertmacro LogMessage "Daemon binary size verified: $R1 bytes"
  
  ; Verify shortcuts were created (if applicable)
  ${If} ${FileExists} "$SMPROGRAMS\ORC TORRENT.lnk"
    !insertmacro LogMessage "Start Menu shortcut verified"
  ${Else}
    !insertmacro LogWarning "Start Menu shortcut not found (may be normal for portable installs)"
  ${EndIf}
  
  ${If} ${FileExists} "$DESKTOP\ORC TORRENT.lnk"
    !insertmacro LogMessage "Desktop shortcut verified"
  ${Else}
    !insertmacro LogWarning "Desktop shortcut not found (may be normal if not requested)"
  ${EndIf}
  
  ; Verify registry entries (if applicable)
  ReadRegStr $R3 HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${UNINSTALL_APP_KEY}" "DisplayVersion"
  ${If} $R3 != ""
    !insertmacro LogMessage "Registry entry verified: Version $R3"
  ${Else}
    !insertmacro LogWarning "Registry entry not found (may be normal for portable installs)"
  ${EndIf}
  
  !insertmacro LogMessage "Post-installation verification completed successfully"
  DetailPrint "Post-installation verification completed successfully."
!macroend

; Macro to verify daemon binary checksum
; This compares the installed binary against an expected checksum
; The checksum should be calculated during build and embedded in the installer
; Expected checksum file: $INSTDIR\resources\bin\orc-daemon.exe.sha256 (or similar location)
!macro VerifyDaemonChecksum
  DetailPrint "Verifying daemon binary checksum..."
  !insertmacro LogMessage "Starting daemon binary checksum verification"
  
  ; Find daemon binary
  StrCpy $R0 ""
  StrCpy $R7 ""  ; Checksum file path
  ${If} ${FileExists} "$INSTDIR\resources\bin\orc-daemon.exe"
    StrCpy $R0 "$INSTDIR\resources\bin\orc-daemon.exe"
    StrCpy $R7 "$INSTDIR\resources\bin\orc-daemon.exe.sha256"
  ${ElseIf} ${FileExists} "$INSTDIR\bin\orc-daemon.exe"
    StrCpy $R0 "$INSTDIR\bin\orc-daemon.exe"
    StrCpy $R7 "$INSTDIR\bin\orc-daemon.exe.sha256"
  ${ElseIf} ${FileExists} "$INSTDIR\orc-daemon.exe"
    StrCpy $R0 "$INSTDIR\orc-daemon.exe"
    StrCpy $R7 "$INSTDIR\orc-daemon.exe.sha256"
  ${EndIf}
  
  ${If} $R0 == ""
    !insertmacro LogError "Cannot verify checksum: Daemon binary not found"
    Goto checksum_done
  ${EndIf}
  
  ; Check if checksum file exists
  ${IfNot} ${FileExists} "$R7"
    !insertmacro LogWarning "Checksum file not found: $R7"
    !insertmacro LogWarning "Skipping checksum verification (checksum file not embedded in installer)"
    Goto checksum_done
  ${EndIf}
  
  ; Calculate SHA256 checksum of installed binary using PowerShell
  DetailPrint "Calculating SHA256 checksum for: $R0"
  
  ; Create temporary PowerShell script to calculate and compare checksum ($$ = literal $ in NSIS)
  FileOpen $R9 "$TEMP\verify_checksum.ps1" w
  FileWrite $R9 '$$binaryPath = "$R0"$\r$\n'
  FileWrite $R9 '$$checksumFile = "$R7"$\r$\n'
  FileWrite $R9 '$\r$\n'
  FileWrite $R9 'try {$\r$\n'
  FileWrite $R9 '    # Calculate hash of installed binary$\r$\n'
  FileWrite $R9 '    $$calculatedHash = (Get-FileHash -Path $$binaryPath -Algorithm SHA256).Hash.ToUpper()$\r$\n'
  FileWrite $R9 '    $\r$\n'
  FileWrite $R9 '    # Read expected hash from file$\r$\n'
  FileWrite $R9 '    $$expectedHash = (Get-Content $$checksumFile -Raw).Trim().ToUpper()$\r$\n'
  FileWrite $R9 '    $\r$\n'
  FileWrite $R9 '    # Compare hashes$\r$\n'
  FileWrite $R9 '    if ($$calculatedHash -eq $$expectedHash) {$\r$\n'
  FileWrite $R9 '        Write-Host "MATCH"$\r$\n'
  FileWrite $R9 '        exit 0$\r$\n'
  FileWrite $R9 '    } else {$\r$\n'
  FileWrite $R9 '        Write-Host "MISMATCH"$\r$\n'
  FileWrite $R9 '        Write-Host "Expected: $$expectedHash"$\r$\n'
  FileWrite $R9 '        Write-Host "Calculated: $$calculatedHash"$\r$\n'
  FileWrite $R9 '        exit 1$\r$\n'
  FileWrite $R9 '    }$\r$\n'
  FileWrite $R9 '} catch {$\r$\n'
  FileWrite $R9 '    Write-Host "ERROR: $$_"$\r$\n'
  FileWrite $R9 '    exit 2$\r$\n'
  FileWrite $R9 '}' 
  FileClose $R9
  
  ; Execute PowerShell script to verify checksum
  ExecWait 'powershell -ExecutionPolicy Bypass -File "$TEMP\verify_checksum.ps1"' $R1
  
  ${If} $R1 == 0
    !insertmacro LogMessage "Checksum verification passed: Binary is valid"
    DetailPrint "Daemon binary checksum verified successfully."
  ${ElseIf} $R1 == 1
    !insertmacro LogError "Checksum verification failed: Binary hash does not match expected value"
    !insertmacro LogError "The daemon binary may be corrupted or modified"
    DetailPrint "WARNING: Daemon binary checksum verification failed!"
    DetailPrint "The binary may be corrupted. Installation will continue, but the daemon may not work correctly."
  ${Else}
    !insertmacro LogWarning "Could not verify checksum (PowerShell error: $R1)"
    !insertmacro LogWarning "Skipping checksum verification"
  ${EndIf}
  
  ; Clean up temporary script
  ${If} ${FileExists} "$TEMP\verify_checksum.ps1"
    Delete "$TEMP\verify_checksum.ps1"
  ${EndIf}
  
  checksum_done:
  !insertmacro LogMessage "Daemon binary checksum verification completed"
!macroend
