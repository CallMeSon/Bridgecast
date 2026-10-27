# Canvas and Audio Levels Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Program gets a configurable pixel Canvas (machine default, per-event override), per-deck Fit / Fill / Stretch, and per-deck plus master volume, applied in the HDMI output.

**Architecture:** Pure helpers in `src/shared` (canvas, audio levels) are sanitized at every boundary (settings, library JSON, IPC). Main resolves the Canvas into `ProgramState.canvas` the same way it sets `kvUrl`; `ShownSlide` carries the live deck's `fit` and `audio`, refreshed by `locateShown` without a new take. The output renders a Canvas-sized stage scaled into the window and routes video sound through one Web Audio `GainNode`.

**Tech Stack:** Electron 45, electron-vite, React 19, TypeScript, Vitest (node environment), Playwright `_electron` smoke test (`e2e/smoke.mjs`).

**Spec:** `docs/superpowers/specs/2026-10-27-canvas-audio-levels-design.md`

## Global Constraints

- UI copy is English; every error names the problem and the fix. Exact strings: `Use a width and height from 320 to 7680 pixels, at most 3840×2160 in total.`, `Connect the HDMI display first.`, `Changing the canvas changes what the audience sees. Change it now?`
- Canvas: integers, each side 320–7680, `width*height ≤ 3840*2160`, each side rounded **down** to an even number before the range check. Machine default `1920×1080`. Presets `1920×1080`, `3840×2160`, `1280×720`.
- Fit values `'fit' | 'fill' | 'stretch'`, default `'fit'`; CSS `contain` / `cover` / `fill`. Thumbnails in the strip stay `contain`. KV is always `contain`.
- Volume: integer 0–100 (rounded, clamped), deck default `{ volume: 100, muted: false }`, master default 100. Gain = 0 if deck or master muted, else `(deck/100) * (master/100)`. Gain changes use `gain.setTargetAtTime(target, ctx.currentTime, 0.015)`.
- Old data without the new fields (settings.json, deck JSON, events JSON) loads with defaults and never throws.
- Changing fit or volume of the live deck never changes `take` (a video slide must not replay).
- Follow surrounding code: short JSDoc on exported functions explaining why, existing error-message style, tests next to the file (`*.test.ts`).
- Before using an Electron, Web Audio or Playwright API you have not used in this repo, check it with Context7 (`mcp__plugin_context7_context7__query-docs`).
- UI tasks (8, 9): load the `impeccable:impeccable` skill first and follow `DESIGN.md` and `PRODUCT.md` (dark theme, state by text and shape not colour alone, keyboard operable, WCAG 2.1 AA).
- Git has no global identity on this machine. Commit with `git -c user.name="Gerson Sebastian" -c user.email="sebastiangerson24@gmail.com" commit ...` and end each message with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`. Never stage `package.json`, `package-lock.json` or `docs/superpowers/plans/2026-10-27-canva-import.md` (unrelated local changes).
- Checks before each commit: `npx vitest run <changed test files>`, and `npm run typecheck` when types changed.

## Review Focus

1. Library and settings written by an older build (no `fit`, `audio`, `canvas`, `masterVolume`; or garbage values) must load with defaults. Tests in Task 1, 2, 3.
2. Changing Fit or volume while a video slide is live must update the output without replaying the video (`take` unchanged, same layer). Tests in Task 4 and Task 10.
3. Custom canvas input `0`, `-5`, `"abc"`, `1919`, `7681`, `3840×2161`: rejected with the exact message or rounded down to even. Tests in Task 1.
4. A saved audio device that `AudioContext.setSinkId` rejects, or no `AudioContext` at all: video still plays (default device, `element.volume` fallback). Tests in Task 7.
5. Switching events switches the canvas at once (override → default and back), also while a slide of the old event is live. Tests in Task 4.

---

## File Structure

- Create `src/shared/canvas.ts`: Canvas types, limits, presets, `sanitizeCanvas`, `resolveCanvas`, `canvasLabel`, `displayCanvas`, `DeckFit`, `sanitizeFit`, `isDeckFit`, copy constants.
- Create `src/shared/audio-levels.ts`: `DeckAudio`, `sanitizeVolume`, `sanitizeDeckAudio`, `effectiveGain`.
- Modify `src/shared/settings.ts` (`Settings.canvas`, `AudioSettings.masterVolume`), `src/main/settings.ts` (defaults).
- Modify `src/shared/types.ts` (`DeckMeta.fit?`, `DeckMeta.audio?`, `EventMeta.canvas?`), `src/main/library.ts` (sanitize on load, three setters).
- Modify `src/shared/program.ts` (`ShownSlide.fit?/audio?`, `ProgramState.canvas`, `moveTo`, `locateShown`), `src/main/state.ts` (canvas resolution, `same`).
- Modify `src/shared/ipc.ts`, `src/preload/index.ts`, `src/main/index.ts` (four channels, `SettingsStore.saveCanvas`).
- Create `src/renderer/src/stage.ts`; modify `src/renderer/src/model.ts` (`OutputMedia.fit`, `outputGain`, `needsCanvasConfirm`), `src/renderer/src/components/layers.ts`, `SlideLayers.tsx`, `src/renderer/src/OutputView.tsx`, `src/renderer/src/components/Program.tsx`, `src/renderer/src/styles/output.css`.
- Create `src/renderer/src/output-audio.ts`.
- Create `src/renderer/src/components/CanvasPicker.tsx`, `EventCanvasDialog.tsx`, `AudioSection.tsx`, `DeckSound.tsx`; modify `OutputMenu.tsx`, `HdmiSection.tsx`, `EventMenu.tsx`, `Header.tsx`, `Library.tsx`.
- Modify `e2e/smoke.mjs`, `PRODUCT.md`, `docs/test-checklist.md`, `docs/superpowers/specs/2026-10-09-video-slides-design.md`.

---

### Task 1: Canvas helpers and machine default

**Files:**
- Create: `src/shared/canvas.ts`, `src/shared/canvas.test.ts`
- Modify: `src/shared/settings.ts`, `src/main/settings.ts`, `src/main/settings.test.ts`

**Interfaces:**
- Produces:
  - `interface Canvas { width: number; height: number }`
  - `interface ResolvedCanvas extends Canvas { origin: 'event' | 'default' }`
  - `DEFAULT_CANVAS: Readonly<Canvas>` (1920×1080), `CANVAS_PRESETS: readonly Canvas[]`
  - `CANVAS_INVALID`, `CANVAS_NO_HDMI`, `CANVAS_CHANGE_LIVE` (exact strings above)
  - `sanitizeCanvas(raw: unknown): Canvas | null`
  - `resolveCanvas(eventCanvas: Canvas | null | undefined, machine: Canvas): ResolvedCanvas`
  - `canvasLabel(c: ResolvedCanvas): string` → `'3840×1080 (event)'` / `'1920×1080 (default)'` (× is U+00D7)
  - `displayCanvas(d: { width: number; height: number } | null): Canvas | null` (= `sanitizeCanvas` of the display size; null for null)
  - `type DeckFit = 'fit' | 'fill' | 'stretch'`, `DECK_FITS: readonly DeckFit[]`, `isDeckFit(v: unknown): v is DeckFit`, `sanitizeFit(raw: unknown): DeckFit`
  - `Settings.canvas: Canvas`; `DEFAULT_SETTINGS.canvas = DEFAULT_CANVAS`

- [ ] **Step 1: Write failing tests** in `canvas.test.ts`:
  - `sanitizeCanvas({width:1920,height:1080})` → same; `{width:1921,height:1081}` → `{1920,1080}`; `{width:3840,height:1080}` → same; `{width:7681,height:400}` → `{7680,400}`; `{width:3840,height:2161}` → `{3840,2160}`; `{width:3842,height:2160}` → `null` (over total); `{width:318,height:1080}` → `null`; `{width:0,...}`, `{width:-5,...}`, `{width:'abc',...}`, `{width:NaN,...}`, `null`, `[]` → `null`.
  - `resolveCanvas(undefined, {1920,1080})` → `{1920,1080,origin:'default'}`; `resolveCanvas({3840,1080}, {1920,1080})` → origin `'event'`; `resolveCanvas({1,1} as Canvas, m)` → default (invalid override ignored).
  - `canvasLabel` both origins; `displayCanvas({width:5760,height:1080})` → same; `displayCanvas(null)` → null.
  - `sanitizeFit('fill')` → `'fill'`; `sanitizeFit('cover')`, `undefined` → `'fit'`; `isDeckFit('stretch')` true, `isDeckFit('x')` false.
- [ ] **Step 2: Add tests** in `src/main/settings.test.ts`: a settings file without `canvas` loads `canvas` = 1920×1080; `canvas: {width: 10, height: 10}` → default; `canvas: {width: 3840, height: 1080}` kept and survives `saveSettings` → `loadSettings`.
- [ ] **Step 3: Run** `npx vitest run src/shared/canvas.test.ts src/main/settings.test.ts`. Expected: FAIL (module/field missing).
- [ ] **Step 4: Implement** `src/shared/canvas.ts`; add `canvas` to `Settings`, `sanitizeSettings` (`sanitizeCanvas(r.canvas) ?? { ...DEFAULT_CANVAS }`) and `DEFAULT_SETTINGS`. Rounding: `Math.floor(n)` then `n - (n % 2)`, then range checks.
- [ ] **Step 5: Run** the same command and `npm run typecheck`. Expected: PASS.
- [ ] **Step 6: Commit** `feat: canvas size helpers and machine default canvas`

### Task 2: Audio level helpers and master volume

**Files:**
- Create: `src/shared/audio-levels.ts`, `src/shared/audio-levels.test.ts`
- Modify: `src/shared/settings.ts`, `src/main/settings.test.ts`

**Interfaces:**
- Produces:
  - `interface DeckAudio { volume: number; muted: boolean }`, `DEFAULT_DECK_AUDIO: Readonly<DeckAudio>`
  - `sanitizeVolume(raw: unknown, fallback = 100): number`
  - `sanitizeDeckAudio(raw: unknown): DeckAudio`
  - `effectiveGain(deck: DeckAudio, master: { masterVolume: number; muted: boolean }): number`
  - `AudioSettings.masterVolume: number` (default 100), sanitized in `sanitizeAudio`

- [ ] **Step 1: Write failing tests** in `audio-levels.test.ts`: `sanitizeVolume(55.6)` → 56; `-3` → 0; `140` → 100; `'x'`, `NaN`, `undefined` → 100; `sanitizeVolume(undefined, 70)` → 70. `sanitizeDeckAudio({volume: 40, muted: true})` → same; `{}` / `null` → `{100,false}`; `{volume: 40, muted: 'yes'}` → `{40,false}`. `effectiveGain({100,false},{masterVolume:100,muted:false})` → 1; `{50,false}` × master 50 → 0.25; deck muted → 0; master muted → 0; deck 0 → 0.
- [ ] **Step 2: Add tests** in `src/main/settings.test.ts`: audio without `masterVolume` → 100; `masterVolume: 250` → 100; `masterVolume: 30` kept.
- [ ] **Step 3: Run** `npx vitest run src/shared/audio-levels.test.ts src/main/settings.test.ts`. Expected: FAIL.
- [ ] **Step 4: Implement** `audio-levels.ts`; add `masterVolume` to `AudioSettings`, `DEFAULT_AUDIO`, `sanitizeAudio` (uses `sanitizeVolume`). Update the `AudioSettings` JSDoc: the master volume applies to every output sound.
- [ ] **Step 5: Run** the same command and `npm run typecheck`; fix any `AudioSettings` literal in existing tests by adding `masterVolume: 100`. Expected: PASS.
- [ ] **Step 6: Commit** `feat: deck and master audio levels`

### Task 3: Library stores fit, deck audio and event canvas

**Files:**
- Modify: `src/shared/types.ts`, `src/main/library.ts`, `src/main/library.test.ts`

**Interfaces:**
- Consumes: Task 1 `Canvas`, `DeckFit`, `isDeckFit`, `sanitizeFit`, `sanitizeCanvas`, `CANVAS_INVALID`; Task 2 `DeckAudio`, `sanitizeDeckAudio`.
- Produces:
  - `DeckMeta.fit?: DeckFit`, `DeckMeta.audio?: DeckAudio`, `EventMeta.canvas?: Canvas`
  - `Library.setDeckFit(eventId: string, deckId: string, fit: unknown): DeckMeta` — non-`DeckFit` throws `The display mode is not valid. Choose Fit, Fill or Stretch.`
  - `Library.setDeckAudio(eventId: string, deckId: string, audio: unknown): DeckMeta` — stored sanitized
  - `Library.setEventCanvas(eventId: string, canvas: unknown | null): EventMeta` — `null` removes the override; invalid throws `CANVAS_INVALID`
  - Loading: `readDeck` returns `fit` and `audio` only when present and valid (invalid stored values are dropped, not thrown); `listEvents` drops an invalid stored `canvas` (same place `sanitizeSections` runs).

- [ ] **Step 1: Write failing tests** in `library.test.ts` (follow its temp-dir fixtures):
  - `setDeckFit` persists `'fill'` (re-read through a new `Library` on the same root); `'cover'` throws the message; a deck not in the event throws the existing "Deck not found in this event…" message.
  - `setDeckAudio(…, {volume: 140, muted: true})` stores `{100, true}`.
  - `setEventCanvas` stores `{3840,1080}`, `null` removes the key, `{width: 10, height: 10}` throws `CANVAS_INVALID`.
  - A deck JSON written with `fit: 'zoom', audio: 'loud'` and an events JSON with `canvas: {width:'a'}` load without throwing and without those fields.
- [ ] **Step 2: Run** `npx vitest run src/main/library.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** the type fields, load-time cleanup and the three setters in `library.ts` (reuse `readDeck`/`writeDeck`, `findEvent`, atomic event write and the existing deck-in-event check).
- [ ] **Step 4: Run** the same command and `npm run typecheck`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: store deck fit, deck audio and event canvas`

### Task 4: Program state carries canvas, fit and deck audio

**Files:**
- Modify: `src/shared/program.ts`, `src/shared/program.test.ts`, `src/main/state.ts`, `src/main/state.test.ts`, `src/main/index.ts:529`

**Interfaces:**
- Consumes: Tasks 1–3.
- Produces:
  - `ShownSlide.fit?: DeckFit`, `ShownSlide.audio?: DeckAudio`; `moveTo` always sets both from the deck (`sanitizeFit(deck.fit)`, `sanitizeDeckAudio(deck.audio)`).
  - `DeckLike = Pick<DeckMeta, 'id' | 'slides' | 'fit' | 'audio'>`.
  - `locateShown` also refreshes `fit` and `audio` from the deck. It returns the **same object** when index, `(shown.fit ?? 'fit')` and `shown.audio ?? DEFAULT_DECK_AUDIO` (volume and muted) all match the deck's sanitized values; else a new object. `take` is never touched.
  - `ProgramState.canvas: ResolvedCanvas`; `initialState.canvas = { ...DEFAULT_CANVAS, origin: 'default' }`. Set by main only, never by `reduce`.
  - `new AppState(lib, autoAdvance = false, machineCanvas: () => Canvas = () => DEFAULT_CANVAS)`; `normalize` sets `canvas = resolveCanvas(activeEvent?.canvas, machineCanvas())`; `same()` also compares canvas width/height/origin, `shown.fit`, `shown.audio.volume`, `shown.audio.muted`.
  - `src/main/index.ts`: `new AppState(lib, settings.get().autoAdvance, () => settings.get().canvas)`.

- [ ] **Step 1: Write failing tests** in `program.test.ts`: `next` onto a deck with `fit: 'fill', audio: {40,false}` gives `shown.fit === 'fill'`, `shown.audio` `{40,false}`; `reconcile` after the live deck's fit changes to `'stretch'` gives the new fit with the **same `take`**; `locateShown` with unchanged deck returns the identical object (`toBe`); old-style `shown` without fit/audio on a deck without them returns the identical object.
- [ ] **Step 2: Write failing tests** in `state.test.ts`: a fresh state has canvas `{1920,1080,'default'}`; an event with `canvas {3840,1080}` selected → `{3840,1080,'event'}`; selecting another event without override → back to default, also while a slide of the first event is `shown`; a changed `machineCanvas()` plus `refresh()` emits a new state; `setDeckAudio` on the live deck plus `refresh()` emits a state with the new `shown.audio` and the same `take`.
- [ ] **Step 3: Run** `npx vitest run src/shared/program.test.ts src/main/state.test.ts`. Expected: FAIL.
- [ ] **Step 4: Implement** in `program.ts`, `state.ts`, `index.ts` as listed.
- [ ] **Step 5: Run** `npx vitest run` (all) and `npm run typecheck`. Expected: PASS.
- [ ] **Step 6: Commit** `feat: program state carries canvas, fit and deck audio`

### Task 5: IPC for fit, deck audio and canvas

**Files:**
- Modify: `src/shared/ipc.ts`, `src/preload/index.ts`, `src/preload/index.d.ts` (if it declares `Api`), `src/main/index.ts`

**Interfaces:**
- Consumes: Task 3 setters, Task 1 `sanitizeCanvas`, `CANVAS_INVALID`.
- Produces (invoke channels, `InvokeMap`, `Invoke` keys, `Api` methods):
  - `'decks:setFit'` `[eventId, deckId, fit: DeckFit]` → `DeckMeta`; `Invoke.decksSetFit`; `api.setDeckFit(eventId, deckId, fit)`
  - `'decks:setAudio'` `[eventId, deckId, audio: DeckAudio]` → `DeckMeta`; `Invoke.decksSetAudio`; `api.setDeckAudio(...)`
  - `'events:setCanvas'` `[eventId, canvas: Canvas | null]` → `EventMeta`; `Invoke.eventsSetCanvas`; `api.setEventCanvas(...)`
  - `'canvas:setDefault'` `[canvas: Canvas]` → `Settings`; `Invoke.canvasSetDefault`; `api.setDefaultCanvas(canvas)`
  - `SettingsStore.saveCanvas(canvas: Canvas): Settings` (same pattern as `saveAudio`).
  - Every handler: `assertString` for ids (existing helper), then the library/settings call, then `state.refresh()` so `program:state` carries the change. `canvas:setDefault` with an invalid canvas throws `CANVAS_INVALID`.

- [ ] **Step 1: Implement** the channels, preload methods and handlers.
- [ ] **Step 2: Run** `npm run typecheck` and `npx vitest run`. Expected: PASS (behaviour is covered end to end in Task 10).
- [ ] **Step 3: Commit** `feat: IPC for deck fit, deck audio and canvas`

### Task 6: Canvas stage and Fit in the output

**Files:**
- Create: `src/renderer/src/stage.ts`, `src/renderer/src/stage.test.ts`
- Modify: `src/renderer/src/model.ts`, `src/renderer/src/model.test.ts`, `src/renderer/src/components/layers.ts`, `src/renderer/src/layers.test.ts`, `src/renderer/src/components/SlideLayers.tsx`, `src/renderer/src/OutputView.tsx`, `src/renderer/src/components/Program.tsx`, `src/renderer/src/styles/output.css`, `src/renderer/src/styles/app.css`

**Interfaces:**
- Consumes: `ProgramState.canvas`, `ShownSlide.fit` (Task 4).
- Produces:
  - `stageRect(canvas: Canvas, box: { width: number; height: number }): { width: number; height: number; left: number; top: number }` — largest rect with the canvas aspect inside `box`, centred.
  - `OutputMedia` image and video variants gain `fit: DeckFit`; KV and STANDBY KV use `'fit'`.
  - `LayerSpec.fit: DeckFit`; `layerFor` copies it. In `SlideLayers`, a new media with the **same layer id** but another `fit` updates that layer's `fit` in place (no new layer, no fade, video keeps playing).
  - Each layer element gets `data-fit`; CSS maps `fit` → `contain`, `fill` → `cover`, `stretch` → `fill` for `img` and `video`.
  - `OutputView` wraps the layers in `<div className="output-stage" data-canvas="WxH">` positioned with `stageRect` against the window size (updates on `resize`); outside the stage stays black.
  - Program monitor frame uses `aspect-ratio: W / H` from `program.canvas`.

- [ ] **Step 1: Write failing tests**: `stageRect({3840,1080},{1920,1080})` → `{1920,540,0,270}`; `stageRect({1920,1080},{1920,1080})` → `{1920,1080,0,0}`; `stageRect({1080,1920},{1920,1080})` → `{607.5,1080,656.25,0}`. `outputSource` returns `fit: 'fill'` for a shown slide with `fit: 'fill'`, `'fit'` for KV and for `shown` without fit. `layerFor` keeps `fit`.
- [ ] **Step 2: Run** `npx vitest run src/renderer/src/stage.test.ts src/renderer/src/model.test.ts src/renderer/src/layers.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** as listed.
- [ ] **Step 4: Run** the same command, `npm run typecheck`, `npm run lint`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: canvas stage and fit modes in the output`

### Task 7: Output sound through one GainNode

**Files:**
- Create: `src/renderer/src/output-audio.ts`, `src/renderer/src/output-audio.test.ts`
- Modify: `src/renderer/src/model.ts`, `src/renderer/src/model.test.ts`, `src/renderer/src/components/SlideLayers.tsx`, `src/renderer/src/OutputView.tsx`

**Interfaces:**
- Consumes: Task 2 `effectiveGain`, `DEFAULT_DECK_AUDIO`; `ShownSlide.audio`.
- Produces:
  - `outputGain(s: ProgramState, audio: AudioSettings | null): number` in `model.ts` = `effectiveGain(s.shown?.audio ?? DEFAULT_DECK_AUDIO, audio ?? DEFAULT_AUDIO)`.
  - `class OutputAudio` in `output-audio.ts`:
    - `constructor(create: () => AudioContext = () => new AudioContext())`
    - `attach(v: HTMLVideoElement): void` — `createMediaElementSource(v)` → shared `GainNode` → `destination`, once per element. If `create()` or `createMediaElementSource` throws, switch to fallback (log once) and use `v.volume = gain`.
    - `setGain(g: number): void` — `gain.setTargetAtTime(g, ctx.currentTime, 0.015)`; fallback: set `volume` on every attached element.
    - `setSink(id: string): Promise<void>` — `ctx.setSinkId(id)`; on rejection log and call `HTMLMediaElement.setSinkId(id)` on attached elements (old behaviour); in fallback mode always the element path.
    - `readonly fallback: boolean`; `close(): void`.
  - `SlideLayers` gets optional `audio?: OutputAudio`. When given, each video element is attached to it instead of `applySink`; without it (Program monitor) behaviour is unchanged.
  - `OutputView` owns one `OutputAudio`, calls `setGain(outputGain(program, audio))` and `setSink(sink)` on change, and writes `data-gain={gain.toFixed(2)}` on the `.output` root. The existing `muted` logic (`outputMuted`) stays.

- [ ] **Step 1: Write failing tests** in `output-audio.test.ts` with a hand-written fake context (records `createMediaElementSource`, `connect`, `setTargetAtTime`, `setSinkId`): attach connects source → gain → destination once even if called twice; `setGain(0.25)` calls `setTargetAtTime(0.25, <currentTime>, 0.015)`; a `create` that throws puts it in fallback and `setGain(0.4)` sets `volume` 0.4 on attached fakes; `setSink('dev')` rejected by the context falls back to the element `setSinkId('dev')`. In `model.test.ts`: `outputGain` for deck `{50,false}` and master 50 → 0.25; `audio` null → deck gain only; master muted → 0.
- [ ] **Step 2: Run** `npx vitest run src/renderer/src/output-audio.test.ts src/renderer/src/model.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** as listed.
- [ ] **Step 4: Run** the same command, `npm run typecheck`, `npm run lint`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: output sound through a gain node with deck and master volume`

### Task 8: Canvas UI

Load `impeccable:impeccable` first; follow `DESIGN.md`.

**Files:**
- Create: `src/renderer/src/components/CanvasPicker.tsx`, `src/renderer/src/components/EventCanvasDialog.tsx`
- Modify: `src/renderer/src/components/OutputMenu.tsx`, `EventMenu.tsx`, `Header.tsx`, `src/renderer/src/model.ts`, `src/renderer/src/model.test.ts`, styles as needed

**Interfaces:**
- Consumes: Task 1 constants and helpers, Task 5 `api.setDefaultCanvas`, `api.setEventCanvas`, `program.canvas`, `pickDisplay` (`src/shared/displays.ts`) with the saved HDMI `displayId` for Match HDMI display.
- Produces:
  - `needsCanvasConfirm(s: ProgramState): boolean` in `model.ts` — true unless `tally(s)` is `'idle'` (STANDBY) or `'black'`.
  - `CanvasPicker` props: `{ value: Canvas | null; allowDefault: boolean; hdmiDisplay: DisplayInfo | null; onChange(c: Canvas | null): void }`. Options: Use default (only when `allowDefault`), the three presets, Custom (width and height number inputs, applied on Enter or blur, invalid shows `CANVAS_INVALID` under the inputs), Match HDMI display (disabled with `CANVAS_NO_HDMI` when `hdmiDisplay` is null).
  - OutputMenu popover: new **Canvas** section (machine default). EventMenu: menuitem **Canvas for this event…** opening `EventCanvasDialog` for the active event.
  - Before any canvas change, `needsCanvasConfirm(program)` true → confirm with `CANVAS_CHANGE_LIVE` (existing confirm pattern, e.g. `ConfirmRemove` in `Library.tsx`).
  - Header shows `canvasLabel(program.canvas)` next to the output badge.

- [ ] **Step 1: Write failing tests** for `needsCanvasConfirm` (build states whose `tally` is each value): `'idle'` → false; `'black'` → false; `'live'` → true; `'frozen'` → true; `'kv'` → true.
- [ ] **Step 2: Run** `npx vitest run src/renderer/src/model.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** `needsCanvasConfirm` and the components.
- [ ] **Step 4: Run** `npx vitest run`, `npm run typecheck`, `npm run lint`; start `npm run dev` and check the popover, the dialog and the header in dark and light themes with keyboard only. Expected: PASS; controls reachable by Tab, labels read correctly.
- [ ] **Step 5: Commit** `feat: canvas settings for the machine and per event`

