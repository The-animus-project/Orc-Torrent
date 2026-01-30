; firewall.nsh
; Manages Windows Firewall rules for ORC TORRENT daemon
; Creates firewall rules during installation and removes them during uninstallation
; Uses PowerShell New-NetFirewallRule for clean, reliable rule creation

; Constants for firewall rule configuration
!define FIREWALL_RULE_NAME_TCP_IN "Orc Torrent (TCP In 49000)"
!define FIREWALL_RULE_NAME_UDP_IN "Orc Torrent (UDP In 49000)"
!define FIREWALL_RULE_NAME_TCP_OUT "Orc Torrent (TCP Out)"
!define FIREWALL_RULE_NAME_UDP_OUT "Orc Torrent (UDP Out)"
!define LISTEN_PORT "49000"

; Macro to create firewall rules for the daemon
; Creates rules for fixed listen port 49000 (TCP+UDP, inbound+outbound)
; 
; Note: Firewall rule creation requires administrator privileges.
; This is called during installation when UAC is already elevated.
!macro CreateFirewallRules
  DetailPrint "Configuring Windows Firewall rules for Orc Torrent..."
  
  ; Get the daemon executable path
  StrCpy $R0 "$INSTDIR\resources\bin\orc-daemon.exe"
  ${IfNot} ${FileExists} "$R0"
    StrCpy $R0 "$INSTDIR\bin\orc-daemon.exe"
    ${IfNot} ${FileExists} "$R0"
      StrCpy $R0 "$INSTDIR\orc-daemon.exe"
    ${EndIf}
  ${EndIf}
  
  ${IfNot} ${FileExists} "$R0"
    DetailPrint "Warning: Daemon executable not found. Skipping firewall rule creation."
    DetailPrint "  Expected locations:"
    DetailPrint "    $INSTDIR\resources\bin\orc-daemon.exe"
    DetailPrint "    $INSTDIR\bin\orc-daemon.exe"
    DetailPrint "    $INSTDIR\orc-daemon.exe"
    Goto firewall_done
  ${EndIf}
  
  DetailPrint "Creating firewall rules for: $R0"
  DetailPrint "  Listen port: ${LISTEN_PORT} (TCP and UDP)"
  
  ; Create inbound TCP rule for listen port 49000
  DetailPrint "Creating inbound TCP firewall rule (port ${LISTEN_PORT})..."
  nsExec::ExecToLog 'powershell -ExecutionPolicy Bypass -NoProfile -Command "Try { New-NetFirewallRule -DisplayName ''${FIREWALL_RULE_NAME_TCP_IN}'' -Direction Inbound -Action Allow -Program ''$R0'' -Protocol TCP -LocalPort ${LISTEN_PORT} -Profile Any -ErrorAction Stop; Write-Host ''TCP inbound rule created successfully'' } Catch { Write-Host ''Error creating TCP inbound rule: $_''; exit 1 }"'
  Pop $R1
  ${If} $R1 == 0
    DetailPrint "  TCP inbound rule created successfully."
  ${Else}
    DetailPrint "  Warning: Failed to create TCP inbound rule (error: $R1)"
    DetailPrint "  This may require administrator privileges."
  ${EndIf}
  
  ; Create inbound UDP rule for listen port 49000
  DetailPrint "Creating inbound UDP firewall rule (port ${LISTEN_PORT})..."
  nsExec::ExecToLog 'powershell -ExecutionPolicy Bypass -NoProfile -Command "Try { New-NetFirewallRule -DisplayName ''${FIREWALL_RULE_NAME_UDP_IN}'' -Direction Inbound -Action Allow -Program ''$R0'' -Protocol UDP -LocalPort ${LISTEN_PORT} -Profile Any -ErrorAction Stop; Write-Host ''UDP inbound rule created successfully'' } Catch { Write-Host ''Error creating UDP inbound rule: $_''; exit 1 }"'
  Pop $R2
  ${If} $R2 == 0
    DetailPrint "  UDP inbound rule created successfully."
  ${Else}
    DetailPrint "  Warning: Failed to create UDP inbound rule (error: $R2)"
    DetailPrint "  This may require administrator privileges."
  ${EndIf}
  
  ; Create outbound TCP rule (allows daemon to make outbound connections)
  DetailPrint "Creating outbound TCP firewall rule..."
  nsExec::ExecToLog 'powershell -ExecutionPolicy Bypass -NoProfile -Command "Try { New-NetFirewallRule -DisplayName ''${FIREWALL_RULE_NAME_TCP_OUT}'' -Direction Outbound -Action Allow -Program ''$R0'' -Protocol TCP -Profile Any -ErrorAction SilentlyContinue; Write-Host ''TCP outbound rule created or already exists'' } Catch { Write-Host ''Note: TCP outbound rule may already exist'' }"'
  Pop $R3
  ${If} $R3 == 0
    DetailPrint "  TCP outbound rule configured."
  ${Else}
    DetailPrint "  Note: TCP outbound rule may already exist (this is normal)."
  ${EndIf}
  
  ; Create outbound UDP rule (for DHT and peer discovery)
  DetailPrint "Creating outbound UDP firewall rule..."
  nsExec::ExecToLog 'powershell -ExecutionPolicy Bypass -NoProfile -Command "Try { New-NetFirewallRule -DisplayName ''${FIREWALL_RULE_NAME_UDP_OUT}'' -Direction Outbound -Action Allow -Program ''$R0'' -Protocol UDP -Profile Any -ErrorAction SilentlyContinue; Write-Host ''UDP outbound rule created or already exists'' } Catch { Write-Host ''Note: UDP outbound rule may already exist'' }"'
  Pop $R4
  ${If} $R4 == 0
    DetailPrint "  UDP outbound rule configured."
  ${Else}
    DetailPrint "  Note: UDP outbound rule may already exist (this is normal)."
  ${EndIf}
  
  DetailPrint "Firewall rule configuration completed."
  
  firewall_done:
