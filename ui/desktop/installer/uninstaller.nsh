; uninstaller.nsh
; Custom uninstaller script that handles cleanup tasks
; This is included in the main installer.nsh and executed during uninstallation

; Function to get current date/time string (for uninstaller)
Function un.GetDateTime
  System::Call '*(&i2, &i2, &i2, &i2, &i2, &i2, &i2, &i2) i .r0'
  System::Call 'kernel32::GetLocalTime(i r0)'
  System::Call '*$0(&i2 .r1, &i2 .r2, &i2, &i2 .r3, &i2 .r4, &i2 .r5, &i2 .r6, &i2)'
  
  IntFmt $1 "%04d" $1
  IntFmt $2 "%02d" $2
  IntFmt $3 "%02d" $3
  IntFmt $4 "%02d" $4
  IntFmt $5 "%02d" $5
  IntFmt $6 "%02d" $6
  
  StrCpy $R8 "$1-$2-$3 $4:$5:$6"
  Push $R8
FunctionEnd
