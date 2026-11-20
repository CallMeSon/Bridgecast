# Realtime Zoom Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The operator can zoom and pan the live slide from the Program column (buttons plus a clickable/draggable minimap) and the HDMI output and the operator monitor show the same zoomed picture.

**Architecture:** Zoom lives in `ProgramState.zoom` (`{scale, cx, cy}`, pure reducer, new actions). A new pure module `src/shared/zoom.ts` holds all maths. `OutputView` (role `hdmi` only) and `Program.tsx` wrap `SlideLayers` in a CSS-transformed div. A new `ZoomControls` component sits under the monitor.

**Tech Stack:** Electron, React, TypeScript, Vitest (node env, no jsdom), Playwright e2e, Phosphor icons.

**Spec:** `docs/superpowers/specs/2026-11-20-realtime-zoom-design.md`

## Global Constraints

- Zoom `scale` range 1..4, step 1.25x; pan step 0.2 of the visible window; transition ~150 ms ease-out, none under `prefers-reduced-motion`.
- Zoom resets to `{scale:1, cx:0.5, cy:0.5}` on every new take (`take` increments) and on `offAir`. Freeze, black and KV never change it.
- OMT/NDI (`OutputView` role `omt`) must NOT zoom.
- Reducer returns the **same object** when an action is refused or changes nothing (`AppState` relies on that).
- Never black, never desktop: zoom only changes a transform; no layer is added or removed.
- Component logic that needs tests lives in plain `.ts` (node env, no jsdom). UI tasks load the `impeccable` skill and follow `DESIGN.md`/`PRODUCT.md`. Do not touch the dark palette.
- Lint has 8 known errors; add none. Prettier: no semicolons, single quotes, width 100.
- Commits: `git -c user.name="Gerson Sebastian" -c user.email="sebastiangerson24@gmail.com" commit ...`, stage only your own files.
- Plan execution per CLAUDE.md: sonnet/medium subagents; escalate to opus when stuck. Stop and report after 3 failures of one task.

## Review Focus

