; Hooks for the NSIS installer that `tauri build` makes (bundle.windows.nsis.installerHooks).

; The setup window built without its payload, which scripts/build-installer.mjs puts here before
; `tauri build`. If it's missing, WinFynd keeps the stock NSIS uninstaller.
!define WINFYND_UNINSTALL_UI "${__FILEDIR__}\..\target\uninstall-ui.exe"

!macro NSIS_HOOK_POSTINSTALL
  !if /FileExists "${WINFYND_UNINSTALL_UI}"
    SetOutPath "$INSTDIR"
    File "/oname=uninstall-ui.exe" "${WINFYND_UNINSTALL_UI}"
    ; Settings > Apps opens the WinFynd uninstall window instead of the stock wizard.
    WriteRegStr SHCTX "${UNINSTKEY}" "UninstallString" '"$INSTDIR\uninstall-ui.exe" --uninstall'
    WriteRegStr SHCTX "${UNINSTKEY}" "QuietUninstallString" '"$INSTDIR\uninstall.exe" /S'
  !endif
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  ; The uninstall window runs from a temp copy, so this one isn't locked.
  Delete "$INSTDIR\uninstall-ui.exe"
!macroend
