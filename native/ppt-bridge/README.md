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
- `{"event":"app","pid","owned"}`: the PowerPoint process the bridge uses; `owned` is true only when the
  bridge launched it (no `POWERPNT.EXE` existed before). Sent once, after creating/attaching the COM object.
- `{"event":"exited"}`: PowerPoint died (RPC disconnected). The bridge exits right after.

Closing stdin is the shutdown signal: shows are closed, audio is stopped, PowerPoint is quit only if the
bridge launched it and no other presentation is open. The bridge force-exits 8 s after stdin closed.

### Hang detection

The reader thread answers `ping` itself, without COM (`PingPolicy.cs`). It does **not** answer when:

- a short command or the position poll has been stuck in COM for more than 1 s;
- `open`/`edit` has run for more than 20 s (a slow `Presentations.Open` is fine, a forever one is not);
- a PowerPoint window known to the bridge (main window, show windows) is hung:
  `IsHungAppWindow` or `SendMessageTimeout(WM_NULL, SMTO_ABORTIFHUNG, 500 ms)` fails.

The app's heartbeat (3 s) then falls back to still images, also when the next deck is being preloaded.
When the app has to stop a helper that does not end after closing stdin (5 s) it kills **only the helper
process**. A PowerPoint that the bridge launched and that hangs is **never killed automatically**: PowerPoint
is one instance per user, so the operator may have opened their own file in it after the bridge started
(`owned` is fixed at launch), and a hung PowerPoint cannot report which presentations it holds. A kill could
destroy unsaved work. After such a hang the operator closes that PowerPoint themselves; the show keeps
running as still images meanwhile. The `app` event (pid, owned) is informational only.

## What `open` does

1. Deletes the `Zone.Identifier` stream of the file (no Protected View).
2. `Presentations.Open(path, ReadOnly: true, Untitled: false, WithWindow: false)`; `DisplayAlerts = ppAlertsNone`
   only around Open / Run / Close, the previous value is always restored (try/finally).
3. `ShowType = ppShowTypeWindow` (= 2; 1 is the full-screen Speaker show), read back and the open fails if it
   is not 2, `ShowPresenterView = false`, `LoopUntilStopped = false`,
   `AdvanceMode = ppSlideShowUseSlideTimings`, `View.PointerType = ppSlideShowPointerAlwaysHidden`.
4. Window size = Canvas in points (a window that cannot be sized fails the open) (`px * 72 / dpi`). The tool-window style (no taskbar, no Alt+Tab, no
   activation) is set, the window goes to the bottom of the Z order (`behind`; the spike decides whether
   it should be off screen instead via `x`/`y`), and the focus goes back to the previous foreground window.
5. Next on the last click of the last shown slide is a no-op (it would end the show).

## PowerPoint ownership

PowerPoint is one process. The bridge sets `ownsApp` only if no `POWERPNT.EXE` existed before it created
the COM object. The bridge never kills a PowerPoint process. A foreign PowerPoint is used and left running;
its own presentations are never closed, its alerts setting, volume and mute state are not changed, and its
sound is neither captured nor changed (`open` replies `audio:"device"`, `setVolume` fails with
`foreignapp`; the app shows "PowerPoint sound plays on this PC's default device only.").

## Audio

`Audio.cs` is isolated; any failure there only means `audio: "fallback"` in the `open` reply.

- Main path: WASAPI process loopback. `ActivateAudioInterfaceAsync` on `VAD\Process_Loopback` with
  `AUDIOCLIENT_ACTIVATION_PARAMS` (`PROCESS_LOOPBACK`, `INCLUDE_TARGET_PROCESS_TREE`, PowerPoint pid) in a
  `VT_BLOB` PROPVARIANT, `IAudioClient.Initialize` with `LOOPBACK | EVENTCALLBACK | AUTOCONVERTPCM` and an
  explicit 48 kHz stereo float format, `IAudioCaptureClient` packets. Needs Windows 10 2004 or later.
- The PCM (interleaved float32 little-endian, 48 kHz, 2 channels, raw, no header) goes to the named pipe
  `\\.\pipe\pptshare-audio-<bridge pid>` (reported as `audioPipe`). While no reader is connected, frames
  are dropped. Task 6 connects the reader.
- Only for a PowerPoint the bridge launched. With the capture running, the local sound is muted only when
  `PPT_BRIDGE_LOCAL_MUTE=1` (off by default until Windows shows that muting the session does not silence the
  loopback capture); `setVolume` is ignored while capturing (the level is applied in the output window).
- Fallback (`audio:"fallback"`, bridge-launched PowerPoint): `setVolume` sets the master volume of the
  PowerPoint audio sessions (`IAudioSessionManager2`, `ISimpleAudioVolume`).
- Whenever the level or mute is changed, the original level and mute state are remembered and written to
  `%LOCALAPPDATA%\Bridgecast\audio-restore.json`. They are put back before the shows are closed on a clean
  shutdown. `ppt-bridge.exe --restore-audio` (one-shot, no COM for PowerPoint itself) restores them for any
  session of the same application that exists; the app runs it at engine start and after an abnormal helper
  exit (crash, hang kill). It can only restore a session that exists; otherwise the entry stays in the file
  (deleted after restore or after 7 days).
