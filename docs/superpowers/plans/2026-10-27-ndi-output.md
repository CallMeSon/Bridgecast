# NDI Output Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Program (picture and, by choice, sound) is also sent over the LAN as an NDI source that vMix and OBS can receive, from the same single render as OMT; either protocol or both can be on.

**Architecture:** The OMT plan's offscreen window, frame clock and worker become a shared network output. `NdiBinding` implements the protocol-neutral `SenderBinding` over the NDI runtime through `koffi`; `OmtSender` already sends every frame and audio block to a list of `SendTarget`s, and this plan adds `setTargets` so one protocol can start or stop without a gap in the other. The NDI runtime is never bundled: the Windows installer downloads the official runtime from ndi.video, verifies its Vizrt signature and installs it silently, and the app loads it only when present.

**Tech Stack:** Electron 45, Node `worker_threads`, `koffi`, NDI 6 runtime (`Processing.NDI.Lib.x64.dll` / `libndi.so.6`), NSIS (electron-builder) with PowerShell, Vitest, Playwright smoke test.

**Spec:** `docs/superpowers/specs/2026-10-27-execution-design.md` (section 4; depends on `2026-10-27-omt-output-design.md`). Reference only, read never copied: `~/work/stagecast/src/Stagecast.Rendering/Ndi/NdiNative.cs`, `NdiOutput.cs`, `NdiProbe.cs`, `~/work/stagecast/installer/stagecast.iss` (NDI works on the user's Windows machines through Stagecast).

## Preconditions

- The OMT plan (`docs/superpowers/plans/2026-10-27-omt-output.md`) is fully merged and its gate is green, including its protocol-neutral parts: `SenderBinding` (`src/main/net/sender-binding.ts`), `FakeSenderBinding`, `SendTarget`, `OmtSender.start({ targets, ... })`, `audioPlan(..., networkRunning, ...)`.
- `git status` shows no changes in `package.json` / `package-lock.json`.

## Global Constraints

- UI copy is English, exact strings: `NDI could not start: the NDI Runtime is not installed. Install it from ndi.video, then turn NDI off and on.`, `NDI could not start: the installed NDI Runtime is too old. Install NDI 6 from ndi.video.`, `NDI could not start. The source name may already be in use, or the network is unavailable. Change the name or turn NDI off and on.`, `No receiver yet. In vMix or OBS, pick the NDI source shown above.`, `NDI sound is unavailable; sound plays on this PC only.`, `Receivers will lose the network picture for about a second. Change it now?` (the last replaces the OMT-only copy for the frame rate and Canvas confirms).
- Settings default: `ndi = { enabled: false, name: 'PPT Share' }`. Name: trimmed, at most 64 characters, control characters removed, empty/invalid → `'PPT Share'`. Frame rate is `omt.fps` (30 or 60) for every network protocol, also when OMT is off.
- NDI frames: FourCC `BGRX` (`'B' | 'G' << 8 | 'R' << 16 | 'X' << 24`), progressive (`FrameFormatType` 1), `Timecode` = `NDIlib_send_timecode_synthesize` (`INT64_MAX`), `FrameRateN = fps`, `FrameRateD = 1`, `PictureAspectRatio = width / height`, stride `width*4`, size = `ProgramState.canvas`. Audio: float planar, 48000 Hz, 2 channels, `ChannelStrideInBytes = samples * 4`. `NDIlib_send_create` with `clock_video = false`, `clock_audio = false` (the frame clock paces sending).
- Struct sizes on 64-bit (from `NdiNative.cs`, which is proven on Windows): `SendCreate` 24, `VideoFrame` 72, `AudioFrame` 56. Tests assert them with `koffi.sizeof`.
- The runtime is never bundled and NDI SDK headers are never copied into the repo. NDI® is a registered trademark of Vizrt NDI AB (noted in `PRODUCT.md` and `README.md`).
- Runtime lookup order: `NDI_RUNTIME_DIR_V6`, `NDI_RUNTIME_DIR_V5`, then Windows `%ProgramFiles%\NDI\NDI 6 Runtime\v6`, `...\NDI 6 Tools\Runtime`, `...\NDI 5 Runtime`, `...\NDI 5 Tools\Runtime`; Linux `/usr/lib`, `/usr/local/lib`, `/usr/lib/x86_64-linux-gnu`. File names `Processing.NDI.Lib.x64.dll` (win32), `libndi.so.6` (linux).
- Installer: runtime URL `https://downloads.ndi.tv/SDK/NDI_SDK/NDI%206%20Runtime.exe`; run it only when `Get-AuthenticodeSignature` is `Valid` and the signer subject matches `*Vizrt*`; silent flags `/VERYSILENT /SUPPRESSMSGBOXES /NORESTART`; any failure asks whether to continue without NDI (silent installs continue without asking); test switch environment variable `PPT_SIMULATE_NDI_MISSING=1`.
- Never block the main process with frame work; NDI sends happen in the worker. Destroy the sender only after the frame clock stopped.
- Check Context7 before using: `koffi` (struct, `koffi.sizeof`, pointers to `ArrayBuffer`, `koffi.load`), electron-builder NSIS custom include (`nsis.include`, `customInstall`), Electron `app.getPath`/`process.platform`.
- UI task: load `impeccable:impeccable` first, follow `DESIGN.md` / `PRODUCT.md`.
- Commit with `git -c user.name="Gerson Sebastian" -c user.email="sebastiangerson24@gmail.com" commit ...`, message ending `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`. Never stage unrelated files (`docs/superpowers/plans/2026-10-27-canva-import.md`, `*.tsbuildinfo`).
- A task that fails more than 3 times (including on Opus) stops; report task, file, command and error to the user.

## Review Focus

1. NDI runtime missing (fresh machine, failed install): the NDI switch shows the runtime message; HDMI and OMT keep working. Test in Task 3 and Task 4.
2. NDI switched on or off while OMT receivers are connected: OMT keeps its frame cadence and does not restart. Test in Task 4.
3. Both on: one offscreen window, both targets get identical frames; a frame-rate or Canvas change restarts both after one confirm. Test in Task 4 and Task 7.
4. Source name that is empty, 80 characters, or has control characters; two PPT Share instances on one LAN. Test in Task 2 (sanitizing) and Task 3 (create failure message).
5. Installer on a PC without internet, with a tampered (unsigned) download, or run silently: installation finishes, NDI stays unavailable with the message above. Test in Task 6 (user, Windows).

---

## File Structure

- `src/shared/settings.ts` (+ `NdiSettings`, `sanitizeNdi`), `src/shared/omt.ts` (+ `NetStatus` alias, `ndiBadge`, NDI copy, `networkOn`)
- `src/main/ndi/runtime.ts` (search paths, pure), `src/main/ndi/binding.ts` (`koffi` `SenderBinding`, `NdiLoadError`), `src/main/ndi/binding.test.ts`
- `src/main/omt/sender.ts` (+ `setTargets`), `src/main/omt/worker.ts` (+ `targets` message), `src/main/omt-output.ts` → `src/main/net-output.ts` (`NetOutput`)
- `src/renderer/src/components/NetworkSection.tsx` (frame rate), `NdiSection.tsx`, `OmtSection.tsx`, `AudioSection.tsx`, `Header.tsx`, `OutputMenu.tsx`, `OutputView.tsx`
- `build/installer.nsh`, `build/install-ndi-runtime.ps1`, `electron-builder.yml`
- `e2e/smoke.mjs`, `PRODUCT.md`, `README.md`, `docs/test-checklist.md`, `docs/superpowers/specs/2026-10-06-ppt-share-design.md`, `docs/superpowers/notes/ndi-spike.md`

---

### Task 1: Spike (throwaway code, Linux part by agent, Windows part by the user)

NDI on Windows is already proven by Stagecast; this only proves that `koffi` from Node lays out the structs correctly.

**Files:**
- Create: `docs/superpowers/notes/ndi-spike.md` (results only; spike code lives in the scratchpad, never committed)

- [ ] **Step 1: Struct sizes.** Small Node script: declare `SendCreate`, `VideoFrame`, `AudioFrame` with `koffi.struct` from `NdiNative.cs` and print `koffi.sizeof` of each. Expected: 24, 72, 56. Record the field order used.
- [ ] **Step 2: Linux runtime.** `ldconfig -p | grep -i ndi`. If `libndi.so.6` is absent, the NDI SDK needs a license acceptance on ndi.video, so record "no Linux runtime on this machine", skip steps 3–4 and continue with the Windows checklist only. If present: send one 1920×1080 BGRX gradient frame and one 480-sample audio block with `koffi`, receive with the NDI SDK sample or NDI Monitor, record the result.
- [ ] **Step 3: Gradient frame** at 30 fps for 10 s from an Electron offscreen window through `koffi` in a worker thread; record CPU of main + worker.
- [ ] **Step 4: Windows checklist for the user** in the notes file: copy the Node script, run it on a PC with the NDI Runtime (the Stagecast machine works), NDI Monitor (or Stagecast's `NdiProbe`) shows a correct, undistorted gradient and hears the test tone; vMix and OBS (DistroAV) list the source; CPU at 30 and 60 fps for 1920×1080 and 3840×1080.
- [ ] **Step 5: Gate.** Struct sizes match and (Linux, if possible) send works → commit the notes (`docs: NDI spike results`). Stop and ask the user to run the Windows checklist; continue only when they report a correct picture. A wrong picture or crash means a struct layout mistake: fix against `NdiNative.cs` and retry; after 3 failures stop and report.

### Task 2: NDI settings, status helpers and copy

**Files:**
- Modify: `src/shared/settings.ts`, `src/shared/omt.ts`, `src/shared/omt.test.ts`, `src/main/settings.ts`, `src/main/settings.test.ts`

**Interfaces:**
- Consumes: OMT plan `OmtStatus`, `OmtSettings`, `Settings`.
- Produces:
  - `interface NdiSettings { enabled: boolean; name: string }`, `DEFAULT_NDI`, `sanitizeNdi(raw: unknown): NdiSettings`; `Settings.ndi`.
  - `type NetStatus = OmtStatus`; `type NdiStatus = NetStatus` (warning `'drops'` never occurs for NDI).
  - `ndiBadge(s: NdiStatus | null): { text: string; tone: 'off' | 'neutral' | 'ok' | 'error' }` → `'NDI off'`, `'NDI · no receivers'`, `'NDI · 1 receiver'` / `'NDI · 2 receivers'`, `'NDI error'`.
  - `NDI_COPY: { missing: string; tooOld: string; createFailed: string; noReceivers: string; noSound: string }` with the exact strings from Global Constraints; `NETWORK_CHANGE_CONFIRM` (the receivers copy).
  - `networkOn(s: { omt: OmtSettings; ndi: NdiSettings }): boolean` (`omt.enabled || ndi.enabled`).

- [ ] **Step 1: Write failing tests**: `sanitizeNdi` (defaults, `'  '` → `'PPT Share'`, 80 chars → 64, `'\u0007x'` → `'x'`, non-object → defaults); settings file without `ndi` loads `DEFAULT_NDI`; `ndiBadge` for null, off, running 0/1/2 connections, error; `networkOn` truth table.
- [ ] **Step 2: Run** `npx vitest run src/shared/omt.test.ts src/main/settings.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** as listed.
- [ ] **Step 4: Run** the same command and `npm run typecheck`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: NDI settings, badge and copy`

### Task 3: NDI runtime lookup and binding

**Files:**
- Create: `src/main/ndi/runtime.ts`, `src/main/ndi/binding.ts`, `src/main/ndi/binding.test.ts`

**Interfaces:**
- Consumes: OMT plan `SenderBinding`, `FakeSenderBinding`.
- Produces:
  - `ndiSearchDirs(env: Record<string, string | undefined>, platform: NodeJS.Platform, programFiles: string): string[]` and `ndiLibraryName(platform): string` (`runtime.ts`, pure).
  - `class NdiLoadError extends Error { kind: 'missing' | 'old' }`.
  - `loadNdi(dirs?: string[]): SenderBinding` (`binding.ts`): searches `ndiSearchDirs` (default dirs from `process.env`, `process.platform`, `process.env.ProgramFiles`), `koffi.load` the first file that exists, binds `NDIlib_initialize`, `NDIlib_send_create`, `NDIlib_send_destroy`, `NDIlib_send_send_video_v2`, `NDIlib_send_send_audio_v2`, `NDIlib_send_get_no_connections`. No file or `NDIlib_initialize()` false → `NdiLoadError('missing')`; a missing symbol → `NdiLoadError('old')`. `create(name)` returns the sender pointer as a number handle (0 on failure); `address(h)` returns `` `${os.hostname()} (${name})` `` (the NDI full source name); `videoStats` returns zeros.

- [ ] **Step 1: Write failing tests**: `ndiSearchDirs` honours `NDI_RUNTIME_DIR_V6` before `V5`, then the Program Files folders in the Global Constraints order on win32 and the three library folders on linux; `ndiLibraryName`; `koffi.sizeof` of the three structs is 24 / 72 / 56; `loadNdi(['/nonexistent'])` throws `NdiLoadError` with `kind: 'missing'`; `NdiLoadError` for a library without the symbols is `kind: 'old'` (mock `koffi.load`).
- [ ] **Step 2: Run** `npx vitest run src/main/ndi/binding.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.** Structs are written from `NdiNative.cs` field order; `sendVideo` pins the frame `ArrayBuffer` for the call (NDI `send_video_v2` is synchronous), `sendAudio` passes the planar `Float32Array`.
- [ ] **Step 4: Run** the test and `npm run typecheck`. With the Task 1 setup, a manual check that `loadNdi()` + `create('PPT Share Test')` + `address` works on a machine with the runtime. Expected: PASS.
- [ ] **Step 5: Commit** `feat: NDI binding through koffi`

### Task 4: Network output with OMT and NDI targets

**Files:**
- Modify: `src/main/omt/sender.ts`, `src/main/omt/sender.test.ts`, `src/main/omt/worker.ts`, `src/shared/ipc.ts`, `src/preload/index.ts`, `src/preload/index.d.ts`, `src/main/index.ts`
- Rename: `src/main/omt-output.ts` → `src/main/net-output.ts` (`git mv`, update imports)

**Interfaces:**
- Consumes: Tasks 2–3; OMT plan `OmtOutput`, `OmtSender`, `SendTarget`, worker messages.
- Produces:
  - `OmtSender.setTargets(targets: SendTarget[]): void`: targets whose `id` is new are created and report; targets no longer listed are destroyed; the frame clock keeps running and unchanged targets are untouched; an empty list stops the clock.
  - Worker message in `{ type: 'targets', targets: { id: 'omt' | 'ndi'; name: string }[] }` → `setTargets`; the worker builds the binding per id (`loadLibomt` / `loadNdi`). The OMT plan's `workerData.fake` keeps meaning "OMT uses `FakeSenderBinding('omt')`"; a new `workerData.fakeNdi: false | true | 'missing'` makes NDI use `FakeSenderBinding('ndi')`, or throw `NdiLoadError('missing')` for `'missing'`. `NetOutput` sets it from `PPT_NDI_FAKE`.
  - `class NetOutput` (renamed from `OmtOutput`): `constructor(settings: { omt: OmtSettings; ndi: NdiSettings }, canvas, onStatus: (id: 'omt' | 'ndi', s: NetStatus) => void, opts?)`; `apply(next: { omt: OmtSettings; ndi: NdiSettings }): void` (window exists while `networkOn`; target list follows each `enabled`; `name` change restarts only that target; fps or Canvas change restarts the sender once); `status(id)`; `shutdown()`.
  - IPC: `'ndi:set'` `[ndi: NdiSettings]` → `Settings`; `'ndi:getStatus'` → `NdiStatus`; broadcast `'ndi:status'`; `Api.setNdi`, `getNdiStatus`, `onNdiStatus`. `'omt:*'` channels unchanged. Fps stays in `omt:set` (`OmtSettings.fps`); add `Api.setNetworkFps(fps: 30 | 60)` that updates `omt.fps` without touching `omt.enabled`.
  - `PPT_OUTPUT_DUMP`: `globalThis.__pptNet = { windows, targets: { id, frames: { width, height, fps }[] }[] }`; `PPT_NDI_FAKE=1` uses `FakeSenderBinding('ndi')`, `PPT_NDI_FAKE=missing` simulates the missing runtime.

- [ ] **Step 1: Write failing tests** (`sender.test.ts`, fake bindings, fake timers): two targets get the same frame on the same tick; `setTargets` adding NDI while OMT runs → OMT keeps receiving every tick (no gap, same `FakeSenderBinding` instance not destroyed) and NDI starts; removing NDI destroys only NDI; removing both stops the clock before `destroy`; NDI load error → NDI status `error` with `NDI_COPY.missing` while OMT stays `running`; NDI `create` returning 0 → `NDI_COPY.createFailed`; `drops` warning is never produced for id `'ndi'`.
- [ ] **Step 2: Run** `npx vitest run src/main/omt/sender.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** all items in Produces. `NetOutput` reuses the whole OMT window/worker/crash-restart logic; only the target list and status fan-out are new.
- [ ] **Step 4: Run** `npx vitest run`, `npm run typecheck`, `npm run build`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: NDI target in the network output`

### Task 5: Network UI

Load `impeccable:impeccable` first; follow `DESIGN.md`.

**Files:**
- Create: `src/renderer/src/components/NdiSection.tsx`, `src/renderer/src/components/NetworkSection.tsx`
- Modify: `OutputMenu.tsx`, `OmtSection.tsx`, `AudioSection.tsx`, `Header.tsx`, `src/renderer/src/OutputView.tsx`, `src/shared/omt.ts`, `src/shared/omt.test.ts`

**Interfaces:**
- Consumes: Task 2 `ndiBadge`, `NDI_COPY`, `NETWORK_CHANGE_CONFIRM`, `networkOn`; Task 4 API.
- Produces:
  - `NetworkSection` in the output popover below HDMI, above OMT and NDI: **Frame rate** 30/60 (confirm with `NETWORK_CHANGE_CONFIRM` when any target has `connections > 0`), moved out of `OmtSection`.
  - `NdiSection`: switch **NDI**, **Source name** (saved on Enter/blur), **Source** with **Copy** (the `address` from the status, `HOSTNAME (name)`), status message, `no-receivers` hint after 15 s with 0 connections, `no-sound` warning.
  - `AudioSection`: **Sound to** `Local device` / `Network` / `Both` (value `'omt'` stays; only the label changes). Header shows the NDI badge next to the OMT badge (icon + text). The Canvas change confirm uses `NETWORK_CHANGE_CONFIRM` when any target has connections.
  - `OutputView` passes `networkOn`-based `networkRunning` (either target `running`) into `audioPlan`.

- [ ] **Step 1: Write failing tests** for the pure parts added to `src/shared/omt.ts`: `hasConnections(omt: NetStatus | null, ndi: NetStatus | null): boolean` (true when either has `connections > 0`) and `networkRunning(omt, ndi): boolean` (either `state === 'running'`), including null inputs.
- [ ] **Step 2: Run** `npx vitest run src/shared/omt.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** the helpers and the components.
- [ ] **Step 4: Run** `npx vitest run`, `npm run typecheck`, `npm run lint`; check in `npm run dev` with `PPT_NDI_FAKE=1`, keyboard only, dark and light. Expected: PASS.
- [ ] **Step 5: Commit** `feat: NDI section, shared frame rate and network sound label`

### Task 6: Windows installer installs the NDI Runtime

Windows-only; the agent writes it, **the user runs the checks** (steps 3–4).

**Files:**
- Create: `build/installer.nsh`, `build/install-ndi-runtime.ps1`
- Modify: `electron-builder.yml`

**Interfaces:**
- Produces:
  - `build/install-ndi-runtime.ps1`: exit code `0` runtime present or installed, `2` download failed, `3` signature invalid, `4` install failed. With `PPT_SIMULATE_NDI_MISSING=1` the presence check reports "missing" so the download path runs. Checks presence with the same folder list as `ndiSearchDirs` (Windows part).
  - `build/installer.nsh`: macro `customInstall` extracts the script to `$PLUGINSDIR`, runs it with `nsExec::ExecToLog` and, for exit codes 2–4, shows `MessageBox MB_YESNO` asking to continue without NDI (default yes with `/SD IDYES`, so silent installs finish); `No` aborts the install.
  - `electron-builder.yml`: `nsis.include: build/installer.nsh`.

- [ ] **Step 1: Write** the PowerShell script and the NSIS include following `~/work/stagecast/installer/stagecast.iss` (download → signature check → silent install), with English messages: `Downloading the NDI Runtime...`, `The downloaded NDI Runtime does not carry a valid Vizrt signature and was not installed. Continue installing PPT Share without NDI? The NDI output will not be available.`, `The NDI Runtime could not be installed (code {0}). Continue installing PPT Share without NDI? The NDI output will not be available until the runtime is installed.`, `The NDI Runtime could not be downloaded. Continue installing PPT Share without NDI? The NDI output will not be available until the runtime is installed.`
- [ ] **Step 2: Build** the installer on Linux if possible (`npx electron-builder --win nsis --dir` needs wine; if it cannot run, only `npm run typecheck` and a lint of the `.ps1` with `pwsh -NoProfile -Command "[scriptblock]::Create((Get-Content build/install-ndi-runtime.ps1 -Raw)) | Out-Null"` when `pwsh` exists) and record what could be checked.
- [ ] **Step 3: Windows checklist for the user** in `docs/test-checklist.md`: clean Windows 11 VM with internet → runtime installed, NDI source appears; runtime already installed → step skipped; `PPT_SIMULATE_NDI_MISSING=1` set → download path runs; no internet → prompt, "Yes" finishes install, NDI shows the missing-runtime message, HDMI and OMT work; tampered file (replace the downloaded exe after download with an unsigned one) → signature prompt and nothing installed; silent install `/S` finishes without prompts.
- [ ] **Step 4: Gate.** Stop and ask the user to run the checklist; continue only when they report it works. After 3 failed attempts stop and report.
- [ ] **Step 5: Commit** `feat: installer installs the NDI Runtime when missing`

### Task 7: End to end, docs

**Files:**
- Modify: `e2e/smoke.mjs`, `PRODUCT.md`, `README.md`, `docs/test-checklist.md`, `docs/superpowers/specs/2026-10-06-ppt-share-design.md`, `docs/superpowers/specs/2026-10-27-omt-output-design.md`

- [ ] **Step 1: Smoke checks** with `PPT_OMT_FAKE=1 PPT_NDI_FAKE=1` (follow the OMT checks' style): both on, HDMI off → one offscreen window, both fake targets receive 1920×1080 frames with identical content and `fps: 30`; switch NDI off → OMT frame count keeps rising without a pause longer than two ticks and the NDI target is destroyed; NDI on again → it receives frames again; set 60 fps → both targets restart once and report `fps: 60`; event canvas 3840×1080 → both receive 3840×1080; `PPT_NDI_FAKE=missing` → NDI status `error` with `NDI_COPY.missing`, OMT frames continue; both off → window and worker gone.
- [ ] **Step 2: Run** `npm run test:e2e`. Expected: all pass, old checks included.
- [ ] **Step 3: Docs**: `PRODUCT.md` (NDI was removed 2026-10-08 for SDK licensing; re-added 2026-10-27 with the runtime never bundled and installed from ndi.video by the installer; fps and sound-route rules; NDI® trademark line), `README.md` (same notice and where the runtime comes from), main spec, `docs/test-checklist.md` field checks (vMix and OBS pick the source, NDI Monitor shows an undistorted picture at 1920×1080 and 3840×1080, sound Local/Network/Both, LAN unplug, both protocols on for 30 minutes, installer cases from Task 6), and a line in `2026-10-27-omt-output-design.md` pointing to this plan for the NDI addition.
- [ ] **Step 4: Update the handoff** `docs/superpowers/notes/2026-10-27-roadmap-handoff.md` with the new order `... omt-output → ndi-output → web-source ...`.
- [ ] **Step 5: Commit** `test: NDI end to end; docs`
