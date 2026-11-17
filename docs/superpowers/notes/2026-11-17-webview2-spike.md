# WebView2 web bridge: spike status (2026-11-17)

The plan's Task 0 gates were **not run as written**: the user chose to implement Tasks 1-9
first and keep the Windows-only checks in `docs/test-checklist.md`. This note records what
was actually measured on the development PC and what is still open. Until the three gates
below are run on the show PC, the field checklist is the release gate for this feature.

## Measured here (Windows 11, WebView2 Evergreen, .NET SDK 8)

- `native/web-bridge` builds (net48, x64; `PlatformTarget=x64` is required or the x86
  `WebView2Loader.dll` fails with 0x8007000B) and hosts a real page: open, nav, title,
  status ready, back/forward flags, zoom, resize, close.
- Input mapping (DevTools protocol, no focus): a normalized position lands exactly on the
  requested CSS pixel at zoom 1, zoom 1.5 and after a window resize; click and typing reach
  a focused field (`val:hi`). The page's CSS viewport is `clientWidth / (dpr * zoom)`.
- Sound: the process-loopback pipe of the browser process delivers ~48k frames/s of
  interleaved float32 stereo from a WebAudio tone page.
- **Mute and capture**: `CoreWebView2.IsMuted = true` leaves 0 non-zero samples on the pipe,
  and muting the audio session of the browser *and every child process* (`ISimpleAudioVolume`)
  does the same. The page on air therefore cannot be muted locally without silencing its
  sound for the outputs. Consequence: the live page also plays on the PC's default device at
  the Windows volume, and deck level/Mute apply only to the output gain. This is a product
  tradeoff, recorded in `docs/test-checklist.md`.

## Gates still open (run on the show PC)

1. **Sign-in**: Canva "Sign in with Google", both the redirect and the popup flow, then
   restart the app and check the session stays. The helper now opens a real popup with
   `window.opener` when the deck is off air and refuses new windows while it is on air.
2. **Capture of an occluded helper window**: the window is always at the bottom of the Z
   order and under the operator window. Verify frames keep arriving while another app covers
   it and while it sits on a second display. If Electron's Windows capture is GDI rather than
   Windows Graphics Capture, this is black on every machine and the plan's fallback is a CDP
   screencast.
3. **Process loopback of the WebView2 browser process** on the show PC (the dev PC showed it
   works; the gate is about a clean install, not this machine).

Also still only checkable there: canvas 2520x1080 / 3840x1080 (window = canvas, no stretch),
minimized window, a display that is turned off, and the Task Manager kill / hang recovery.
