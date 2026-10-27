# Native Slideshow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Decks with animation, transitions or media play in real PowerPoint (one click = one animation step) captured into every output; static decks and PDFs play as vector PDF; Edit in PowerPoint and Revert work; any engine failure falls back to the still PNG of the same slide.

**Architecture:** Import keeps the PNG export and adds a PDF, copies of the file, per-slide `clicks`/`hidden` and a static flag. A neutral `SlideShowEngine` interface (PowerPoint bridge on Windows, `FakeEngine` for tests and Linux) is driven by `SlideShowManager` from reducer state changes. The slideshow window is captured with `desktopCapturer` into the shared `StreamLayer`; PDFs render through pdf.js into a `PdfLayer`.

**Tech Stack:** Electron 45 (`desktopCapturer`, `getUserMedia` desktop source), C# .NET Framework 4.8 (`ppt-bridge.exe`, PowerPoint COM, WASAPI process loopback), PowerShell export script, pdf.js (`pdfjs-dist`, already used for import), Vitest, Playwright smoke test.

**Spec:** `docs/superpowers/specs/2026-10-27-native-slideshow-design.md` (depends on the canvas/audio-levels, OMT and web-source specs)

## Preconditions

- The canvas/audio-levels, OMT and web-source plans are merged (`ProgramState.canvas`, `OutputAudio`, `StreamLayer`, `audioPlan`, `nextDeck`).
- `dotnet-sdk-8.0` is installed (OMT plan Task 1). `git status` clean for `package.json` / `package-lock.json`.

## Global Constraints

- UI copy is English, exact strings from the spec: `The slide show is not ready; showing still slides.`, `PowerPoint is not responding. Showing still slides. Save your other PowerPoint files, then press Resume PowerPoint.`, `The slide show cannot be shown on <HDMI|OMT>. It shows still slides.`, `PowerPoint sound plays on this PC's default device only.`, `The slide show helper could not start. Reinstall PPT Share. Showing still slides.`, `This presentation has a password. Remove it in PowerPoint, then import again.`, `Changes apply when this deck leaves air.`, `Your changes could not be loaded. The previous version is still used. Save the file again in PowerPoint.`, `Undo all edits and go back to the imported file?`, `Next: step <n> of <m> on this slide`.
- Deck folder files: `original.<ext>` (never changed), `source.<ext>` (in use), `edit.<ext>` (working copy while editing), `source.pdf`, PNGs `001.png`… as today. `slide:` protocol serves `source.pdf` only (not the pptx files).
- `DeckMeta.playback`: `'native' | 'vector' | 'images'`; missing = `'images'` (old decks); PDF never `'native'`; import default: static pptx → `'vector'`, other pptx → `'native'`, pdf → `'vector'`.
- Never black, never desktop: not ready / engine down / capture down → PNG of the same slide.
- Heartbeat every 1000 ms, no reply within 3000 ms = hung. At most 2 open sessions (live deck + next deck).
- The bridge never kills a `POWERPNT.EXE` that holds files it did not open.
- Engine position wins over reducer state on mismatch, via an `enginePosition` action that never changes `take`.
- Check Context7 before using `desktopCapturer`, `getUserMedia` desktop constraints, pdf.js render API, and for the C# side the PowerPoint object model members named in Task 5.
- UI task: load `impeccable:impeccable` first, follow `DESIGN.md` / `PRODUCT.md`.
- Windows-only steps (PowerPoint, bridge run, capture) cannot run on the agent's Linux machine: the agent prepares them, the controller asks the user to run them and waits for the result.
- Commit with `git -c user.name="Gerson Sebastian" -c user.email="sebastiangerson24@gmail.com" commit ...`, message ending `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`. Never stage unrelated files.
- A task that fails more than 3 times (including on Opus) stops; report task, file, command and error to the user.

## Review Focus

1. A slide with only "After Previous" animations, or a trigger animation: Next must not get stuck waiting for a click that PowerPoint never counts; the engine position corrects the state. Test in Task 3 and Task 4.
2. Prev from step 0 lands on the previous slide fully built (`step = clicks`), skipping hidden slides. Test in Task 3.
3. PowerPoint hangs mid-show while the operator has their own PowerPoint file open: fallback to PNG within 3 s, the operator's PowerPoint is not killed. Test in Task 4 (fake) and the Windows checklist.
4. Edit saved while the deck is live: nothing on air changes until the deck leaves air or Apply now is confirmed. Test in Task 8.
5. A PDF page that pdf.js cannot render: that page shows its PNG, the rest stay vector. Test in Task 7.

