# ppt-bridge

`ppt-bridge.exe` drives the real PowerPoint for the native slide show (spec
`docs/superpowers/specs/2026-10-27-native-slideshow-design.md`, section 2). C#, .NET Framework 4.8
(present on Windows 10/11), PowerPoint through late-bound COM (`dynamic`), no PIA needed.

**Status: compiled on Linux only. It has NOT been run on Windows or against PowerPoint.** Every
behaviour below is written from the PowerPoint object model docs and the spike notes and still has to
be checked on a Windows device (`sample-anim.pptx`: steps, After Previous, trigger, Morph, video,
hidden slide, Prev, kill `POWERPNT.EXE` while live).

## Build

```bash
scripts/build-ppt-bridge.sh        # or: npm run build:bridge
# = dotnet build native/ppt-bridge/PptBridge.csproj -c Release
# output: native/ppt-bridge/bin/Release/net48/ppt-bridge.exe (+ .exe.config)
```

Works on Linux/macOS/Windows with the .NET SDK (reference assemblies come from the NuGet package
`Microsoft.NETFramework.ReferenceAssemblies`). `electron-builder.yml` ships the output as
`resources/ppt-bridge/` (Windows build); in dev the app starts it from the path above.

## Protocol

One JSON object per line on stdin (requests) and stdout (replies, events), UTF-8. stderr is
diagnostics only. Parser: `src/main/slideshow/bridge-protocol.ts`; engine:
`src/main/slideshow/powerpoint-engine.ts`.

| Request | Arguments | Reply (besides `id`, `ok`) |
| --- | --- | --- |
| `open` | `deckId`, `file`, `width`, `height` (px), `dpi` (96), `x`, `y` (px), `behind` (true) | `windowId` (HWND, decimal), `slides`, `audio` (`pipe`/`fallback`), `audioPipe` |
| `next` / `prev` | `deckId` | none; position is reported as an event |
| `goto` | `deckId`, `index` (0-based) | none |
| `close` | `deckId` | none |
| `edit` | `file` (`edit.<ext>`) | none; opens a normal editable window |
| `setVolume` | `volume` 0..1 | `applied` (`session`/`ignored`/`none`) |
| `ping` | none | `busy` |

Failures: `{"id":N,"ok":false,"code":"...","message":"..."}` (codes: `noapp`, `notfound`, `password`,
`open`, `nosession`, `range`, `ended`, `args`, `unknown`, `error`).

Events (no `id`):

- `{"event":"position","deckId","index","step","clicks"}`: `index` is 0-based (`View.CurrentShowPosition - 1`),
  `step` = `View.GetClickIndex()`, `clicks` = `View.GetClickCount()`. Emitted when it changes after a
  command and by a poll every 50 ms (After Previous, triggers, auto-advance; late-bound COM cannot hook
  `SlideShowNextSlide`/`SlideShowNextClick`, so the position is polled and verified after every command).
- `{"event":"error","deckId","message"}`: the show of that deck closed or broke.
- `{"event":"exited"}`: PowerPoint died (RPC disconnected). The bridge exits right after.

Closing stdin is the shutdown signal: shows are closed, audio is stopped, PowerPoint is quit only if the
bridge launched it and no other presentation is open. The bridge force-exits 8 s after stdin closed.

### Hang detection

The reader thread answers `ping` itself. `open` and `edit` may take long and do not stop pings. If any
other command (or the position poll) has been stuck in a COM call for more than 2.5 s, `ping` is *not*
answered, so the app's heartbeat (3 s) falls back to still images. A slow `Presentations.Open` never looks
like a hang.

## What `open` does

1. Deletes the `Zone.Identifier` stream of the file (no Protected View).
2. `Presentations.Open(path, ReadOnly: true, Untitled: false, WithWindow: false)`; `DisplayAlerts = ppAlertsNone`
   (the previous value is restored when the bridge does not quit PowerPoint).
3. `ShowType = ppShowTypeWindow`, `ShowPresenterView = false`, `LoopUntilStopped = false`,
   `AdvanceMode = ppSlideShowUseSlideTimings`, `View.PointerType = ppSlideShowPointerAlwaysHidden`.
4. Window size = Canvas in points (`px * 72 / dpi`). The tool-window style (no taskbar, no Alt+Tab, no
   activation) is set, the window goes to the bottom of the Z order (`behind`; the spike decides whether
   it should be off screen instead via `x`/`y`), and the focus goes back to the previous foreground window.
5. Next on the last click of the last shown slide is a no-op (it would end the show).

## PowerPoint ownership

PowerPoint is one process. The bridge sets `ownsApp` only if no `POWERPNT.EXE` existed before it created
the COM object. It never kills a PowerPoint process. A foreign PowerPoint is used and left running; its
own presentations are never closed. Only `ppt-bridge.exe` itself is ever killed by the app, after stdin was
closed and 5 s passed.

## Audio

`Audio.cs` is isolated; any failure there only means `audio: "fallback"` in the `open` reply.

- Main path: WASAPI process loopback. `ActivateAudioInterfaceAsync` on `VAD\Process_Loopback` with
  `AUDIOCLIENT_ACTIVATION_PARAMS` (`PROCESS_LOOPBACK`, `INCLUDE_TARGET_PROCESS_TREE`, PowerPoint pid) in a
  `VT_BLOB` PROPVARIANT, `IAudioClient.Initialize` with `LOOPBACK | EVENTCALLBACK | AUTOCONVERTPCM` and an
  explicit 48 kHz stereo float format, `IAudioCaptureClient` packets. Needs Windows 10 2004 or later.
- The PCM (interleaved float32 little-endian, 48 kHz, 2 channels, raw, no header) goes to the named pipe
  `\\.\pipe\pptshare-audio-<bridge pid>` (reported as `audioPipe`). While no reader is connected, frames
  are dropped. Task 6 connects the reader.
- With the capture running the real PowerPoint sound is muted every 500 ms through `ISimpleAudioVolume`
  (`PPT_BRIDGE_LOCAL_MUTE=0` turns this off) and `setVolume` is ignored (the level is applied in the output
  window). **Unverified:** whether muting the session also silences the loopback capture.
- Fallback: `setVolume` sets the master volume of the PowerPoint audio sessions (`IAudioSessionManager2`,
  `ISimpleAudioVolume`); the volume is put back to 1.0 on a clean shutdown (Windows remembers it per app).
