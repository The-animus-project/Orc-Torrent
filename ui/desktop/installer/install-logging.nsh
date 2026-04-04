; install-logging.nsh
; Provides comprehensive installation logging functionality
; Logs all installation steps, errors, and important events to a log file

!ifndef INSTALL_LOG_FILE
  !define INSTALL_LOG_FILE "$TEMP\ORC_TORRENT_Install.log"
!endif

; Macro to initialize installation logging
!macro InitInstallLog
  ; Create log file with header
  FileOpen $R9 "${INSTALL_LOG_FILE}" w
  FileWrite $R9 "========================================$\r$\n"
  FileWrite $R9 "ORC TORRENT Installation Log$\r$\n"
  FileWrite $R9 "========================================$\r$\n"
  FileWrite $R9 "Installation started: $\r$\n"
  ; Get current date/time
  Call GetDateTime
  Pop $R8
  FileWrite $R9 "$R8$\r$\n"
  FileWrite $R9 "Version: ${VERSION}$\r$\n"
  FileWrite $R9 "Install Directory: $INSTDIR$\r$\n"
  FileWrite $R9 "----------------------------------------$\r$\n"
  FileClose $R9
!macroend

; Macro to write a log entry
; Usage: !insertmacro LogMessage "Your message here"
!macro LogMessage message
  FileOpen $R9 "${INSTALL_LOG_FILE}" a
  FileWrite $R9 "[LOG] ${message}$\r$\n"
  FileClose $R9
  DetailPrint "${message}"
!macroend

; Macro to write an error log entry
; Usage: !insertmacro LogError "Error message here"
!macro LogError message
  FileOpen $R9 "${INSTALL_LOG_FILE}" a
  FileWrite $R9 "[ERROR] ${message}$\r$\n"
  FileClose $R9
  DetailPrint "ERROR: ${message}"
!macroend

; Macro to write a warning log entry
; Usage: !insertmacro LogWarning "Warning message here"
!macro LogWarning message
  FileOpen $R9 "${INSTALL_LOG_FILE}" a
  FileWrite $R9 "[WARNING] ${message}$\r$\n"
  FileClose $R9
  DetailPrint "WARNING: ${message}"
!macroend

; Macro to log command execution
; Usage: !insertmacro LogCommand "Command description" "command.exe" exit_code
!macro LogCommand description command exit_code
  FileOpen $R9 "${INSTALL_LOG_FILE}" a
  FileWrite $R9 "[COMMAND] ${description}$\r$\n"
  FileWrite $R9 "  Command: ${command}$\r$\n"
  FileWrite $R9 "  Exit Code: ${exit_code}$\r$\n"
  FileClose $R9
!macroend

; Macro to finalize installation logging
!macro FinalizeInstallLog success
  FileOpen $R9 "${INSTALL_LOG_FILE}" a
  FileWrite $R9 "----------------------------------------$\r$\n"
  ${If} ${success} == 1
    FileWrite $R9 "Installation completed successfully.$\r$\n"
  ${Else}
    FileWrite $R9 "Installation failed or was cancelled.$\r$\n"
  ${EndIf}
  Call GetDateTime
  Pop $R8
  FileWrite $R9 "Installation ended: $R8$\r$\n"
  FileWrite $R9 "========================================$\r$\n"
  FileClose $R9
  
  ; Copy log to installation directory for easy access
  ${If} ${FileExists} "${INSTALL_LOG_FILE}"
    CopyFiles /SILENT "${INSTALL_LOG_FILE}" "$INSTDIR\install.log"
    ${If} ${FileExists} "$INSTDIR\install.log"
      !insertmacro LogMessage "Installation log saved to: $INSTDIR\install.log"
    ${EndIf}
  ${EndIf}
!macroend

; Function to get current date/time string
Function GetDateTime
  ; Get system time
  System::Call '*(&i2, &i2, &i2, &i2, &i2, &i2, &i2, &i2) i .r0'
  System::Call 'kernel32::GetLocalTime(i r0)'
  System::Call '*$0(&i2 .r1, &i2 .r2, &i2, &i2 .r3, &i2 .r4, &i2 .r5, &i2 .r6, &i2)'
  
  ; Format: YYYY-MM-DD HH:MM:SS
  IntFmt $1 "%04d" $1  ; Year
  IntFmt $2 "%02d" $2  ; Month
  IntFmt $3 "%02d" $3  ; Day
  IntFmt $4 "%02d" $4  ; Hour
  IntFmt $5 "%02d" $5  ; Minute
  IntFmt $6 "%02d" $6  ; Second
  
  StrCpy $R8 "$1-$2-$3 $4:$5:$6"
  Push $R8
FunctionEnd