---

## File Structure

- `scripts/export-pptx.ps1` (PDF, clicks, hidden, static, copies), `src/main/import/pptx.ts` (manifest parse), `src/main/library.ts`, `src/main/slide-protocol.ts`, `src/shared/types.ts`, `src/shared/ipc.ts` (`RenderedDeck.sourcePath`)
- `src/shared/program.ts` (step, playback, actions), `src/shared/playback.ts` (defaults, labels)
- `src/main/slideshow/engine.ts`, `bridge-protocol.ts`, `fake-engine.ts`, `powerpoint-engine.ts`, `manager.ts`, `capture.ts`, `audio-pipe.ts`, `editor.ts`
- `native/ppt-bridge/` (C# project, `README.md`)
- `src/renderer/src/components/PdfLayer.tsx`, `src/renderer/src/pdf-render.ts`, `src/renderer/src/pcm-source.worklet.ts`, changes in `stream.ts`, `StreamLayer.tsx`, `SlideLayers.tsx`, `model.ts`, `Library.tsx`, `Strip.tsx`, `Program.tsx`, `NextPanel.tsx`
- `fixtures/sample-anim.pptx` (made by the user in PowerPoint), `e2e/smoke.mjs`, docs

---

### Task 1: Windows spike (prepared by the agent, run by the user)

**Files:**
- Create: `docs/superpowers/notes/native-ppt-spike.md` (results); spike code in `~/ppt-spike/` or the scratchpad, never committed

- [ ] **Step 1: Ask the user** to create `fixtures/sample-anim.pptx` in PowerPoint (slides: On Click bullets ×3; After Previous animation; a trigger animation; Morph transition; a hidden slide; a video with sound; one plain slide) and to copy it into the repo.
- [ ] **Step 2: Write the spike**: a minimal C# console app (.NET Framework 4.8, built on Linux with `dotnet build`) that opens a file read-only without window, runs a windowed slideshow at a given size with Presenter View off and pointer hidden, accepts `next`/`prev`/`pos` on stdin and prints slide, click index and click count; plus a small Electron script that lists `desktopCapturer` window sources and plays the one whose id contains the printed HWND.
- [ ] **Step 3: User runs** the spec's checklist 1–8 on Windows (capture behind/off screen at canvas size including larger than the screen; focus, taskbar, Presenter View; click accuracy for each fixture slide; process loopback audio while the session is muted; latency; two sessions; Protected View; the user's own PowerPoint open; static detection and PDF export with hidden slides). Record results in the notes.
- [ ] **Step 4: Gate.** Checklist item 1 fails → stop and report (back to brainstorming). Else commit fixture + notes `docs: native slideshow spike results` and continue. Item 3 failing only selects the audio fallback.

### Task 2: Import metadata, files and playback defaults

**Files:**
- Modify: `scripts/export-pptx.ps1`, `src/main/import/pptx.ts`, `src/main/import/pptx.test.ts`, `src/main/library.ts`, `src/main/library.test.ts`, `src/main/slide-protocol.ts`, `src/main/slide-protocol.test.ts`, `src/shared/types.ts`, `src/shared/ipc.ts`, `src/renderer/src/import/pdf.ts`, `src/main/index.ts`
- Create: `src/shared/playback.ts`, `src/shared/playback.test.ts`

