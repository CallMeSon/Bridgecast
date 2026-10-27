# LibreOffice Engine and Linux Support Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On Linux (X11, Ubuntu/Zorin) the app imports PPT/PPTX and plays animated decks through LibreOffice Impress, with the same outputs, fallback, Edit and Revert as on Windows, and ships as AppImage and `.deb`.

**Architecture:** A `LibreOfficeEngine` implements the existing `SlideShowEngine` by spawning `lo-bridge` (Python 3 + UNO) that speaks the same JSON protocol as `ppt-bridge`. The bridge runs its own `soffice` with a separate profile for import and slideshows; the slideshow window's X11 id is captured like the PowerPoint window. Sound goes to a private PulseAudio/PipeWire null sink whose monitor the output captures.

**Tech Stack:** LibreOffice 26.2 (UNO, `XSlideShowController`), `python3-uno`, `pactl`, Electron 45 `desktopCapturer` on X11, electron-builder (AppImage, deb), Vitest, Python `unittest`.

**Spec:** `docs/superpowers/specs/2026-10-27-libreoffice-linux-design.md` (depends on the native-slideshow spec)

## Preconditions

- The native-slideshow plan is merged (`SlideShowEngine`, `BridgeClient`, `SlideShowManager`, `StreamLayer` desktop source, `PdfLayer`, `DeckEditor`, playback modes).
- Development machine: Zorin OS 18 on X11, LibreOffice 26.2.6.3, `python3-uno` installed (verified 2026-10-27). `git status` clean for `package.json` / `package-lock.json`.

## Global Constraints

- UI copy is English, exact strings from the spec: `Install LibreOffice Impress and python3-uno to import PowerPoint files, or export the file to PDF and import the PDF.`, `Animated slides need an X11 session on Linux. Log in with 'GNOME on Xorg' to play animations; showing still slides.`, `This deck uses fonts that are not installed: <list>. The layout may shift. Install them, or the metric-compatible Carlito, Caladea or Liberation fonts.`, `LibreOffice could not start. Close LibreOffice windows that are stuck, then press Resume LibreOffice. Showing still slides.`, `LibreOffice could not open this file. Open it in LibreOffice to check it, or export it to PDF and import the PDF.`, `LibreOffice may change animations or layout when it saves a PowerPoint file. The client's original file is not changed.`, `LibreOffice sound plays on this PC's default device only.`
- The app's `soffice` always runs with `-env:UserInstallation=file://<userData>/lo-profile --norestore --nologo --nodefault --accept=pipe,name=pptshare-<pid>;urp;` and `PULSE_SINK=pptshare_lo`. The user's own LibreOffice profile is never used except for Edit in LibreOffice.
- Engine choice is by platform only: win32 → PowerPoint, linux + X11 + LibreOffice + python3-uno → LibreOffice. No engine setting.
- Wayland (`XDG_SESSION_TYPE=wayland`): import works, `native` decks play as still images with the Wayland copy.
- The bridge protocol is byte-for-byte the one in `src/main/slideshow/bridge-protocol.ts`; do not fork it.
- Check Context7 / LibreOffice API docs before using `XSlideShowController`, `XSlideShowListener`, `XSystemDependentWindowPeer`, presentation properties, `impress_pdf_Export` filter options, and electron-builder `deb`/`AppImage` options.
- Commit with `git -c user.name="Gerson Sebastian" -c user.email="sebastiangerson24@gmail.com" commit ...`, message ending `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`. Never stage unrelated files.
- A task that fails more than 3 times (including on Opus) stops; report task, file, command and error to the user.

## Review Focus

1. The user's own LibreOffice is open with unsaved work when the app starts, crashes or resumes its instance: the user's window and document are never touched (separate profile, the app only kills its own pid). Test in Task 3.
2. A deck using Calibri/Segoe on a machine without them: import succeeds and lists the missing fonts once. Test in Task 4.
3. `pactl` missing or the null sink already exists from a crashed run: sound falls back or reuses the sink, never fails the show; the sink is unloaded on quit. Test in Task 5.
4. Click counting when an animation is "After Previous" or the slide auto-advances: the bridge's counter is corrected by slide-change events and the engine position wins. Test in Task 3.
5. Running under Wayland: no attempt to capture, the copy is shown, vector and web decks still work. Test in Task 2.

