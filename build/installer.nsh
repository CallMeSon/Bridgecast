; Extra NSIS code for electron-builder (nsis.include in electron-builder.yml).
; Installs the NDI Runtime when it is missing. The runtime is downloaded, never
; bundled. Exit codes of the script: 0 ok, 2 download failed, 3 signature
; invalid, 4 install failed. For 2-4 the user may continue without NDI; silent
; installs (/S) continue without asking (/SD IDYES).
!macro customInstall
  InitPluginsDir
  File "/oname=$PLUGINSDIR\install-ndi-runtime.ps1" "${BUILD_RESOURCES_DIR}\install-ndi-runtime.ps1"
  DetailPrint "Downloading the NDI Runtime..."
  nsExec::ExecToLog '"powershell.exe" -NoProfile -ExecutionPolicy Bypass -File "$PLUGINSDIR\install-ndi-runtime.ps1"'
  Pop $0
  ; "error" (could not start PowerShell) is treated as an install failure.
  StrCmp $0 "error" 0 +2
    StrCpy $0 "4"
  StrCmp $0 "0" ndi_done
  StrCmp $0 "2" ndi_download_failed
  StrCmp $0 "3" ndi_bad_signature
  MessageBox MB_YESNO|MB_ICONEXCLAMATION "The NDI Runtime could not be installed (code $0). Continue installing PPT Share without NDI? The NDI output will not be available until the runtime is installed." /SD IDYES IDYES ndi_done
  Abort
  ndi_download_failed:
  MessageBox MB_YESNO|MB_ICONEXCLAMATION "The NDI Runtime could not be downloaded. Continue installing PPT Share without NDI? The NDI output will not be available until the runtime is installed." /SD IDYES IDYES ndi_done
  Abort
  ndi_bad_signature:
  MessageBox MB_YESNO|MB_ICONEXCLAMATION "The downloaded NDI Runtime does not carry a valid Vizrt signature and was not installed. Continue installing PPT Share without NDI? The NDI output will not be available." /SD IDYES IDYES ndi_done
  Abort
  ndi_done:
!macroend
