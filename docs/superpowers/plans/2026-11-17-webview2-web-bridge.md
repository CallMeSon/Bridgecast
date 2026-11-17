# WebView2 Web Bridge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Web decks render in a real WebView2 (Edge) page hosted by a C# helper, so Google sign-in works, while the output pipeline (StreamLayer, HOLD, ready gate) stays as it is.

**Architecture:** A new `native/web-bridge` helper (C#, WebView2, one top-level window per web deck) is driven over JSON lines, the same way `native/ppt-bridge` drives PowerPoint. Its window is captured with `desktopCapturer` into `StreamLayer` (like the native slideshow) and its sound reaches the outputs through a named pipe and the AudioWorklet (like PowerPoint sound). `WebHost` gets a backend interface: the WebView2 backend on Windows, the current Electron `BrowserWindow` backend as fallback (Linux dev, e2e, helper missing).

**Tech Stack:** Electron + TypeScript (Vitest, Playwright), C# WebView2 helper (`Microsoft.Web.WebView2`), reference code in `C:\stagecast\src\Stagecast.Rendering` (`PageTab.cs`, `RenderEngine.cs`, `RenderEngine.Recovery.cs`, `Capture\FrameCapturer.cs`, `Audio\BrowserAudioCapture.cs`, `Audio\ProcessLoopbackCapture.cs`).

**Spec:** `docs/superpowers/specs/2026-10-27-web-source-design.md` (behavior to keep), `docs/superpowers/specs/2026-10-27-native-slideshow-design.md` (the capture + sound pattern this plan copies). No new spec: this plan is a backend swap, not new product behavior.

## Global Constraints

- Windows is the shipping platform; the helper runs only on Windows. Development is on Linux: everything outside the helper must also run with the Electron fallback and a fake helper.
- Rule everywhere: **never black, never desktop.** Helper down, window lost or capture down means HOLD (last good frame), then the snapshot PNG of the same deck.
- `persist:web` sign-ins must survive the switch: the WebView2 profile folder is under the app data dir (`<userData>/web-profile/default`), never under the install dir.
- The helper never kills a process it did not start. It closes only its own WebView2 browser process tree through `CoreWebView2Environment`.
- No new IPC channel without adding it to `src/shared/ipc.ts` first, then `src/main/index.ts`, then `src/preload/index.ts`. Validate senders with `appHandle` / `frameSenderAllowed`.
- The helper window is created behind other windows on the operator display, never on the HDMI output display, and never steals focus (same rules as `ppt-bridge` `open` with `behind: true`).
- `npm run typecheck`, `npm test` and `npm run lint` add no new errors (8 known lint errors stay at 8). Commits: `git -c user.name="Gerson Sebastian" -c user.email="sebastiangerson24@gmail.com" commit ...`, no Claude attribution, stage only your own files.
- Windows-only behavior cannot be verified on Linux: say so in the task result and add it to `docs/test-checklist.md`.

## Review Focus

- Google sign-in: the sign-in page opens in a popup or redirect; it must stay in the same WebView2 profile and finish back on the deck page.
- Helper killed or hung while the deck is on air: output holds the last frame, never black, and the helper restarts without operator action.
- Helper window covered by another app, minimized by the operator, or on a display that is turned off: capture must still deliver frames (or HOLD), and the operator sees a warning.
- A page that plays sound in an iframe or opens several audio sessions: loopback must capture the whole WebView2 browser process, and Mute / deck volume must still apply.
- Canvas change (e.g. 2520x1080) while a page is open: window size follows the canvas and the capture does not stretch or letterbox.

---

### Task 0: Spike gate (Windows, manual, decides go / no-go)

**Files:**
- Create: `docs/superpowers/notes/2026-11-17-webview2-spike.md`
- Create (throwaway, not committed): a scratch WinForms app with one `WebView2` control

**Interfaces:**
- Produces: a yes/no answer to each gate below, recorded in the note. Tasks 1-9 start only if gates 1-3 are yes.

- [ ] **Step 1:** Build a scratch WebView2 window (net48 or net8-windows, any) with a persistent `UserDataFolder`. Gate 1: sign in to a Google account through a site's "Sign in with Google" (Canva), restart the app, still signed in.
- [ ] **Step 2:** Gate 2: from the existing Electron app, `desktopCapturer.getSources({ types: ['window'] })` lists the scratch window, and a `getUserMedia` capture of it keeps delivering frames when another window covers it and when it sits on a second display.
- [ ] **Step 3:** Gate 3: process-loopback capture of the WebView2 browser process id (`CoreWebView2.BrowserProcessId`, see `ProcessLoopbackCapture.cs`) records a playing YouTube page and nothing else.
- [ ] **Step 4:** Write the three results, the Windows build, the WebView2 runtime version and any surprise in the note. Commit the note only.

If gate 1 fails: stop and report; the plan does not apply. If gate 2 fails: stop and report; fall back to CDP screencast and re-plan.

### Task 1: Helper skeleton and protocol

**Files:**
- Create: `native/web-bridge/WebBridge.csproj`, `Program.cs`, `Bridge.cs`, `Json.cs`, `README.md`
- Modify: `package.json` (script `build:web-bridge`), `scripts/` (build script like `build-ppt-bridge.sh`), `.gitignore` (bin/obj)

**Interfaces:**
- Produces: stdin/stdout JSON-lines protocol (one object per line, UTF-8, stderr diagnostics), replies `{id, ok, ...}` or `{id, ok:false, code, message}`, events `{event, ...}`.
- Requests: `open {deckId, url, width, height, x, y, profile: "default"|"<id>", zoom}` → `{windowId, browserPid}`; `navigate {deckId, url}`; `reload`, `back`, `forward {deckId}`; `setZoom {deckId, zoom}`; `resize {deckId, width, height}`; `input {deckId, ev}` (same shape as `PrepareInput` in `src/shared/web.ts`); `setMuted {deckId, muted}`; `signOut {profile}`; `close {deckId}`; `ping`.
- Events: `nav {deckId, url, title, canGoBack, canGoForward, loading, cursor}`, `status {deckId, status: "loading"|"ready"|"error", message?}`, `crashed {deckId}`, `app` (diagnostic), `exited`.

- [ ] **Step 1:** Create the project mirroring `native/ppt-bridge/PptBridge.csproj`; reference `Microsoft.Web.WebView2` and `Microsoft.NETFramework.ReferenceAssemblies` so it builds on Linux with `dotnet build`.
- [ ] **Step 2:** Implement the line reader/writer and a handler table; `ping` replies `{ok:true}` from a thread that is not the UI thread (the manager's heartbeat must detect a hung UI thread, copy the PingPolicy idea from `native/ppt-bridge/PingPolicy.cs`).
- [ ] **Step 3:** Run `npm run build:web-bridge`; expected: builds on Linux, output `native/web-bridge/bin/Release/<tfm>/web-bridge.exe`.
- [ ] **Step 4:** Commit.

### Task 2: WebView2 page window in the helper

**Files:**
- Modify: `native/web-bridge/Bridge.cs`
- Create: `native/web-bridge/PageWindow.cs`, `native/web-bridge/Profiles.cs`

**Interfaces:**
- Consumes: protocol of Task 1.
- Produces: `PageWindow` (borderless top-level window, `WS_EX_NOACTIVATE`, placed behind others at `x,y`, client size exactly `width x height` at 96 dpi, DPI-aware manifest) hosting one `WebView2`; `Profiles.Folder(profile)` returns `<userData>/web-profile/<default|id>`; the user data dir comes from the `--user-data` argument.

- [ ] **Step 1:** Implement `open`, `navigate`, `reload`, `back`, `forward`, `setZoom`, `resize`, `close` on the UI thread. Autoplay: environment argument `--autoplay-policy=no-user-gesture-required`.
- [ ] **Step 2:** Popups (`NewWindowRequested`): navigate the same WebView2 to the target and set `e.Handled = true` (Stagecast `RenderEngine.cs:538` does this); Google sign-in must still work (checked in Task 0 gate 1).
- [ ] **Step 3:** Emit `nav` and `status` events from `NavigationStarting/Completed`, `SourceChanged`, `DocumentTitleChanged`, `CursorChanged`; emit `crashed` on `ProcessFailed` and recover the way `RenderEngine.Recovery.cs` does (reload after 1 s, give up to `status:error` after repeated crashes).
- [ ] **Step 4:** Implement `input`: translate mouse, wheel and key events with `CoreWebView2CompositionController.SendMouseInput` or `ExecuteScript`-free native input (match what `src/main/web/policy.ts` `validatePrepareInput` already checks; coordinates are 0..1 of the preview).
- [ ] **Step 5:** Implement `signOut` (`Profile.ClearBrowsingDataAsync` for cookies and site data) and `setMuted` (`CoreWebView2.IsMuted`).
- [ ] **Step 6:** Build; commit. Manual Windows check goes into `docs/test-checklist.md` (Task 9).

### Task 3: Helper sound pipe

**Files:**
- Create: `native/web-bridge/Audio.cs`

**Interfaces:**
- Produces: `open` also replies `audioPipe` (named pipe path) carrying raw PCM, interleaved float32 little-endian, 48 kHz, stereo, no header, exactly what `PcmBlocker` in `src/main/slideshow/audio-pipe.ts` expects.

- [ ] **Step 1:** Check whether `native/ppt-bridge/Audio.cs` already contains a process-agnostic pipe writer; if yes, share it (linked file) and add only process loopback of `browserPid`; if not, port `ProcessLoopbackCapture.cs` from Stagecast.
- [ ] **Step 2:** Capture the whole WebView2 browser process tree of the profile (include child render/GPU processes' audio through process-loopback include-tree mode); resample/convert to the PCM format above.
- [ ] **Step 3:** Pipe must tolerate the reader connecting late and reconnecting; write nothing (silence is the reader's job) when no page plays.
- [ ] **Step 4:** Build; commit.

### Task 4: Main process client and engine

**Files:**
- Modify: `src/main/slideshow/bridge-protocol.ts` (widen `BridgeCmd` and `BridgeEvent` type unions, or generalize `BridgeClient` over a command type; existing tests stay green)
- Create: `src/main/web/web-engine.ts`, `src/main/web/web-engine.test.ts`, `src/main/web/fake-web-engine.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface WebPageEngine {
    open(deckId: string, o: { url: string; canvas: Canvas; zoom: number; profile: string }): Promise<{ windowId: string; audioPipe: string }>
    navigate(deckId: string, url: string): Promise<void>
    reload(deckId: string): Promise<void>
    back(deckId: string): Promise<void>
    forward(deckId: string): Promise<void>
    setZoom(deckId: string, zoom: number): Promise<void>
    resize(deckId: string, canvas: Canvas): Promise<void>
    input(deckId: string, ev: PrepareInput): void
    setMuted(deckId: string, muted: boolean): Promise<void>
    signOut(profile: string): Promise<void>
    close(deckId: string): Promise<void>
    ping(): Promise<void>
    on(ev: 'nav', cb: (s: WebNavState) => void): void
    on(ev: 'status', cb: (s: { deckId: string; status: WebStatus; message?: string }) => void): void
    on(ev: 'crashed' | 'exited', cb: () => void): void
    shutdown(): Promise<void>
  }
  ```
  `WebBridgeEngine` (spawns `web-bridge.exe`, mirrors `powerpoint-engine.ts`: start on first `open`, restart after exit) and `FakeWebEngine` (in-memory, scriptable events, `PPT_ENGINE_FAKE=1` selects it).

- [ ] **Step 1:** Write failing tests for `WebBridgeEngine` against a fake process (request/reply mapping, `nav` events become `WebNavState`, bridge exit rejects pending requests with a clear message), same style as `powerpoint-engine.test.ts`.
- [ ] **Step 2:** Run `npx vitest run src/main/web/web-engine.test.ts`; expected: FAIL.
- [ ] **Step 3:** Implement `WebBridgeEngine` and `FakeWebEngine`.
- [ ] **Step 4:** Run the test and `npx vitest run src/main/slideshow`; expected: PASS.
- [ ] **Step 5:** Commit.

### Task 5: WebHost backend interface (the risky refactor)

**Files:**
- Modify: `src/main/web/web-host.ts` (763 lines; split by responsibility while doing this, e.g. `electron-page-backend.ts`)
- Create: `src/main/web/page-backend.ts`, `src/main/web/webview2-backend.ts`, `src/main/web/page-backend.test.ts`
- Modify: `src/main/web/host-rules.ts` only if a pure rule needs to move

**Interfaces:**
- Consumes: `WebPageEngine` (Task 4).
- Produces: `PageBackend` used by `WebHost` for what it does to a page today: `load(deckId, url)`, `reload`, `back`, `forward`, `setZoom`, `resize(canvas)`, `input`, `key`, `snapshot(deckId): Promise<Buffer>`, `captureSource(deckId, requester): Promise<string>`, `close`. `ElectronPageBackend` keeps today's behavior unchanged; `WebView2PageBackend` wraps `WebPageEngine`. Selection in `src/main/index.ts`: WebView2 on `process.platform === 'win32'` when `web-bridge.exe` exists and `PPT_WEB_BACKEND !== 'electron'`.

- [ ] **Step 1:** Write characterization tests for the pure decisions that stay in `host-rules.ts` / `policy.ts` and a contract test (`page-backend.test.ts`) that both backends satisfy using `FakeWebEngine` and a fake Electron page.
- [ ] **Step 2:** Extract `ElectronPageBackend` with no behavior change; run `npm test` and `npm run test:e2e:web`; expected: all PASS as before.
- [ ] **Step 3:** Implement `WebView2PageBackend`. `captureSource` returns `slideshowSourceId(windowId, desktopCapturer.getSources)` from `src/main/slideshow/capture.ts`; `snapshot` captures the helper window with `desktopCapturer` thumbnail or asks the helper (decide in the task; the snapshot must exist for the "never black" fallback).
- [ ] **Step 4:** HOLD rules, ready gate (`frameSeen`), `captureEnded`, Reload/Back/Forward/Edit URL "HOLD first, then navigate" behave identically on both backends (same tests).
- [ ] **Step 5:** Commit after each of steps 2 and 4.

### Task 6: Capture and sound wiring in the renderer path

**Files:**
- Modify: `src/main/index.ts`, `src/shared/ipc.ts`, `src/preload/index.ts`, `src/renderer/src/stream*.ts`, `src/renderer/src/web-pages.ts`
- Modify: `src/main/slideshow/audio-pipe.ts` (accept a pipe name for a web deck, not only the PowerPoint pipe)

**Interfaces:**
- Consumes: `PageBackend.captureSource`, helper `audioPipe`.
- Produces: the output stream source for a web deck is the helper window (`chromeMediaSource: 'desktop'` with the id from `slideshowSourceId`) instead of tab capture; web sound goes through the same `OutputAudio` gain node with deck volume x master volume.

- [ ] **Step 1:** Failing test (`audio-pipe.test.ts` style): a web deck pipe name produces blocks to the same sink as the slideshow pipe, and switching decks stops the old reader.
- [ ] **Step 2:** Make the renderer treat a web stream from WebView2 as a `StreamLayer` source identical to a native slideshow stream; no change to `outputSource` precedence.
- [ ] **Step 3:** Mute / unmute and Sound settings reach the helper through `setMuted`; exactly one window plays the sound on this PC (unchanged rule).
- [ ] **Step 4:** Run `npm run typecheck && npm test`; expected: PASS. Commit.

### Task 7: Prepare window, sessions and sign-out

**Files:**
- Modify: `src/main/web/prepare-window.ts`, `src/renderer/src/PrepareView.tsx` (only if the preview source changes), `src/main/library.ts` (profile id per web deck, optional)
- Test: `src/main/web/prepare-window.test.ts`

**Interfaces:**
- Produces: Prepare preview shows the same capture as the output (cursor type from the `nav` event), address bar and Back/Forward/Reload drive the helper; "Sign out" calls `signOut`; optional per-deck separate profile (`DeckMeta.web.profile?: string`, missing = shared `default`).

- [ ] **Step 1:** Failing test: input events from the Prepare window are validated (`validatePrepareInput`) and forwarded to `WebPageEngine.input` only for the deck being prepared.
- [ ] **Step 2:** Wire address / zoom / sign-out; keep error text "Enter a web address that starts with https://." only for refused input (search fallback already added in `sanitizeWebUrl`).
- [ ] **Step 3:** Run `npm test`; commit.

### Task 8: Resilience

**Files:**
- Modify: `src/main/web/webview2-backend.ts`, `src/main/slideshow/manager.ts` pattern copied (not edited) for a `WebEngineSupervisor` in `src/main/web/web-engine-supervisor.ts`
- Test: `src/main/web/web-engine-supervisor.test.ts`

**Interfaces:**
- Produces: heartbeat (1000 ms ping, 3000 ms = hung) → HOLD every on-air web deck, restart the helper in the background, reopen the pages; `ready()` false while the helper is down or has fallen back to the Electron backend.

- [ ] **Step 1:** Failing tests with fake timers: hung ping → HOLD + restart; restart success → pages reopened at their last URL; three failures → fall back to `ElectronPageBackend` for the session and tell the operator once.
- [ ] **Step 2:** Implement the supervisor.
- [ ] **Step 3:** `npm test`; commit.

### Task 9: Packaging, checklist, end-to-end

**Files:**
- Modify: `electron-builder.yml` (ship `resources/web-bridge/`), `docs/test-checklist.md`, `CLAUDE.md` (Commands / Architecture lines for the new helper and `PPT_WEB_BACKEND`), `README.md`
- Create: `e2e/web-bridge.mjs`, script `test:e2e:web-bridge` (FakeWebEngine path, add to `test:e2e:all`)

- [ ] **Step 1:** Packaging: helper output copied to `resources/web-bridge/`; the app checks for the WebView2 Evergreen runtime at start and, when missing, uses the Electron backend with a visible one-line notice.
- [ ] **Step 2:** E2E with `FakeWebEngine`: add a web deck, take it, navigate, kill the fake engine, assert HOLD and recovery.
- [ ] **Step 3:** Add Windows field checks to `docs/test-checklist.md`: Google sign-in through Canva survives restart; page covered by another window still outputs; sound reaches HDMI and OMT; helper killed with Task Manager while on air; canvas 2520x1080.
- [ ] **Step 4:** Run `npm run typecheck && npm test && npm run test:e2e:web && npm run test:e2e:web-bridge`; expected: PASS. Commit.