---

## File Structure

- `src/main/platform.ts` (+ test), `src/main/import/index.ts` (dispatch), `src/main/import/libreoffice.ts`
- `native/lo-bridge/bridge.py`, `native/lo-bridge/steps.py`, `native/lo-bridge/test_steps.py`, `native/lo-bridge/README.md`
- `src/main/slideshow/libreoffice-engine.ts`, `src/main/slideshow/pulse-sink.ts` (+ test), `src/shared/fonts.ts` (+ test)
- Renderer: monitor-device pick in `output-audio.ts`, engine labels in `model.ts` / `Library.tsx`
- `electron-builder.yml`, `README.md`, `PRODUCT.md`, `docs/test-checklist.md`, `test/integration/libreoffice.test.ts` (Vitest, skipped without `soffice`)

---

### Task 1: Linux spike (throwaway code, run by the agent)

**Files:**
- Create: `docs/superpowers/notes/libreoffice-spike.md` (results; code in the scratchpad, never committed)

- [ ] **Step 1:** Start `soffice` with the app flags and a scratch profile; connect from Python UNO; open `fixtures/sample-anim.pptx` hidden; start a windowed slideshow at 1920×1080 (`IsFullScreen=False`, `IsMouseVisible=False`); get the X11 window id via `XSystemDependentWindowPeer`; set `_NET_WM_STATE_SKIP_TASKBAR`.
- [ ] **Step 2:** In an Electron script, find the `desktopCapturer` source `window:<xid>:…` and play it. Expected: the slideshow is visible in the Electron window while it sits behind another window.
- [ ] **Step 3:** Step through every slide with `gotoNextEffect`/`gotoPreviousEffect` and log `XSlideShowListener` events; compare counts with Task 1 of the native plan.
- [ ] **Step 4:** `pactl load-module module-null-sink sink_name=pptshare_lo`; play the video slide; capture the monitor with `getUserMedia({ audio: { deviceId } })` in Electron. Expected: sound arrives, nothing on the speakers.
- [ ] **Step 5:** Import path: `storeToURL` PDF with hidden slides, notes, `Visible`, click counts from the animation nodes, static detection; two slideshows in one instance; latency and CPU.
- [ ] **Step 6: Gate.** Step 2 fails → stop and report (back to brainstorming). Else commit the notes `docs: LibreOffice spike results`.

### Task 2: Platform detection and import dispatch

**Files:**
- Create: `src/main/platform.ts`, `src/main/platform.test.ts`, `src/main/import/index.ts`
- Modify: `src/main/index.ts`, `src/main/import/pptx.ts` (export `importPptxPowerPoint`)

**Interfaces:**
- Produces:
  - `type EngineKind = 'powerpoint' | 'libreoffice' | 'none'`
  - `detectEngine(p: { platform: NodeJS.Platform; sessionType?: string; hasSoffice: boolean; hasPyUno: boolean }): { engine: EngineKind; canCapture: boolean; message?: string }` — win32 → powerpoint/capture; linux with both tools → libreoffice, `canCapture = sessionType !== 'wayland'` with the Wayland copy when false; linux missing a tool → none with the install copy.
  - `probeLinux(): Promise<{ hasSoffice: boolean; hasPyUno: boolean }>` (`which soffice`, `python3 -c "import uno"`), not unit tested.
  - `importPptx(file, outDir, width)` in `import/index.ts` dispatches to PowerPoint or LibreOffice (Task 4) and throws the install copy for `none`.
  - `SlideShowManager` gets `canCapture`; when false, takes of native decks use images with the Wayland copy.

- [ ] **Step 1: Write failing tests** for `detectEngine` (win32; linux x11 both tools; linux wayland; linux without soffice; without pyuno; darwin → none).
- [ ] **Step 2: Run** `npx vitest run src/main/platform.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** and wire into `index.ts`.
- [ ] **Step 4: Run** `npx vitest run`, `npm run typecheck`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: pick the slideshow engine by platform`

### Task 3: lo-bridge

