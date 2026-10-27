# OMT Output Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Program (picture and, by choice, sound) is sent over the LAN as an Open Media Transport source that vMix 29+ and OBS 31+ (omtplugin) can receive, independent of HDMI.

**Architecture:** `OmtOutput` in main owns a hidden offscreen window rendering `#/output?role=omt` at Canvas size. Its `paint` frames go to a worker thread that owns the OMT sender (libomt through `koffi`), keeps its own frame clock, and repeats the latest frame. Sound reaches the worker from the output renderer through an AudioWorklet tap and a `MessagePort`.

**Tech Stack:** Electron 45 offscreen rendering, Node `worker_threads`, `koffi` (FFI), libomt + libvmx (MIT, prebuilt for Windows, built from source on Linux), Web Audio AudioWorklet, Vitest, Playwright smoke test.

**Spec:** `docs/superpowers/specs/2026-10-27-omt-output-design.md` (depends on `2026-10-27-canvas-audio-levels-design.md`)

## Preconditions

- The canvas/audio-levels plan (`docs/superpowers/plans/2026-10-27-canvas-audio-levels.md`) is fully merged: `ProgramState.canvas`, `OutputAudio`, `AudioSection`, `outputGain` exist.
- `git status` shows no changes in `package.json` / `package-lock.json`. If it does, stop and ask the user to commit or discard them first (Task 4 adds `koffi`).

## Global Constraints

- UI copy is English, exact strings from the spec: `OMT could not start: its library is missing. Reinstall PPT Share.`, `OMT could not start. Close other apps that send OMT, then turn OMT off and on.`, `OMT is dropping frames. Set the frame rate to 30.`, `No receiver yet. If vMix or OBS can't find PPT Share, allow PPT Share in Windows Firewall (Private networks) or add the address manually.`, `OMT sound is unavailable; sound plays on this PC only.`, `Receivers will lose the OMT picture for about a second. Change it now?`
- Settings defaults: `omt = { enabled: false, name: 'PPT Share', fps: 30 }`, `audio.route = 'local'`. Invalid `fps` → 30, empty/invalid `name` → `'PPT Share'`, unknown `route` → `'local'`. Name: trimmed, at most 64 characters, control characters removed.
- Video frames: `OMTCodec_BGRA` (`0x41524742`), stride `width*4`, no alpha flag, size = `ProgramState.canvas`. Audio: `OMTCodec_FPA1` (`0x31415046`), float planar, 48000 Hz, 2 channels.
- Black frames until the offscreen renderer sends `output:ready`; during a renderer restart the worker repeats the last good frame, never black.
- Restart delay 1000 ms (`RESTART_DELAY_MS`, as HDMI). Worker: 3 failures within 60 s → status `error`, no more retries until OMT is turned off and on.
- Drop warning: at 60 fps, more than 10 % of frames dropped over 10 s. No-receiver hint after 15 s with 0 connections.
- Exactly one window plays local sound: the HDMI window while its status is `showing`, otherwise the OMT window while OMT runs.
- Never block the main process with frame work: frame bytes are transferred (not copied twice) to the worker; encoding happens in the worker.
- Check Context7 before using: Electron offscreen rendering / `paint` / `setFrameRate`, `MessageChannelMain`, electron-vite worker entry (`?modulePath`), `koffi` struct/pointer API, AudioWorklet.
- UI task: load `impeccable:impeccable` first, follow `DESIGN.md` / `PRODUCT.md`.
- Commit with `git -c user.name="Gerson Sebastian" -c user.email="sebastiangerson24@gmail.com" commit ...`, message ending `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`. Never stage unrelated files (`docs/superpowers/plans/2026-10-27-canva-import.md`, `*.tsbuildinfo`).
- A task that fails more than 3 times (including on Opus) stops; report task, file, command and error to the user.

## Review Focus