**Interfaces:**
- Produces:
  - Script JSON line adds `clicks: number[]`, `hidden: boolean[]`, `isStatic: boolean`, `pdf: string` (path of the exported PDF, hidden slides included), and `passwordProtected` reported as error code `PASSWORD`.
  - `ImportedDeck` adds `pdfPath: string`, `isStatic: boolean`, `sourcePath: string`; slides add `clicks: number`, `hidden: boolean`.
  - `parseExportManifest(json: string, slideCount: number): Manifest` (arrays shorter than `slideCount` padded with 0/false; non-numbers → 0) in `pptx.ts`.
  - `DeckMeta.playback?: Playback`, `SlideMeta.clicks?: number`, `SlideMeta.hidden?: boolean`; `type Playback = 'native' | 'vector' | 'images'`.
  - `defaultPlayback(source: DeckMeta['source'], isStatic: boolean): Playback`, `playbackOf(d: DeckMeta): Playback` (missing → `'images'`), `canNative(d)` (pptx only) in `playback.ts`.
  - `DeckInput` adds optional `sourcePath`, `pdfPath`, `playback`; `addDeck` copies `original.<ext>`, `source.<ext>`, `source.pdf`. `RenderedDeck.sourcePath?: string` (renderer passes `pathForFile`) → copied as `source.pdf`.
  - `Library.setPlayback(eventId, deckId, p: unknown): DeckMeta` (invalid or `native` for pdf → `The playback mode is not valid for this deck.`).
  - `slide-protocol`: `slide://<deckId>/source.pdf`.
  - Friendly error for `PASSWORD`: the password copy.

- [ ] **Step 1: Write failing tests**: `parseExportManifest` (full, short arrays, garbage); `defaultPlayback` table; `playbackOf` old deck; library `addDeck` with source/pdf copies the three files, `setPlayback` rules; protocol parses `source.pdf` and refuses `source.pptx`, `original.pptx`; friendly error for `PASSWORD: x`.
- [ ] **Step 2: Run** `npx vitest run src/main/import/pptx.test.ts src/main/library.test.ts src/main/slide-protocol.test.ts src/shared/playback.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** TS parts; extend the script (`ExportAsFixedFormat` to PDF with `IncludeHiddenSlides`; `TimeLine.MainSequence` effects with `Timing.TriggerType` = on page click counted per slide; any effect, any `SlideShowTransition.EntryEffect` not none, or any media shape → not static; `SlideShowTransition.Hidden` for hidden).
- [ ] **Step 4: Run** the same, `npm run typecheck`. Ask the user to import `fixtures/sample-anim.pptx` and `fixtures/sample-4x3.pptx` on Windows (`npm run dev`) and report the manifest values. Expected: tests PASS; anim deck `native` with the clicks from Task 1, 4x3 deck `vector`.
- [ ] **Step 5: Commit** `feat: import PDF, click counts, hidden slides and playback mode`

### Task 3: Reducer steps, fallback and engine position

**Files:**
- Modify: `src/shared/program.ts`, `src/shared/program.test.ts`, `src/main/state.ts`, `src/main/state.test.ts`

**Interfaces:**
- Consumes: Task 2 types.
- Produces:
  - `ShownSlide.step: number` (default 0), `ShownSlide.playback?: Playback` (effective, may be `'images'` for a fallback).
  - Actions: `{ type: 'enginePosition'; deckId: string; index: number; step: number }`, `{ type: 'nativeFallback'; deckId: string }`, `{ type: 'resumeNative'; deckId: string }`.
  - `next`/`prev` per spec section 1 (steps only when `shown.playback === 'native'`; hidden slides skipped by next/prev in every mode; goto resets `step`; Prev from step 0 → previous non-hidden slide with `step = clicks`). Steps inside a slide do not increment `take`; a new slide does.
  - `enginePosition` corrects `index`/`step` of a live native deck without changing `take`; `nativeFallback` sets `shown.playback = 'images'`; `resumeNative` sets it back to `'native'` with `step = clicks` of the current slide.
  - `AppState`: `engineReady(deckId) => boolean` callback; a take of a native deck that is not ready sets `shown.playback = 'images'` for that take.

- [ ] **Step 1: Write failing tests** for each rule above, including: next through 3 clicks then next slide (`take` +1 only at the slide change); hidden slide skipped forward and back; Prev from step 0; `enginePosition` with a different step; fallback then Next moves per slide; resume; take while not ready → images; vector deck has no steps.
- [ ] **Step 2: Run** `npx vitest run src/shared/program.test.ts src/main/state.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npx vitest run`, `npm run typecheck`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: animation steps, hidden slides and engine fallback in the program`

### Task 4: Engine interface, protocol, fake engine, manager

**Files:**
- Create: `src/main/slideshow/engine.ts`, `bridge-protocol.ts`, `bridge-protocol.test.ts`, `fake-engine.ts`, `manager.ts`, `manager.test.ts`

