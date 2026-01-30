; terminate-processes.nsh
; Gracefully terminates running ORC TORRENT processes before installation/uninstallation
; Uses minimal CPU resources with sleep delays

!macro TerminateProcesses
  ; Check for running ORC TORRENT.exe process
  nsProcess::_FindProcess "ORC TORRENT.exe"
  Pop $R0
  
  IntCmp $R0 0 0 done_ui done_ui
    ; Process is running, attempt graceful shutdown
    DetailPrint "ORC TORRENT.exe is running. Attempting graceful shutdown..."
    
    ; Find the main window and send WM_CLOSE
    FindWindow $R1 "" "ORC TORRENT"
    IntCmp $R1 0 skip_close
      SendMessage $R1 0x0010 0 0 /TIMEOUT=1000
    skip_close:
    
    ; Wait for process to terminate (up to 5 seconds)
    StrCpy $R2 0
    wait_ui_loop:
      IntOp $R2 $R2 + 1
      IntCmp $R2 50 force_ui_terminate
      Sleep 100
      nsProcess::_FindProcess "ORC TORRENT.exe"
      Pop $R0
      IntCmp $R0 0 wait_ui_loop
        ; Process terminated
        DetailPrint "ORC TORRENT.exe terminated gracefully."
        Goto done_ui
    force_ui_terminate:
      DetailPrint "Force terminating ORC TORRENT.exe..."
      nsProcess::_KillProcess "ORC TORRENT.exe"
      Sleep 200
  done_ui:
  
  ; Check for running orc-daemon.exe process
  nsProcess::_FindProcess "orc-daemon.exe"
  Pop $R0
  
  IntCmp $R0 0 0 done_daemon done_daemon
    ; Process is running, attempt graceful shutdown via HTTP API
    DetailPrint "orc-daemon.exe is running. Attempting graceful shutdown..."
    
    ; Try to send shutdown request via HTTP (best effort)
    ; This is optional - if it fails, we'll force terminate
    ExecWait 'powershell -Command "try { Invoke-WebRequest -Uri http://127.0.0.1:8733/admin/shutdown -Method POST -Headers @{\"x-admin-token\"=\"\"} -TimeoutSec 2 -ErrorAction SilentlyContinue } catch {}"' $R3
    
    ; Wait for process to terminate (up to 5 seconds)
    StrCpy $R2 0
    wait_daemon_loop:
      IntOp $R2 $R2 + 1
      IntCmp $R2 50 force_daemon_terminate
      Sleep 100
      nsProcess::_FindProcess "orc-daemon.exe"
      Pop $R0
      IntCmp $R0 0 wait_daemon_loop
        ; Process terminated
        DetailPrint "orc-daemon.exe terminated gracefully."
        Goto done_daemon
    force_daemon_terminate:
      DetailPrint "Force terminating orc-daemon.exe..."
      nsProcess::_KillProcess "orc-daemon.exe"
      Sleep 200
  done_daemon:
  
  ; Final verification - ensure both processes are closed
  Sleep 300
  nsProcess::_FindProcess "ORC TORRENT.exe"
  Pop $R0
  IntCmp $R0 0 0 verify_daemon
    DetailPrint "Warning: ORC TORRENT.exe may still be running."
  verify_daemon:
  nsProcess::_FindProcess "orc-daemon.exe"
  Pop $R0
  IntCmp $R0 0 0 end_terminate
    DetailPrint "Warning: orc-daemon.exe may still be running."
  end_terminate:
!macroend