1. OMT on while HDMI is off or unplugged: picture and (route `omt`/`both`) sound still flow, and local sound comes from the OMT window exactly once. Test in Task 3 and Task 9.
2. Canvas or fps changed while receivers are connected: confirm first; after the change frames have the new size. Test in Task 6 and Task 9.
3. libomt missing (fresh dev machine, broken install): the switch shows the library message and HDMI keeps working. Test in Task 5.
4. A slide that never changes for minutes: frames keep flowing at the set fps (receivers do not time out). Test in Task 2.
5. App quit while sending: `omt_send_destroy` runs after the clock stopped, no crash on exit. Test in Task 5.

---

## File Structure

- `src/shared/settings.ts` (+ `OmtSettings`, `sanitizeOmt`, `AudioSettings.route`), `src/shared/omt.ts` (status type, copy, `omtBadge`, `audioPlan`, `restartAllowed`, `dropWarning`)
- `src/main/omt/frame-clock.ts`, `src/main/omt/binding.ts` (interface + `koffi` implementation + library path), `src/main/omt/fake-binding.ts`, `src/main/omt/sender.ts` (logic used by the worker), `src/main/omt/worker.ts` (thread entry), `src/main/omt-output.ts`
- `src/renderer/src/omt-tap.worklet.ts` (AudioWorklet processor), changes in `output-audio.ts`, `OutputView.tsx`, `main.tsx` routing
- `src/renderer/src/components/OmtSection.tsx`, `AudioSection.tsx`, `Header.tsx`, `OutputMenu.tsx`
- `electron-builder.yml`, `electron.vite.config.ts`, `package.json` (`koffi` in `dependencies`)
- `e2e/smoke.mjs`, `PRODUCT.md`, `docs/test-checklist.md`, `docs/superpowers/specs/2026-10-06-ppt-share-design.md`, `docs/superpowers/notes/omt-spike.md`

---

### Task 1: Spike (throwaway code, Linux part by agent, Windows part by the user)

**Files:**
- Create: `docs/superpowers/notes/omt-spike.md` (results only; spike code lives in the scratchpad or `~/omt-spike/`, never committed)

- [ ] **Step 1: Build libomt on Linux.** `sudo apt install dotnet-sdk-8.0 clang`; clone `openmediatransport/libvmx`, `libomtnet`, `libomt` side by side into `~/omt-src/`; run each `build/buildlinuxx64.sh`. Expected: `libomt.so` and `libvmx.so` exist. Record their paths.
- [ ] **Step 2: Send from Electron.** Small Electron script: offscreen `BrowserWindow` 1920×1080 showing a moving gradient, `paint` → `koffi` → `omt_send_create('PPT Share Spike', quality)` / `omt_send`. A second script receives with `omt_receive_create` on the sender address and counts frames for 10 s. Expected: about 30/60 frames per second received, correct size.
- [ ] **Step 3: Measure** CPU of main + worker at 30 and 60 fps, 1920×1080 and 3840×1080; whether `paint` stops on a static page (it should, the clock repeats). Write numbers to the notes file.
- [ ] **Step 4: Optional OBS check** (needs OBS 31+, installed is 30.0.2): ask the user whether to upgrade OBS and build `omtplugin`; if yes, confirm the source appears in OBS.
- [ ] **Step 5: Windows checklist for the user** in the notes file: prebuilt `libomt.dll`/`libvmx.dll` from the `libomtnet` releases, run the same scripts, vMix 29+ and OBS 31+ see the source, firewall prompt text, CPU at 30/60 fps on the event laptop, Resolume with the FFGL plugin (best effort).
- [ ] **Step 6: Gate.** Linux send+receive works → commit the notes (`docs: OMT spike results`). Stop and ask the user to run the Windows checklist; continue only when they report it works with acceptable CPU. If FFI is too slow, stop and report (the spec then switches to an N-API addon).

### Task 2: Settings, shared OMT helpers, frame clock

**Files:**
- Create: `src/shared/omt.ts`, `src/shared/omt.test.ts`, `src/main/omt/frame-clock.ts`, `src/main/omt/frame-clock.test.ts`
- Modify: `src/shared/settings.ts`, `src/main/settings.ts`, `src/main/settings.test.ts`