**Interfaces:**
- Produces:
  - `interface SlideShowEngine { open(deckId: string, file: string, canvas: Canvas): Promise<EngineSession>; on(ev: 'position' | 'error' | 'exited', cb): void; shutdown(): Promise<void> }`; `interface EngineSession { deckId: string; windowId: string; next(): Promise<void>; prev(): Promise<void>; goto(index: number): Promise<void>; close(): Promise<void> }`; events `position { deckId, index, step, clicks }`, `error { deckId?, message }`.
  - Protocol (JSON lines): requests `{ id, cmd: 'open'|'next'|'prev'|'goto'|'close'|'ping'|'edit'|'setVolume', ...args }`, replies `{ id, ok: true, ...result } | { id, ok: false, code, message }`, events `{ event: 'position'|'error'|'exited', ... }`. `class BridgeClient` (`bridge-protocol.ts`): `constructor(write: (line: string) => void)`, `feed(chunk: string)`, `request(cmd, args, timeoutMs): Promise<result>`, `onEvent(cb)`; malformed lines are logged and ignored; unknown ids ignored.
  - `FakeEngine implements SlideShowEngine` using `SlideMeta.clicks`, with test hooks `hang()`, `crash()`, `delayReady(ms)`.
  - `class SlideShowManager`: `constructor(engine: SlideShowEngine, state: AppState, decks: () => DeckMeta[], canvas: () => Canvas, timers?)`; keeps sessions for the live deck and the next native deck; translates each committed state change (one step forward → `next`, back → `prev`, else `goto`); dispatches `enginePosition`; heartbeat (1000/3000 ms) → `nativeFallback`; restarts the engine in the background; `ready(deckId): boolean`; `windowId(deckId): string | null`; reopens sessions on canvas change when not live.