### Task 9: Deck sound, Fit menu and master volume UI

Load `impeccable:impeccable` first; follow `DESIGN.md`.

**Files:**
- Create: `src/renderer/src/components/AudioSection.tsx`, `src/renderer/src/components/DeckSound.tsx`
- Modify: `src/renderer/src/components/HdmiSection.tsx`, `OutputMenu.tsx`, `Library.tsx`, `src/renderer/src/model.ts`, `src/renderer/src/model.test.ts`

**Interfaces:**
- Consumes: Task 5 `api.setDeckFit`, `api.setDeckAudio`; existing `api.setAudio` (now with `masterVolume`).
- Produces:
  - `deckSoundLabel(a: DeckAudio | undefined): string | null` in `model.ts` — `null` for the default `{100,false}`, `'Deck sound: muted'`, `'Deck sound: 60%'`.
  - `AudioSection`: the audio device select and mute moved out of `HdmiSection` unchanged in behaviour, plus **Master volume** (range 0–100 with the number shown) and the mute switch relabelled **Mute all**. Rendered by `OutputMenu` below the HDMI section.
  - `DeckSound`: popover from the deck menu item **Sound…** with a 0–100 range plus number and a **Mute deck** switch. Changes preview locally at once and are saved through `api.setDeckAudio` debounced 150 ms (also flushed on close).
  - Deck menu: **Fit**, **Fill**, **Stretch** as `menuitemradio` with `aria-checked` for the deck's `sanitizeFit(deck.fit)`.
  - Deck row: small speaker icon (Phosphor) with `aria-label`/title = `deckSoundLabel(deck.audio)` when not null.