!macroend

; Macro to remove firewall rules during uninstallation
!macro RemoveFirewallRules
  DetailPrint "Removing Windows Firewall rules..."
  
  ; Remove TCP inbound rule
  DetailPrint "Removing TCP inbound firewall rule..."
  nsExec::ExecToLog 'powershell -ExecutionPolicy Bypass -NoProfile -Command "Try { Remove-NetFirewallRule -DisplayName ''${FIREWALL_RULE_NAME_TCP_IN}'' -ErrorAction Stop; Write-Host ''TCP inbound rule removed successfully'' } Catch { Write-Host ''TCP inbound rule not found or already removed'' }"'
  Pop $R0
  ${If} $R0 == 0
    DetailPrint "  TCP inbound rule removed successfully."
  ${Else}
    DetailPrint "  TCP inbound rule not found or already removed."
  ${EndIf}
  
  ; Remove UDP inbound rule
  DetailPrint "Removing UDP inbound firewall rule..."
  nsExec::ExecToLog 'powershell -ExecutionPolicy Bypass -NoProfile -Command "Try { Remove-NetFirewallRule -DisplayName ''${FIREWALL_RULE_NAME_UDP_IN}'' -ErrorAction Stop; Write-Host ''UDP inbound rule removed successfully'' } Catch { Write-Host ''UDP inbound rule not found or already removed'' }"'
  Pop $R1
  ${If} $R1 == 0
    DetailPrint "  UDP inbound rule removed successfully."
  ${Else}
    DetailPrint "  UDP inbound rule not found or already removed."
  ${EndIf}
  
  ; Remove TCP outbound rule
  DetailPrint "Removing TCP outbound firewall rule..."
  nsExec::ExecToLog 'powershell -ExecutionPolicy Bypass -NoProfile -Command "Try { Remove-NetFirewallRule -DisplayName ''${FIREWALL_RULE_NAME_TCP_OUT}'' -ErrorAction Stop; Write-Host ''TCP outbound rule removed successfully'' } Catch { Write-Host ''TCP outbound rule not found or already removed'' }"'
  Pop $R2
  ${If} $R2 == 0
    DetailPrint "  TCP outbound rule removed successfully."
  ${Else}
    DetailPrint "  TCP outbound rule not found or already removed."
  ${EndIf}
  
  ; Remove UDP outbound rule
  DetailPrint "Removing UDP outbound firewall rule..."
  nsExec::ExecToLog 'powershell -ExecutionPolicy Bypass -NoProfile -Command "Try { Remove-NetFirewallRule -DisplayName ''${FIREWALL_RULE_NAME_UDP_OUT}'' -ErrorAction Stop; Write-Host ''UDP outbound rule removed successfully'' } Catch { Write-Host ''UDP outbound rule not found or already removed'' }"'
  Pop $R3
  ${If} $R3 == 0
    DetailPrint "  UDP outbound rule removed successfully."
  ${Else}
    DetailPrint "  UDP outbound rule not found or already removed."
  ${EndIf}
  
  DetailPrint "Firewall rule removal completed."
!macroend