- [ ] **Step 1: Write failing tests**: `BridgeClient` request/reply, timeout rejects, event dispatch, malformed and unknown lines; manager with `FakeEngine` and fake timers: pre-opens the next native deck, never more than 2 sessions, step forward calls `next`, a jump calls `goto`, a hang triggers `nativeFallback` after 3000 ms, `ready` false until open resolves, canvas change reopens a non-live session only.
- [ ] **Step 2: Run** `npx vitest run src/main/slideshow`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the same, `npm run typecheck`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: slideshow engine interface, bridge protocol and manager`

### Task 5: ppt-bridge.exe and PowerPointEngine

**Files:**
- Create: `native/ppt-bridge/PptBridge.csproj` (net48, `Microsoft.NETFramework.ReferenceAssemblies`), `native/ppt-bridge/*.cs`, `native/ppt-bridge/README.md`, `src/main/slideshow/powerpoint-engine.ts`, `scripts/build-ppt-bridge.sh`
- Modify: `electron-builder.yml` (`extraResources` `ppt-bridge/`), `src/main/index.ts`

**Interfaces:**
- Consumes: Task 4 protocol.
- Produces:
  - Bridge commands per the protocol, implemented with late-bound COM: open (`Presentations.Open(path, ReadOnly, Untitled:false, WithWindow:false)` after removing the `Zone.Identifier` stream; `DisplayAlerts = ppAlertsNone`), slideshow settings from the spec section 2, window size in points from pixels and DPI, tool-window style and no activation, `HWND` reported as `windowId`, events from `SlideShowNextSlide`/`SlideShowNextClick` verified with `View.CurrentShowPosition`, `GetClickIndex`, `GetClickCount`, `ping`, `close`, `edit` (opens `edit.<ext>` in a normal window), `setVolume` (session volume for the audio fallback), process-loopback capture to the named pipe `\\.\pipe\pptshare-audio-<pid>` (48 kHz stereo float), the "never kill a foreign PowerPoint" rule.
  - `PowerPointEngine implements SlideShowEngine` spawning `ppt-bridge.exe` (`resources/ppt-bridge/` packaged, `native/ppt-bridge/bin/...` in dev), wired in `index.ts` on win32; `FakeEngine` elsewhere and when `PPT_OUTPUT_DUMP` and `PPT_ENGINE_FAKE=1`. Bridge start failure → helper copy, all decks images.

- [ ] **Step 1: Implement** the C# project and the TS engine; `scripts/build-ppt-bridge.sh` runs `dotnet build -c Release`.
- [ ] **Step 2: Run** `scripts/build-ppt-bridge.sh` (Linux, compile check), `npm run typecheck`, `npx vitest run`. Expected: build succeeds, tests PASS.
- [ ] **Step 3: User check on Windows**: ask the user to run `npm run dev` with `sample-anim.pptx` and walk every slide with the clicker (steps, Morph, video, hidden slide, Prev), then kill `POWERPNT.EXE` while live. Expected: matches PowerPoint, fallback to PNG then Resume works.
- [ ] **Step 4: Commit** `feat: PowerPoint bridge and engine`

### Task 6: Capture into the output and sound

**Files:**
- Create: `src/main/slideshow/capture.ts`, `src/main/slideshow/capture.test.ts`, `src/main/slideshow/audio-pipe.ts`, `src/renderer/src/pcm-source.worklet.ts`
- Modify: `src/renderer/src/stream.ts`, `src/renderer/src/stream.test.ts`, `StreamLayer.tsx`, `src/renderer/src/model.ts`, `src/renderer/src/model.test.ts`, `src/renderer/src/output-audio.ts`, `src/shared/ipc.ts`, preload, `src/main/index.ts`

**Interfaces:**
- Consumes: Tasks 3–5; `StreamLayer` from the web-source plan.
- Produces:
  - `sourceIdForWindow(sources: { id: string }[], windowId: string): string | null` (matches `window:<windowId>:`).
  - `desktopConstraints(sourceId: string, canvas: Canvas, fps: number): MediaStreamConstraints` (video only, `chromeMediaSource: 'desktop'`).
  - `outputSource` returns `{ kind: 'stream', source: 'desktop', deckId, poster, paused }` for a live deck with `shown.playback === 'native'`; `images` playback returns the PNG as today.
  - IPC `'slideshow:sourceId'` `[deckId]` → string (app windows only), `'slideshow:frame'` `[deckId]`; capture failure → that output shows the PNG and the capture copy is reported.
  - `audio-pipe.ts` reads the named pipe and forwards PCM blocks to the output windows over a `MessagePort` (as the OMT tap does in reverse); `pcm-source.worklet.ts` plays them into `OutputAudio`'s gain node. Pipe missing → bridge `setVolume(effectiveGain)` fallback and the default-device copy.

- [ ] **Step 1: Write failing tests** for `sourceIdForWindow`, `desktopConstraints`, and `outputSource` for native / fallback / vector decks.
- [ ] **Step 2: Run** `npx vitest run src/main/slideshow/capture.test.ts src/renderer/src/stream.test.ts src/renderer/src/model.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npx vitest run`, `npm run typecheck`, `npm run lint`. Ask the user to confirm picture and sound on HDMI and OMT on Windows. Expected: PASS.
- [ ] **Step 5: Commit** `feat: capture the slideshow window and its sound into the outputs`

### Task 7: Vector PDF layer

**Files:**
- Create: `src/renderer/src/pdf-render.ts`, `src/renderer/src/pdf-render.test.ts`, `src/renderer/src/components/PdfLayer.tsx`
- Modify: `src/renderer/src/model.ts`, `src/renderer/src/model.test.ts`, `SlideLayers.tsx`, `src/renderer/src/components/layers.ts`

**Interfaces:**
- Produces:
  - `pdfRenderSize(stage: { width: number; height: number }, page: { width: number; height: number }, fit: DeckFit, dpr: number): { width: number; height: number; scale: number }`.
  - `outputSource` returns `{ kind: 'pdf', url: slide://<deck>/source.pdf, page: index + 1, poster, fit }` for `vector` playback.
  - `PdfLayer`: loads the document once per deck (cache by URL), renders the page into a `<canvas>` at `pdfRenderSize`, renders the next page in a hidden canvas ahead, reveals after render, render error → poster PNG + console error. Same reveal/fade contract as image layers.

- [ ] **Step 1: Write failing tests** for `pdfRenderSize` (contain/cover/stretch, dpr 2) and `outputSource` for a vector deck.
- [ ] **Step 2: Run** `npx vitest run src/renderer/src/pdf-render.test.ts src/renderer/src/model.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npx vitest run`, `npm run typecheck`, `npm run lint`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: vector PDF playback`

### Task 8: Edit in PowerPoint and Revert

**Files:**
- Create: `src/main/slideshow/editor.ts`, `src/main/slideshow/editor.test.ts`
- Modify: `src/main/library.ts`, `src/main/library.test.ts`, `src/shared/ipc.ts`, preload, `src/main/index.ts`

**Interfaces:**
- Produces:
  - `Library.replaceDeckFiles(deckId: string, imported: ImportedDeck): DeckMeta` (replaces PNGs, notes, clicks, hidden, `source.*`, `source.pdf`; keeps name, fit, audio; keeps playback unless it was the import default `vector` and the deck is no longer static → `native`).
  - `Library.revertDeck(deckId)` copies `original.*` over `source.*` then the caller re-imports; `Library.isEdited(deckId): boolean`.
  - `class DeckEditor`: `edit(deckId)` (copy `source` → `edit`, bridge `edit`), watch `edit.*` (`fs.watch`, 1000 ms debounce) and `done(deckId)`; re-export through the existing import queue; `pending(deckId): boolean` while live; `applyNow(deckId)`; failure keeps the old files and reports the copy.
  - IPC `'deck:edit'`, `'deck:editDone'`, `'deck:applyNow'`, `'deck:revert'`, `'deck:setPlayback'`; broadcast `'deck:pending'` `{ deckId, pending }`.

- [ ] **Step 1: Write failing tests**: `replaceDeckFiles` playback rule and kept fields; `revertDeck` + `isEdited`; `DeckEditor` with fakes: save while live → pending, nothing replaced; leave air → replaced; applyNow → replaced; failing export → old files kept.
- [ ] **Step 2: Run** `npx vitest run src/main/slideshow/editor.test.ts src/main/library.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npx vitest run`, `npm run typecheck`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: edit in PowerPoint and revert to the imported file`

### Task 9: Operator UI

Load `impeccable:impeccable` first; follow `DESIGN.md`.

**Files:**
- Modify: `Library.tsx`, `Strip.tsx`, `Program.tsx`, `NextPanel.tsx`, `src/renderer/src/model.ts`, `src/renderer/src/model.test.ts`

**Interfaces:**
- Produces:
  - `stepLabel(s: ProgramState, decks: DeckMeta[]): string | null` → `'Slide 4 · step 2/3'` for a live native deck with clicks, else null.
  - `nextStepText(s, decks): string | null` → `'Next: step 3 of 3 on this slide'` while steps remain.
  - `playbackChip(d: DeckMeta, engine: 'opening' | 'ready' | 'fallback' | null): string` → `'Native · Opening…'`, `'Native · Ready'`, `'Native · Fallback'`, `'Vector'`, `'Still images'`.
  - Strip marks `'<n> clicks'` and dimmed **Hidden** slides; deck menu **Edit in PowerPoint**, **Revert to imported file** (enabled when edited), **Playback: Native / Vector / Still images** (`menuitemradio`); pending banner with **Apply now** (confirm); fallback warning with **Resume PowerPoint**.

- [ ] **Step 1: Write failing tests** for the three helpers.
- [ ] **Step 2: Run** `npx vitest run src/renderer/src/model.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npx vitest run`, `npm run typecheck`, `npm run lint`; check in `npm run dev` (FakeEngine), keyboard only, both themes. Expected: PASS.
- [ ] **Step 5: Commit** `feat: native slideshow controls in the operator window`

### Task 10: End to end and docs

**Files:**
- Modify: `e2e/smoke.mjs`, `PRODUCT.md`, `docs/test-checklist.md`, `docs/superpowers/specs/2026-10-06-ppt-share-design.md`

- [ ] **Step 1: Smoke checks** with `PPT_ENGINE_FAKE=1` and a deck JSON fixture with `playback: 'native'` and clicks `[3,0,1]`: Next walks the steps (Up next text), the fake engine `crash()` → output shows the PNG of the same slide, Resume → native again; edit saved while live stays pending until the deck leaves air; a PDF deck renders a `<canvas>` layer; a broken `source.pdf` page falls back to its PNG.
- [ ] **Step 2: Run** `npm run test:e2e`. Expected: all pass.
- [ ] **Step 3: Docs**: `PRODUCT.md` (remove "Animations, video and audio inside slides are not supported"; live PowerPoint moves into scope; Native / Vector / Still images; Edit and Revert), main spec, checklist items from the spec.
- [ ] **Step 4: Commit** `test: native slideshow end to end; docs`