1. A malformed `zoomIn`/`zoomTo`/`zoomPan` payload over IPC (NaN, Infinity, strings, missing fields) must not corrupt state: reducer returns the same state (Task 2 test).
2. Non-16:9 Canvas (e.g. 1080x1920 portrait): minimap and pointer-to-centre maths stay correct (Task 1 test).
3. A take while **frozen** does not change `shown`, so it must not reset zoom (Task 2 test).
4. Zoomed + Interact on a live web page: a click on the monitor must reach the page at the right spot (Task 3 uses the transformed element's rect; Task 5 e2e or checklist).
5. Zoom pressed with nothing on the output (STANDBY, `shown === null`) is refused (Task 2 test).

---

## File Structure

- Create `src/shared/zoom.ts` + `src/shared/zoom.test.ts`: types and pure maths.
- Modify `src/shared/program.ts` (+ `program.test.ts`): `zoom` field, actions, resets.
- Modify `src/renderer/src/OutputView.tsx`, `src/renderer/src/styles/output.css`: zoom wrapper (role hdmi).
- Modify `src/renderer/src/components/Program.tsx`, `styles/app.css`: monitor wrapper, mount controls.
- Create `src/renderer/src/components/ZoomControls.tsx`: buttons and minimap.
- Modify `e2e/smoke.mjs`, `docs/test-checklist.md`.

---

### Task 1: Zoom maths module

**Files:**
- Create: `src/shared/zoom.ts`
- Test: `src/shared/zoom.test.ts`

**Interfaces:**
- Produces (all exported from `src/shared/zoom.ts`):
  - `interface Zoom { scale: number; cx: number; cy: number }`
  - `const ZOOM_OFF: Zoom` = `{ scale: 1, cx: 0.5, cy: 0.5 }`
  - `const ZOOM_MAX = 4`, `ZOOM_STEP = 1.25`, `PAN_STEP = 0.2`
  - `isZoomed(z: Zoom): boolean` (`scale > 1`)
  - `clampZoom(z: Zoom): Zoom`: scale to 1..4, then centre clamped to `[half, 1-half]` with `half = 1/(2*scale)`; any non-finite number returns `ZOOM_OFF`; at scale 1 the centre is 0.5/0.5.
  - `zoomBy(z: Zoom, factor: number): Zoom` (multiplies scale, clamps; keeps centre)
  - `panBy(z: Zoom, dx: number, dy: number): Zoom` (`dx, dy` in units of the visible window, e.g. `1` = one full visible width; clamps)
  - `centreOn(z: Zoom, cx: number, cy: number): Zoom` (clamps)
  - `zoomTransform(z: Zoom): string`: CSS value for an element with `transform-origin: 0 0` that fills the stage: `translate(${-(cx-half)*scale*100}%, ${-(cy-half)*scale*100}%) scale(${scale})`; returns `'none'` when not zoomed.
  - `viewRect(z: Zoom): { x: number; y: number; w: number; h: number }`: visible window as fractions of the canvas (`w = h = 1/scale`).
  - `pointToCentre(px: number, py: number): { cx: number; cy: number }` converts a pointer position inside the minimap, given as fractions 0..1 of its width/height, to a centre (pure clamp to 0..1; `centreOn` then clamps to the window).

- [ ] **Step 1: Write failing tests** in `zoom.test.ts`: `clampZoom` (scale 9 -> 4; scale 0.2 -> 1 with centre 0.5/0.5; scale 2 with `cx: 0` -> `0.25`; NaN/Infinity -> `ZOOM_OFF`), `zoomBy({1,.5,.5}, 1.25).scale === 1.25`, repeated `zoomBy` caps at exactly 4, `panBy` at scale 2 moves `cx` by `0.5 * 0.2` and stops at the edge, `centreOn` clamps, `zoomTransform(ZOOM_OFF) === 'none'`, `zoomTransform({scale:2,cx:0.75,cy:0.25})` equals `translate(-100%, 0%) scale(2)` after normalising `-0`, `viewRect({scale:2,cx:.75,cy:.25})` is `{x:.5,y:0,w:.5,h:.5}`, and `pointToCentre(1.5,-1)` -> `{cx:1,cy:0}`. Add a portrait-canvas case: all helpers are aspect independent (fractions), so assert `viewRect` has `w === h` in canvas fractions and note it in a comment.
- [ ] **Step 2:** Run `npx vitest run src/shared/zoom.test.ts`. Expected: FAIL (module missing).
- [ ] **Step 3:** Implement `src/shared/zoom.ts` with the signatures above. Normalise `-0` to `0` in `zoomTransform`.
- [ ] **Step 4:** Run `npx vitest run src/shared/zoom.test.ts`. Expected: PASS.
- [ ] **Step 5:** Commit `feat(zoom): pure zoom maths`.

---

### Task 2: Reducer state and actions

**Files:**
- Modify: `src/shared/program.ts` (`ProgramState` ~l.37, `Action` ~l.83, `initialState` ~l.116, `moveTo` ~l.135, `reduce` switch ~l.384, `offAir` ~l.488)
- Test: `src/shared/program.test.ts`

**Interfaces:**
- Consumes: Task 1 (`Zoom`, `ZOOM_OFF`, `ZOOM_STEP`, `PAN_STEP`, `clampZoom`, `zoomBy`, `panBy`, `centreOn`).
- Produces: `ProgramState.zoom: Zoom` and `Action` members
  `{ type: 'zoomIn' } | { type: 'zoomOut' } | { type: 'zoomPan'; dx: number; dy: number } | { type: 'zoomTo'; cx: number; cy: number } | { type: 'zoomReset' }`.

- [ ] **Step 1: Write failing tests** in `program.test.ts` (new `describe('zoom')`), using the file's existing deck fixtures:
  - `initialState.zoom` equals `ZOOM_OFF`.
  - `zoomIn` with a slide shown gives `scale 1.25`; `zoomOut` from there gives `scale 1`; `zoomReset` returns `ZOOM_OFF`.
  - `zoomPan {dx:1, dy:0}` at scale 2 moves `cx` right and clamps at `0.75`.
  - `zoomTo {cx:0.9, cy:0.1}` at scale 2 gives `{cx:0.75, cy:0.25}`.
  - Refused with the **same object** when: `shown === null` (STANDBY); `zoomOut`/`zoomReset` already at 1x; `zoomIn` already at 4x; `zoomPan` at 1x; payload NaN/Infinity/string (`zoomPan {dx:NaN,dy:0}`, `zoomTo {cx:'a' as never, cy:0}`).
  - `next` (a new take) resets zoom to `ZOOM_OFF`; `goto` and `selectDeck` too.
  - A take while `frozen` keeps zoom (shown unchanged). `enginePosition` (a step, not a take) keeps zoom.
  - `offAir` resets zoom. `toggleFreeze`, `toggleBlack`, `toggleKv` keep zoom.
- [ ] **Step 2:** Run `npx vitest run src/shared/program.test.ts -t zoom`. Expected: FAIL.
- [ ] **Step 3:** Implement. `zoom` is added to `ProgramState` (doc comment: "Zoom of the live picture; reset by every take and Off air. Set only by the zoom actions."). In `moveTo`, return `zoom: state.frozen || !newTake ? state.zoom : ZOOM_OFF`. In `offAir`, reset `zoom` (also treat a zoomed state as "changed" in its early-return guard). New `case`s guard with `state.shown !== null`, validate numbers with `Number.isFinite`, compute with the Task 1 helpers, and return `state` when the result equals the current zoom (compare the three fields).
- [ ] **Step 4:** Run `npx vitest run src/shared/program.test.ts`, then `npm run typecheck`. Fix every `ProgramState` literal the compiler flags (tests in `src/main/state.test.ts`, `src/main/web/*.test.ts`, `src/renderer/src/model.test.ts` build states). Expected: both PASS.
- [ ] **Step 5:** Run `npm test`. Expected: all PASS. Commit `feat(zoom): zoom state and actions in the reducer`.

---

### Task 3: Render zoom on the HDMI output and the operator monitor

**Files:**
- Modify: `src/renderer/src/OutputView.tsx` (stage block ~l.330-345), `src/renderer/src/styles/output.css`
- Modify: `src/renderer/src/components/Program.tsx` (monitor `screen` block ~l.100-140, `useMonitorInteract` call ~l.67), `src/renderer/src/styles/app.css` (near `.screen` ~l.1671)

**Interfaces:**
- Consumes: `zoomTransform` and `ProgramState.zoom` (Tasks 1, 2).
- Produces: wrapper `div` with class `zoom-layer`, `data-testid="output-zoom"` on the HDMI one and `"monitor-zoom"` on the monitor one, each with `data-zoom` = `scale.toFixed(2)`; CSS `.zoom-layer { position:absolute; inset:0; transform-origin:0 0; transition: transform 150ms ease-out; will-change: transform }`, no transition under `@media (prefers-reduced-motion: reduce)`.

- [ ] **Step 1:** In `OutputView.tsx`, wrap `<SlideLayers .../>` in `<div className="zoom-layer" data-testid="output-zoom" data-zoom=... style={{ transform: role === 'hdmi' ? zoomTransform(program.zoom) : 'none' }}>`. `.output-stage` already clips (`overflow:hidden`).
- [ ] **Step 2:** In `Program.tsx`, wrap the `SlideLayers`/`EndCard` ternary content in the same wrapper (`data-testid="monitor-zoom"`, transform from `state.zoom`). Keep `.shade` and the `pgm-capture` overlay **outside** the wrapper. Add a `zoom` ref to the wrapper and pass it to `useMonitorInteract` as the `page` ref instead of `screen`: `getBoundingClientRect()` of a transformed element is its zoomed box, so existing pointer mapping in `use-web-interact.ts` hits the right page coordinates with no other change. Keep `screen` for the rest.
- [ ] **Step 3:** Add the CSS to `output.css` and `app.css` (or one shared place both files can reach; the builder decides).
- [ ] **Step 4:** Run `npm run typecheck && npm run lint`. Expected: no new lint errors. Manually check with `npm run dev`: there is no UI yet, so temporarily dispatch from DevTools `window.api.dispatch({type:'zoomIn'})` (name per `preload/index.ts`) and confirm both the monitor and the HDMI window zoom, and the OMT offscreen renderer does not.
- [ ] **Step 5:** Commit `feat(zoom): render zoom on HDMI output and monitor`.

---

### Task 4: Zoom controls and minimap

**Files:**
- Create: `src/renderer/src/components/ZoomControls.tsx`
- Modify: `src/renderer/src/components/Program.tsx` (mount below `.pgm-view`, above `pgm-meta`), `src/renderer/src/styles/app.css`
- Test: add pointer maths cases to `src/shared/zoom.test.ts` if any new helper is needed (none expected; reuse `pointToCentre`).

**Interfaces:**
- Consumes: `Zoom`, `isZoomed`, `viewRect`, `pointToCentre`, `ZOOM_MAX`; `onAction(a: Action)`.
- Produces: `ZoomControls({ zoom, canvas, disabled, media, onAction }: { zoom: Zoom; canvas: { width: number; height: number }; disabled: boolean; media: ReturnType<typeof outputSource>; onAction(a: Action): void }): React.JSX.Element`.

Behavior (UI task: load the `impeccable` skill, follow `DESIGN.md`):
- Buttons with accessible names: "Zoom out", "Zoom in", "Reset zoom", "Pan left/right/up/down", and a visible scale label like `1.5x`. Icons from Phosphor. Each dispatches the Task 2 actions (`zoomPan` uses `dx/dy` of `±PAN_STEP`).
- Disabled rules: whole group disabled when `disabled` (nothing on the output: `state.shown === null`); zoom out and reset disabled at 1x; zoom in disabled at 4x; arrows disabled at 1x and at the matching canvas edge (from `viewRect`).
- Minimap: a box with `aspect-ratio: width / height` of the canvas, showing a still of the live picture when `media.kind === 'image'` (the image URL), else a neutral tile. A rectangle from `viewRect`. `onPointerDown` on the box sets the centre via `zoomTo` using `pointToCentre`; pointer capture plus `onPointerMove` while pressed drags it (throttle to one dispatch per animation frame). `role="group"` with `aria-label="Zoom position"` and visible-hidden text "Zoom centre 50% / 50%".
- Keyboard: arrow buttons are real buttons; no global shortcuts added.

- [ ] **Step 1:** Implement `ZoomControls.tsx` per the above and mount it in `Program.tsx` with `zoom={state.zoom}`, `canvas={state.canvas}`, `disabled={state.shown === null}`, `media={media}`, `onAction={onAction}`.
- [ ] **Step 2:** Add CSS using existing tokens only (`--panel`, `--raised`, `--line-hi`, `--tally`, ...). Layout: buttons left, minimap right, wrapping under 560 px width. Check light and dark theme.
- [ ] **Step 3:** Run `npm run typecheck && npm run lint && npm test`. Expected: PASS, no new lint errors.
- [ ] **Step 4:** Run `npm run dev` and verify: zoom in, pan with each arrow until the edge disables it, click and drag the minimap, reset, next slide resets, Off air resets, STANDBY disables the group. Look at a portrait Canvas in Settings.
- [ ] **Step 5:** Commit `feat(zoom): zoom controls and minimap`.

---

### Task 5: E2E and field checklist

**Files:**
- Modify: `e2e/smoke.mjs`, `docs/test-checklist.md` (section "Output HDMI", Indonesian like the rest of the file)

**Interfaces:**
- Consumes: `data-testid="output-zoom"` and `data-zoom` (Task 3), button names (Task 4).

- [ ] **Step 1:** In `e2e/smoke.mjs` after the existing HDMI checks, add: with a slide live, click "Zoom in" twice and assert the HDMI window's `[data-testid="output-zoom"]` has `data-zoom` `1.56` and a non-`none` transform; click "Pan right" and assert the transform changed; take the next slide and assert `data-zoom` is `1.00` and transform `none`. Reuse the file's existing way of reaching the HDMI window.
- [ ] **Step 2:** Run `npm run test:e2e` (headless: `xvfb-run -a -s '-screen 0 2560x1440x24' npm run test:e2e`). Expected: PASS.
- [ ] **Step 3:** Add a "Zoom" block to `docs/test-checklist.md` (Indonesian): zoom in/out, panah, minimap klik dan geser, reset otomatis saat slide berikutnya, tombol nonaktif saat STANDBY, zoom di slide web dengan Interact (klik tepat sasaran), OMT/NDI tidak ikut zoom.
- [ ] **Step 4:** Run `npm test && npm run typecheck`. Expected: PASS. Commit `test(zoom): e2e smoke and field checklist`.