**Interfaces:**
- Produces:
  - `interface OmtSettings { enabled: boolean; name: string; fps: 30 | 60 }`, `DEFAULT_OMT`, `sanitizeOmt(raw: unknown): OmtSettings`; `Settings.omt`.
  - `type AudioRoute = 'local' | 'omt' | 'both'`; `AudioSettings.route`, sanitized in `sanitizeAudio`.
  - `interface OmtStatus { state: 'off' | 'starting' | 'running' | 'error'; connections: number; address: string | null; message?: string; warning?: 'drops' | 'no-receivers' | 'no-sound' }`
  - `restartAllowed(failures: number[], now: number): boolean` (false when 3 timestamps fall within the last 60 000 ms)
  - `dropWarning(samples: { sent: number; dropped: number; at: number }[], fps: 30 | 60, now: number): boolean`
  - `class FrameClock` in `frame-clock.ts`: `constructor(fps: number, send: (f: Frame) => void, timers = { setInterval, clearInterval })`; `push(f: Frame): void` (latest-wins slot; overwriting an unsent frame counts one drop); `start(): void`; `stop(): void`; `stats(): { sent: number; dropped: number }`. Each tick sends the slot frame, or repeats the last sent one. `type Frame = { width: number; height: number; data: ArrayBuffer }`.

- [ ] **Step 1: Write failing tests**: `sanitizeOmt` (defaults, fps 45 → 30, name `'  '` → `'PPT Share'`, 80-char name cut to 64, `'\u0007x'` → `'x'`); `route` unknown → `'local'`; settings without `omt` load defaults; `restartAllowed` with 2 and 3 failures inside 60 s and 3 spread over 2 min; `dropWarning` true at 60 fps with 11 % drops over 10 s, false at 30 fps, false with 9 %; `FrameClock` with fake timers: two pushes before a tick → one sent, one dropped; no push for 5 ticks → last frame sent 5 times; `stop()` stops sending.
- [ ] **Step 2: Run** `npx vitest run src/shared/omt.test.ts src/main/omt/frame-clock.test.ts src/main/settings.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** as listed.
- [ ] **Step 4: Run** the same command and `npm run typecheck`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: OMT settings, status helpers and frame clock`

### Task 3: Audio plan per output window

**Files:**
- Modify: `src/shared/omt.ts`, `src/shared/omt.test.ts`

**Interfaces:**
- Produces: `audioPlan(role: 'hdmi' | 'omt', hdmiShowing: boolean, omtRunning: boolean, route: AudioRoute): { local: boolean; tap: boolean }`. `local`: this window plays sound on the local device (HDMI window when `hdmiShowing`; OMT window when `!hdmiShowing && omtRunning`) and `route !== 'omt'`. `tap`: `role === 'omt'` and `route !== 'local'`.

