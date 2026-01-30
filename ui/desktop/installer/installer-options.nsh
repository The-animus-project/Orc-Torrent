; installer-options.nsh
; Custom installer options page for user preferences
; Allows users to choose:
; - Desktop shortcut (optional)
; - Set as default torrent client (file associations)

!include "MUI2.nsh"
!include "LogicLib.nsh"
!include "nsDialogs.nsh"

; Variables to store user choices
Var CreateDesktopShortcut
Var SetAsDefaultTorrentClient
Var OptionsPageHandle

; Hook into installer pages - add custom options page before components
!macro customInstallOptions
  ; This will be called by electron-builder to add custom pages
!macroend

; Custom page function - called before installation starts
Function InstallOptionsPage
  ; Initialize defaults
  StrCpy $CreateDesktopShortcut "1"
  StrCpy $SetAsDefaultTorrentClient "1"
  
  ; Try to read from registry (for upgrades)
  ReadRegStr $0 HKCU "Software\ORC TORRENT\Installer" "CreateDesktopShortcut"
  StrCmp $0 "" +2
    StrCpy $CreateDesktopShortcut $0
  
  ReadRegStr $0 HKCU "Software\ORC TORRENT\Installer" "SetAsDefaultTorrentClient"
  StrCmp $0 "" +2
    StrCpy $SetAsDefaultTorrentClient $0
  
  ; Create the dialog
  !insertmacro MUI_HEADER_TEXT "Installation Options" "Choose additional installation options"
  
  nsDialogs::Create 1018
  Pop $OptionsPageHandle
  
  ${If} $OptionsPageHandle == error
    Abort
  ${EndIf}
  
  ; Desktop shortcut checkbox
  ${NSD_CreateCheckbox} 0 10u 100% 10u "Create desktop shortcut"
  Pop $R1
  ; Set default state
  ${If} $CreateDesktopShortcut == "1"
    ${NSD_SetState} $R1 ${BST_CHECKED}
  ${EndIf}
  
  ; Set as default torrent client checkbox
  ${NSD_CreateCheckbox} 0 30u 100% 10u "Set ORC TORRENT as default torrent client"
  Pop $R2
  ; Set default state
  ${If} $SetAsDefaultTorrentClient == "1"
    ${NSD_SetState} $R2 ${BST_CHECKED}
  ${EndIf}
  
  ; Description text
  ${NSD_CreateLabel} 0 50u 100% 40u "This will associate .torrent files and magnet: links with ORC TORRENT.$\nYou can change this later in Windows Settings."
  Pop $R3
  
  nsDialogs::Show
FunctionEnd

; Handle options page leave
Function InstallOptionsPageLeave
  ; Get checkbox states
  ${NSD_GetState} $R1 $0
  ${If} $0 == ${BST_CHECKED}
    StrCpy $CreateDesktopShortcut "1"
  ${Else}
    StrCpy $CreateDesktopShortcut "0"
  ${EndIf}
  
  ${NSD_GetState} $R2 $0
  ${If} $0 == ${BST_CHECKED}
    StrCpy $SetAsDefaultTorrentClient "1"
  ${Else}
    StrCpy $SetAsDefaultTorrentClient "0"
  ${EndIf}
  
  ; Store in registry for later use
  WriteRegStr HKCU "Software\ORC TORRENT\Installer" "CreateDesktopShortcut" $CreateDesktopShortcut
  WriteRegStr HKCU "Software\ORC TORRENT\Installer" "SetAsDefaultTorrentClient" $SetAsDefaultTorrentClient
FunctionEnd

; Macro to create desktop shortcut conditionally
!macro CreateDesktopShortcutConditional
  ; Read user choice from registry (set during options page)
  ReadRegStr $0 HKCU "Software\ORC TORRENT\Installer" "CreateDesktopShortcut"
  StrCmp $0 "" check_default_shortcut
    StrCmp $0 "1" create_shortcut
    Goto skip_shortcut
  
  check_default_shortcut:
    ; Default to creating shortcut if not set
    StrCpy $0 "1"
  
  create_shortcut:
    CreateShortcut "$DESKTOP\${PRODUCT_FILENAME}.lnk" "$INSTDIR\${PRODUCT_FILENAME}.exe"
    !insertmacro LogMessage "Desktop shortcut created"
    Goto end_shortcut
  
  skip_shortcut:
    !insertmacro LogMessage "Desktop shortcut skipped (user choice)"
  
  end_shortcut:
!macroend

; Macro to register file associations conditionally
!macro RegisterFileAssociationsConditional
  ; Read user choice from registry (set during options page)
  ReadRegStr $0 HKCU "Software\ORC TORRENT\Installer" "SetAsDefaultTorrentClient"
  StrCmp $0 "" check_default_assoc
    StrCmp $0 "1" register_associations
    Goto skip_associations
  
  check_default_assoc:
    ; Default to registering if not set
    StrCpy $0 "1"
  
  register_associations:
    ; Register .torrent file association
    WriteRegStr HKCR ".torrent" "" "ORCTorrentFile"
    WriteRegStr HKCR "ORCTorrentFile" "" "BitTorrent File"
    WriteRegStr HKCR "ORCTorrentFile\DefaultIcon" "" "$INSTDIR\resources\icon.ico"
    WriteRegStr HKCR "ORCTorrentFile\shell" "" "open"
    WriteRegStr HKCR "ORCTorrentFile\shell\open\command" "" '"$INSTDIR\${PRODUCT_FILENAME}.exe" "%1"'
    
    ; Register magnet: protocol
    WriteRegStr HKCR "magnet" "" "URL:magnet"
    WriteRegStr HKCR "magnet" "URL Protocol" ""
    WriteRegStr HKCR "magnet\DefaultIcon" "" "$INSTDIR\resources\icon.ico"
    WriteRegStr HKCR "magnet\shell" "" "open"
    WriteRegStr HKCR "magnet\shell\open\command" "" '"$INSTDIR\${PRODUCT_FILENAME}.exe" "%1"'
    
    ; Notify Windows of the changes
    System::Call 'Shell32::SHChangeNotify(i 0x8000000, i 0, i 0, i 0)'
    
    !insertmacro LogMessage "File associations registered (set as default torrent client)"
    Goto end_associations
  
  skip_associations:
    !insertmacro LogMessage "File associations skipped (user choice)"
  
  end_associations:
!macroend
