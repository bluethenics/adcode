# The assisted installer normally ends on a Finish page. An explicit in-app update
# instead shows its installation progress and reopens ADCode without that extra click.
# electron-builder calls customInstall after files, registry, shortcuts and associations
# have been installed. Use its stock assisted launch function and leave other modes alone.
!macro customInit
  # Versions through 2.4.0 explicitly request /S as well as --force-run. Show the
  # progress page for that first update too; normal install-on-quit has no force-run.
  ${if} ${isUpdated}
  ${andIf} ${isForceRun}
    SetSilent normal
  ${endif}
!macroend

!macro customInstallMode
  # initMultiUser has already resolved the installed scope and directory. Reuse it
  # through the stock install-mode page, including its normal elevation handling.
  ${if} ${isUpdated}
  ${andIf} ${isForceRun}
    ${if} $installMode == "all"
      StrCpy $isForceMachineInstall "1"
    ${else}
      StrCpy $isForceCurrentInstall "1"
    ${endif}
  ${endif}
!macroend

!macro customInstall
  ${if} ${isUpdated}
  ${andIf} ${isForceRun}
  ${andIfNot} ${Silent}
    HideWindow
    # The StartApp macro declares a global variable and the stock install section
    # expands it too. Call the assisted installer's existing function instead.
    Call StartApp
    !insertmacro quitSuccess
  ${endif}
!macroend