- [ ] **Step 1: Write failing tests** for every combination of role × hdmiShowing × omtRunning × route (table test, 24 rows); assert never two windows `local` at once for the same inputs.
- [ ] **Step 2: Run** `npx vitest run src/shared/omt.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** again. Expected: PASS.
- [ ] **Step 5: Commit** `feat: decide which output window plays and taps sound`

### Task 4: libomt binding and fake binding

**Files:**
- Create: `src/main/omt/binding.ts`, `src/main/omt/fake-binding.ts`, `src/main/omt/binding.test.ts`
- Modify: `package.json` (`koffi` in `dependencies`), `package-lock.json`, `electron-builder.yml` (`asarUnpack: node_modules/koffi/**`; `extraResources` `omt/` per platform), `electron.vite.config.ts` (keep `koffi` external in main)

**Interfaces:**
- Produces:
  - `interface OmtBinding { create(name: string): number; sendVideo(h: number, f: { width: number; height: number; data: ArrayBuffer }): void; sendAudio(h: number, a: { sampleRate: number; channels: number; samples: number; data: Float32Array }): void; connections(h: number): number; address(h: number): string; videoStats(h: number): { frames: number; dropped: number }; destroy(h: number): void }`
  - `loadLibomt(dir: string): OmtBinding` (koffi; throws `OmtLoadError` when the library or a symbol is missing)
  - `libomtDir(): string` — `process.env.PPT_LIBOMT_DIR` only when `!app.isPackaged`; otherwise `join(process.resourcesPath, 'omt')`. File names: `libomt.dll`/`libvmx.dll` (win32), `libomt.so`/`libvmx.so` (linux).
  - `class FakeOmtBinding implements OmtBinding` recording calls (`frames: {width,height}[]`, `audio: number`, `destroyed: boolean`, `failCreate?: boolean`).
  - Struct layout of `OMTMediaFrame` taken from `libomt.h` of the version built in Task 1 (fields in order); write the `koffi.struct` from the header, not from memory.

- [ ] **Step 1: Write failing tests**: `libomtDir()` honours the env var only when not packaged (mock `app`); `loadLibomt('/nonexistent')` throws `OmtLoadError`; `FakeOmtBinding` records a video frame and `destroy`.
- [ ] **Step 2: Run** `npx vitest run src/main/omt/binding.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement**; `npm install koffi` (exact version in `package.json`).
- [ ] **Step 4: Run** the test, `npm run typecheck`. With `PPT_LIBOMT_DIR` set to the Task 1 build, a manual `node`/electron check that `loadLibomt` + `create` + `address` returns an `omt://` address. Expected: PASS.
- [ ] **Step 5: Commit** `feat: libomt binding through koffi`

### Task 5: Sender logic and worker thread

**Files:**
- Create: `src/main/omt/sender.ts`, `src/main/omt/sender.test.ts`, `src/main/omt/worker.ts`

**Interfaces:**
- Consumes: Task 2 `FrameClock`, `dropWarning`; Task 4 `OmtBinding`, `OmtLoadError`.
- Produces:
  - `class OmtSender` (`sender.ts`): `constructor(binding: () => OmtBinding, report: (s: Partial<OmtStatus>) => void, timers?)`; `start(o: { name: string; fps: 30 | 60; width: number; height: number }): void`; `frame(f: Frame): void`; `audio(a: Float32Array, samples: number): void`; `stop(): void` (clock stops first, then `destroy`). Reports `running` with `address`, polls `connections` and drop samples every 1 s, `warning: 'drops'` via `dropWarning`. Load error → `{ state: 'error', message: <library missing copy> }`; create throws or returns 0 → `{ state: 'error', message: <create copy> }`.
  - `worker.ts`: thread entry wrapping one `OmtSender` with the koffi binding (or `FakeOmtBinding` when `workerData.fake`). Messages in: `{ type: 'start', ... }`, `{ type: 'frame', width, height, data }` (data transferred), `{ type: 'audio', data, samples }`, `{ type: 'stop' }`. Messages out: `{ type: 'status', status }`, `{ type: 'stopped' }`.

- [ ] **Step 1: Write failing tests** (`sender.test.ts`, fake binding, fake timers): start → `running` with the fake address; a frame then 3 ticks → 3 `sendVideo` calls of that frame; load error and create failure produce the exact messages; `stop()` → clock stopped before `destroy` (order recorded), no `sendVideo` after `destroy`; 11 % drops at 60 fps for 10 s → `warning: 'drops'`.
- [ ] **Step 2: Run** `npx vitest run src/main/omt/sender.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** both files; build the worker as its own electron-vite main entry (`import workerPath from './omt/worker?modulePath'`, confirm with Context7).
- [ ] **Step 4: Run** the test, `npm run typecheck`, `npm run build`. Expected: PASS, `out/main` contains the worker file.
- [ ] **Step 5: Commit** `feat: OMT sender worker`

### Task 6: OmtOutput in main, IPC and status

**Files:**
- Create: `src/main/omt-output.ts`
- Modify: `src/shared/ipc.ts`, `src/preload/index.ts`, `src/preload/index.d.ts`, `src/main/index.ts`

**Interfaces:**
- Consumes: Tasks 2–5; `ProgramState.canvas`; `HdmiOutput` status for the audio plan.
- Produces:
  - `class OmtOutput`: `constructor(settings: OmtSettings, canvas: () => Canvas, onStatus: (s: OmtStatus) => void, opts?: { fake?: boolean })`; `apply(next: OmtSettings): void`; `canvasChanged(): void`; `status(): OmtStatus`; `shutdown(): Promise<void>`; `get debug()`.
  - Offscreen window: `webPreferences.offscreen: true`, `backgroundThrottling: false`, size = canvas, `webContents.setFrameRate(fps)`, loads `#/output?role=omt`, same input/navigation/popup guards and `page-title-updated` handling as `HdmiOutput`; `paint` → `image.toBitmap()` → worker `frame` (transfer the `ArrayBuffer`) only after `output:ready` from this window; before that the worker gets black frames of the canvas size.
  - Renderer crash → recreate after `RESTART_DELAY_MS` (worker keeps repeating). Worker `exit`/`error` → restart if `restartAllowed`, else status `error`.
  - Canvas or fps change → resize window, `stop` + `start` the sender.
  - Sound: `MessageChannelMain`; `port1` posted to the OMT window (`webContents.postMessage('omt:audio-port', null, [port1])`); main forwards `port2` messages to the worker (`audio`).
  - IPC: `'omt:set'` `[omt: OmtSettings]` → `Settings` (sanitize, save, `apply`); `'omt:getStatus'` → `OmtStatus`; broadcast `'omt:status'`; `Api.setOmt`, `getOmtStatus`, `onOmtStatus`, and for the output renderer `onOmtAudioPort(cb: (port: MessagePort) => void)`.
  - `index.ts`: create `OmtOutput` with saved settings; call `canvasChanged()` when `program:state` carries a new canvas; `shutdown()` on quit. `PPT_OUTPUT_DUMP`: `globalThis.__pptOmt` = debug (status, window exists, frames received by the fake binding with their sizes); `PPT_OMT_FAKE=1` uses `FakeOmtBinding`.

- [ ] **Step 1: Implement** as listed (behaviour is covered end to end in Task 9; pure parts are already tested).
- [ ] **Step 2: Run** `npm run typecheck`, `npx vitest run`, `npm run build`. Expected: PASS.
- [ ] **Step 3: Commit** `feat: OMT output window, sender lifecycle and IPC`

### Task 7: Sound tap in the output renderer

**Files:**
- Create: `src/renderer/src/omt-tap.worklet.ts`
- Modify: `src/renderer/src/output-audio.ts`, `src/renderer/src/output-audio.test.ts`, `src/renderer/src/OutputView.tsx`, `src/renderer/src/main.tsx`

**Interfaces:**
- Consumes: Task 3 `audioPlan`; Task 6 `onOmtAudioPort`, `onOmtStatus`; existing `onHdmiStatus`.
- Produces:
  - Route `#/output?role=omt` renders `OutputView` with `role = 'omt'` (default `'hdmi'`).
  - `OutputAudio.setPlan(p: { local: boolean; tap: boolean }, port: MessagePort | null): Promise<void>` — `local` connects the gain node to `destination`, else disconnects; `tap` adds an `AudioWorkletNode` (module `omt-tap.worklet`) after the gain node that posts `Float32Array` planar blocks of 480 frames (10 ms at 48 kHz, `AudioContext({ sampleRate: 48000 })`) to `port`. Worklet load failure → `warning` `'no-sound'` reported once, local sound unaffected.
  - `OutputView` computes the plan from `role`, HDMI status, OMT status and `audio.route`, and calls `setPlan` on change. It replaces the old `outputMuted(..., onScreen)` silencing for the local path (Mute all is already in the gain).

- [ ] **Step 1: Write failing tests** in `output-audio.test.ts` (fake context with `audioWorklet.addModule` and a fake `AudioWorkletNode` factory): `setPlan({local:false,tap:false})` disconnects destination; `{local:true,tap:true}` connects both; `addModule` rejecting keeps `local` working and reports `'no-sound'`.
- [ ] **Step 2: Run** `npx vitest run src/renderer/src/output-audio.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the test, `npm run typecheck`, `npm run lint`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: OMT sound tap and one local sound window`

### Task 8: OMT UI

Load `impeccable:impeccable` first; follow `DESIGN.md`.

**Files:**
- Create: `src/renderer/src/components/OmtSection.tsx`
- Modify: `OutputMenu.tsx`, `AudioSection.tsx`, `Header.tsx`, `src/shared/omt.ts`, `src/shared/omt.test.ts`

**Interfaces:**
- Consumes: Task 6 API.
- Produces:
  - `omtBadge(s: OmtStatus | null): { text: string; tone: 'off' | 'neutral' | 'ok' | 'error' }` → `'OMT off'`, `'OMT · no receivers'`, `'OMT · 1 receiver'` / `'OMT · 2 receivers'`, `'OMT error'`.
  - `OmtSection` in the output popover below HDMI: switch **OMT**, **Source name** (saved on Enter/blur), **Frame rate** 30/60 (confirm with the receivers copy when `connections > 0`), **Address** with **Copy** (`navigator.clipboard.writeText`), status message, warnings (`drops`, `no-receivers` hint after 15 s, `no-sound`).
  - Canvas change confirm (canvas UI from the canvas plan) also shows the receivers copy when OMT has connections.
  - `AudioSection`: **Sound to** `Local device` / `OMT` / `Both` (radio group).
  - Header: OMT badge next to the HDMI badge (icon + text, not colour alone).

- [ ] **Step 1: Write failing tests** for `omtBadge` (null, off, running 0/1/2, error).
- [ ] **Step 2: Run** `npx vitest run src/shared/omt.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npx vitest run`, `npm run typecheck`, `npm run lint`; check in `npm run dev` with keyboard only, dark and light. Expected: PASS.
- [ ] **Step 5: Commit** `feat: OMT section, sound route and header badge`

### Task 9: End to end, packaging, docs

**Files:**
- Modify: `e2e/smoke.mjs`, `electron-builder.yml`, `PRODUCT.md`, `docs/test-checklist.md`, `docs/superpowers/specs/2026-10-06-ppt-share-design.md`

- [ ] **Step 1: Smoke checks** with `PPT_OMT_FAKE=1` (follow the HDMI checks' style): OMT on with HDMI off → fake frames 1920×1080, first black, then non-black after `output:ready`; Next / Black / KV change frame content; no Next for 3 s at 30 fps → about 90 frames; event canvas 3840×1080 → frames 3840×1080; offscreen renderer killed (`webContents.forcefullyCrashRenderer()`) → frames continue (last content), then recover; OMT off → window and worker gone; `audioPlan` effect: with HDMI off and route `both`, the OMT window's `.output` reports local on (expose `data-local`/`data-tap` on `.output`).
- [ ] **Step 2: Run** `npm run test:e2e`. Expected: all pass, old checks included.
- [ ] **Step 3: Packaging**: `extraResources` copies `resources/omt/win/*` (Windows build) and `resources/omt/linux/*` (Linux build) to `omt/`, with the MIT license files; document in `README.md` where the binaries come from. Run `npm run build:unpack` on Linux and check `resources/omt` exists in the output.
- [ ] **Step 4: Docs**: `PRODUCT.md` (NDI stays removed; OMT output added, MIT license; sound route rule), main spec, `docs/test-checklist.md` field checks from the spec (vMix/OBS discovery and manual address, firewall, sound Local/OMT/Both, LAN unplug, 60 fps 30 minutes, Resolume best effort).
- [ ] **Step 5: Commit** `test: OMT end to end; packaging and docs`