- [ ] **Step 1: Write failing tests** for `deckSoundLabel`: `undefined` → null; `{100,false}` → null; `{100,true}` → `'Deck sound: muted'`; `{60,false}` → `'Deck sound: 60%'`; `{60,true}` → `'Deck sound: muted'`.
- [ ] **Step 2: Run** `npx vitest run src/renderer/src/model.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** as listed.
- [ ] **Step 4: Run** `npx vitest run`, `npm run typecheck`, `npm run lint`; check in `npm run dev` with keyboard only (menu arrows, range with arrow keys) in both themes. Expected: PASS.
- [ ] **Step 5: Commit** `feat: deck sound, fit menu and master volume`

### Task 10: End-to-end checks and docs

**Files:**
- Modify: `e2e/smoke.mjs`, `PRODUCT.md`, `docs/test-checklist.md`, `docs/superpowers/specs/2026-10-09-video-slides-design.md`

**Interfaces:**
- Consumes: everything above; DOM hooks `.output-stage[data-canvas]`, layer `data-fit`, `.output[data-gain]`.

- [ ] **Step 1: Add smoke checks** (follow the existing structure and helpers in `smoke.mjs`):
  - Default: output `data-canvas="1920x1080"`.
  - `api.setEventCanvas(event, {width:3840,height:1080})` → output `data-canvas="3840x1080"`; select another event → `1920x1080`; select the first again → `3840x1080`.
  - `api.setDefaultCanvas({width: 10, height: 10})` rejects with the `CANVAS_INVALID` text.
  - Live image slide: `api.setDeckFit(…,'fill')` → top layer `data-fit="fill"`; `'stretch'` → `"stretch"`; KV on → `"fit"`.
  - Live video slide (existing video fixture): `api.setDeckAudio(…,{volume:50,muted:false})` with master 50 → `.output[data-gain="0.25"]`; the video layer element is the same node before and after (no replay) and `program.take` is unchanged; deck muted → `"0.00"`.
- [ ] **Step 2: Run** `npm run test:e2e`. Expected: all checks pass, including the existing ones.
- [ ] **Step 3: Docs**: `PRODUCT.md` Capabilities (Canvas, Fit/Fill/Stretch, deck and master volume, note that a build older than 2026-10-27 drops these settings when it saves); `docs/test-checklist.md` (odd LED resolution with Match HDMI display and Custom; Fit/Fill/Stretch of a 16:9 deck on an ultra-wide canvas; volume change during a live video slide without a click); in the video-slides spec mark "tanpa slider volume" and its audio rule as replaced by the canvas/audio-levels spec and the OMT spec.
- [ ] **Step 4: Commit** `test: canvas, fit and audio levels end to end; docs`