**Files:**
- Create: `native/lo-bridge/bridge.py`, `native/lo-bridge/steps.py`, `native/lo-bridge/test_steps.py`, `native/lo-bridge/README.md`

**Interfaces:**
- Consumes: the protocol of `bridge-protocol.ts`.
- Produces:
  - `steps.py`: `class StepCounter` with `on_next_effect()`, `on_prev_effect()`, `on_slide_changed(index, clicks)` and `position() -> (index, step, clicks)`; slide change resets the step (to `clicks` when moving backwards by `prev`).
  - `bridge.py`: starts/owns `soffice` (flags from Global Constraints, `PULSE_SINK` from argv), connects over the pipe, serves `open`, `next`, `prev`, `goto`, `close`, `ping`, `edit` (`libreoffice --impress <edit file>` with the user's normal profile), `import` (Task 4), `shutdown`; emits `position` after every command and listener event, `error`, `exited`. Kills only the `soffice` pid it started (`Resume LibreOffice` path).

- [ ] **Step 1: Write failing tests** `python3 -m unittest native/lo-bridge/test_steps.py`: three next effects then slide change; prev from step 0 lands at `clicks`; slide change without effects (auto advance) resets.
- [ ] **Step 2: Run** the command. Expected: FAIL.
- [ ] **Step 3: Implement** `steps.py` and `bridge.py`.
- [ ] **Step 4: Run** the unit tests, then a manual session: `python3 native/lo-bridge/bridge.py` fed `open`/`next`/`pos` lines for `fixtures/sample-anim.pptx`, with your own LibreOffice document open alongside. Expected: PASS; positions match the spike; your document untouched after `shutdown`.
- [ ] **Step 5: Commit** `feat: LibreOffice bridge`

### Task 4: LibreOffice import and font check

**Files:**
- Create: `src/main/import/libreoffice.ts`, `src/shared/fonts.ts`, `src/shared/fonts.test.ts`
- Modify: `native/lo-bridge/bridge.py` (`import` command), `src/main/import/index.ts`

**Interfaces:**
- Produces:
  - Bridge `import { path, outDir }` → `{ name, width, height, pdf, notes: string[], clicks: number[], hidden: boolean[], isStatic: boolean, fonts: string[] }` (fonts from the pptx XML `typeface` attributes via `zipfile`, theme placeholders like `+mn-lt` excluded; `.ppt` → `[]`).
  - `missingFonts(used: string[], installed: string[]): string[]` (case-insensitive, unique, sorted) and `fontWarning(missing: string[]): string | null` (the font copy) in `fonts.ts`.
  - `importPptxLibreOffice(file, outDir, width): Promise<ImportedDeck & { warning?: string }>`: bridge import → PNGs from the PDF through the same pdf.js path the PDF import uses (render in a hidden renderer, or `pdfjs-dist` in a worker in main; choose one and state it in the code) → `ImportedDeck` like the PowerPoint path; `fc-list : family` for installed fonts; the warning is shown in the import progress row.
  - Failure → the LibreOffice open copy.

- [ ] **Step 1: Write failing tests** for `missingFonts` (case, duplicates, aliases kept literal) and `fontWarning` (empty → null, list joined with `, `).
- [ ] **Step 2: Run** `npx vitest run src/shared/fonts.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the test, `npm run typecheck`, then import `fixtures/sample-anim.pptx` and `fixtures/sample-4x3.pptx` in `npm run dev` on Linux. Expected: PASS; slide counts, clicks, hidden and static match the spike; missing fonts listed.
- [ ] **Step 5: Commit** `feat: import PowerPoint files with LibreOffice on Linux`

### Task 5: LibreOfficeEngine and sound sink

**Files:**
- Create: `src/main/slideshow/libreoffice-engine.ts`, `src/main/slideshow/pulse-sink.ts`, `src/main/slideshow/pulse-sink.test.ts`
- Modify: `src/main/index.ts`, `src/renderer/src/output-audio.ts`, `src/renderer/src/output-audio.test.ts`, `src/renderer/src/model.ts`, `src/renderer/src/model.test.ts`

**Interfaces:**
- Produces:
  - `LibreOfficeEngine implements SlideShowEngine` (spawns `python3 <resources>/lo-bridge/bridge.py`, dev path `native/lo-bridge/`).
  - `class PulseSink`: `ensure(): Promise<boolean>` (reuse an existing `pptshare_lo` sink, else `pactl load-module module-null-sink sink_name=pptshare_lo`; false when `pactl` is missing or fails), `remove(): Promise<void>` (unload only the module it loaded), pure `parseSinks(pactlListShort: string): string[]`.
  - Renderer `findMonitor(devices: { deviceId: string; label: string; kind: string }[]): string | null` (audioinput whose label contains `pptshare_lo`); the output captures it and connects it to the gain node while a LibreOffice deck is live; not found → default-device copy.
  - Engine-dependent labels: `engineName(kind: EngineKind): 'PowerPoint' | 'LibreOffice'` used for **Edit in …**, **Resume …** and fallback copy.

- [ ] **Step 1: Write failing tests**: `parseSinks`; `PulseSink.ensure` reuses an existing sink (fake exec), returns false on ENOENT; `findMonitor`; `engineName`.
- [ ] **Step 2: Run** `npx vitest run src/main/slideshow/pulse-sink.test.ts src/renderer/src/output-audio.test.ts src/renderer/src/model.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** and wire for linux.
- [ ] **Step 4: Run** `npx vitest run`, `npm run typecheck`, `npm run lint`; in `npm run dev` play `sample-anim.pptx` with the clicker on HDMI and (fake or real) OMT, check sound Local/OMT/Both. Expected: PASS.
- [ ] **Step 5: Commit** `feat: LibreOffice slideshow engine with a private sound sink`

### Task 6: Edit in LibreOffice

**Files:**
- Modify: `src/main/slideshow/editor.ts`, `src/main/slideshow/editor.test.ts`, `src/renderer/src/components/Library.tsx`

**Interfaces:**
- Produces: on linux, **Edit in LibreOffice** shows the save-warning confirm first, then `DeckEditor.edit` (bridge `edit`); Revert unchanged.

- [ ] **Step 1: Write failing test**: on engine `libreoffice`, `edit` requires the confirm flag (rejects without it).
- [ ] **Step 2: Run** `npx vitest run src/main/slideshow/editor.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** (UI confirm in `Library.tsx`; load `impeccable:impeccable` for the dialog).
- [ ] **Step 4: Run** `npx vitest run`, `npm run typecheck`; manual edit/save/revert in `npm run dev`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: edit in LibreOffice with a save warning`

### Task 7: Integration tests, packaging, docs

**Files:**
- Create: `test/integration/libreoffice.test.ts`
- Modify: `vitest.config.ts` (include `test/integration/**`), `electron-builder.yml`, `README.md`, `PRODUCT.md`, `docs/test-checklist.md`, `e2e/smoke.mjs`

- [ ] **Step 1: Integration tests** (`describe.skipIf(!hasSoffice)`): import both fixtures (slide count, clicks, hidden, static); bridge open → next per step → positions → close → ping after shutdown fails cleanly.
- [ ] **Step 2: Run** `npx vitest run test/integration`. Expected: PASS on this machine, skipped where `soffice` is missing.
- [ ] **Step 3: E2E**: run the native-slideshow smoke scenarios with the real LibreOffice engine when `PPT_E2E_LIBREOFFICE=1`; `npm run test:e2e` with and without it. Expected: PASS.
- [ ] **Step 4: Packaging**: `linux.target: [AppImage, deb]`; `deb.recommends: [libreoffice-impress, python3-uno]`; `extraResources` `native/lo-bridge` → `lo-bridge/`, Linux `libomt.so`/`libvmx.so` → `omt/`; Windows-only resources (`export-pptx.ps1`, `ppt-bridge/`, NSIS) excluded from Linux. Run `npm run build:linux`; install the `.deb` and start the AppImage on this machine. Expected: both start, import and play.
- [ ] **Step 5: Docs**: `README.md` (Linux install: LibreOffice Impress, `python3-uno`, Carlito/Caladea/Liberation fonts, X11 session), `PRODUCT.md` (Linux X11, LibreOffice engine, Wayland limit), checklist items from the spec.
- [ ] **Step 6: Commit** `test: LibreOffice integration; Linux packages and docs`
