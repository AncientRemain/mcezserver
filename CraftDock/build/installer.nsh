; CraftDock installer hooks.
;
; Replaces electron-builder's default "app is running" check, which force-closes the app and
; would leave Minecraft servers running orphaned. Instead we ask the running CraftDock to stop
; every server cleanly (it saves the worlds) and exit, then continue installing over it.

Var pid

!macro customCheckAppRunning
  ; used by KILL_PROCESS so the installer never matches itself
  System::Call 'kernel32::GetCurrentProcessId() i .r0'
  StrCpy $pid $0
  !insertmacro IS_POWERSHELL_AVAILABLE
  !insertmacro FIND_PROCESS "${APP_EXECUTABLE_FILENAME}" $R0
  ${if} $R0 == 0
    DetailPrint "Stopping your Minecraft servers safely and closing CraftDock..."
    Exec `"$INSTDIR\${APP_EXECUTABLE_FILENAME}" --quit-for-update`
    StrCpy $R1 0
    ${Do}
      Sleep 1000
      IntOp $R1 $R1 + 1
      !insertmacro FIND_PROCESS "${APP_EXECUTABLE_FILENAME}" $R0
      ${If} $R0 != 0
        ${ExitDo}
      ${EndIf}
      ${If} $R1 >= 120
        ${ExitDo}
      ${EndIf}
    ${Loop}
    ${if} $R0 == 0
      ; still running after 2 minutes (e.g. an older CraftDock): close it the normal way
      DetailPrint "$(appClosing)"
      !insertmacro KILL_PROCESS "${APP_EXECUTABLE_FILENAME}" 0
      Sleep 2000
      !insertmacro KILL_PROCESS "${APP_EXECUTABLE_FILENAME}" 1
      Sleep 1000
    ${endIf}
  ${endIf}
!macroend
