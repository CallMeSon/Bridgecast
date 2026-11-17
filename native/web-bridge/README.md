# web-bridge

Helper that hosts one WebView2 (Microsoft Edge) page window per web deck, so a web deck
renders in a real browser page (Google sign-in works) while the app captures the window.
It is driven over JSON lines on stdin/stdout, the same way `native/ppt-bridge` drives
PowerPoint. Windows only; the app falls back to its Electron page window everywhere else.

## Build

```
npm run build:web-bridge        # scripts/build-web-bridge.sh
npm run build:web-bridge:win    # scripts/build-web-bridge.ps1 (Windows, same output)
```

Output: `native/web-bridge/bin/Release/net48/web-bridge.exe`.

## Start

```
web-bridge.exe --user-data <folder>
```

`<folder>` is the WebView2 user data folder (the app passes
`<userData>/web-profile`). Each profile name becomes a subfolder, so sign-ins survive a
restart and — when the app asks for it — a deck can have its own profile.

## Protocol

One JSON object per line, UTF-8, no BOM. Diagnostics go to stderr.

Requests (the reply carries the same `id`):

| cmd | fields | reply |
| --- | --- | --- |
| `open` | `deckId, url, width, height, x, y, profile, zoom` | `{windowId, browserPid, audioPipe?}` |
| `navigate` | `deckId, url` | `{}` |
| `reload` | `deckId` | `{}` |
| `back` | `deckId` | `{}` |
| `forward` | `deckId` | `{}` |
| `setZoom` | `deckId, zoom` | `{}` |
| `resize` | `deckId, width, height` | `{}` |
| `input` | `deckId, ev` (a `PrepareInput` shape) | `{}` |
| `setMuted` | `deckId, muted` | `{}` |
| `signOut` | `profile` | `{}` |
| `close` | `deckId` | `{}` |
| `ping` | — | `{busy}`; an unanswered ping means the UI thread hangs |

Replies are `{id, ok:true, ...}` or `{id, ok:false, code, message}`.

Events:

- `nav {deckId, url, title, canGoBack, canGoForward, loading, cursor}`
- `status {deckId, status: "loading"|"ready"|"error", message?}`
- `crashed {deckId}`
- `app {pid}` (the WebView2 browser process)
- `exited` (the helper is leaving)

`windowId` is the window handle as a decimal string, like `ppt-bridge` reports it: the app
finds the matching `desktopCapturer` window source `window:<handle>:<n>`.

## Window behavior

The page window is a borderless top-level window with `WS_EX_NOACTIVATE` and no taskbar
button. It is shown behind the operator window (never on the HDMI display) and never takes
focus. Its client area is exactly `width x height` at the screen's DPI (the process is
PerMonitorV2 DPI aware), so the capture is the canvas, not a stretched or letterboxed copy.

## Sound

`open` replies `audioPipe` (a named pipe `\\.\pipe\web-audio-<helper pid>-<browser pid>`) carrying raw PCM:
interleaved float32 little-endian, 48000 Hz, stereo, no header — the same format
`PcmBlocker` in `src/main/slideshow/audio-pipe.ts` reads for PowerPoint. The capture is a
WASAPI process loopback of the WebView2 browser process and its children (`Audio.cs`,
shared with `ppt-bridge`). Frames are dropped while no reader is connected.
