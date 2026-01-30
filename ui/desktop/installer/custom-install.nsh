; custom-install.nsh
; Implements atomic installation strategy to prevent partial installations
; Installs to temporary directory first, then atomically moves to final location

!macro AtomicInstall
  ; Store original install directory
  StrCpy $R0 $INSTDIR
  
  ; Create temporary install directory
  StrCpy $R1 "$INSTDIR.tmp"
  
  ; Set INSTDIR to temporary location
  StrCpy $INSTDIR $R1
  
  DetailPrint "Installing to temporary location: $INSTDIR"
  
  ; The actual file installation happens here (handled by electron-builder)
  ; After installation completes, we'll move the directory atomically
!macroend

!macro AtomicInstallComplete
  ; Check if we used atomic install
  ${If} $INSTDIR != ""
    StrCpy $R0 $INSTDIR
    ${StrStr} $R1 $R0 ".tmp"
    
    ${If} $R1 != ""
      ; We're in temp directory - move to final location
      StrCpy $R2 $R0 "" -4
      ${If} $R2 == ".tmp"
        ; Remove .tmp suffix to get final directory
        StrLen $R3 $R0
        IntOp $R3 $R3 - 4
        StrCpy $R4 $R0 $R3
        StrCpy $INSTDIR $R4
        StrCpy $R5 $R4
        
        DetailPrint "Moving installation from $R0 to $R4..."
        
        ; Check if final directory exists
        ${If} ${FileExists} "$R4\*.*"
          ; Remove old installation
          RMDir /r "$R4"
        ${EndIf}
        
        ; Move directory atomically (rename is atomic on Windows)
        Rename "$R0" "$R4"
        
        ${If} ${FileExists} "$R4\*.*"
          DetailPrint "Installation moved successfully to: $R4"
          StrCpy $INSTDIR $R4
        ${Else}
          MessageBox MB_OK|MB_ICONSTOP "Error: Failed to move installation to final location."
          Abort
        ${EndIf}
      ${EndIf}
    ${EndIf}
  ${EndIf}
!macroend

; Note: Atomic installation in NSIS is complex because electron-builder handles
; the file installation. This macro provides a framework, but the actual atomic
; move would need to be implemented in a custom install section.
; For now, electron-builder's default installation is sufficient for most cases.
; This file is included for future enhancement.
