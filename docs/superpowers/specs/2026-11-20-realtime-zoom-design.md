# Realtime zoom for the Program output (design)

Date: 2026-11-20. Issue: GitHub #1 "Add realtime page zoom feature".
Status: awaiting approval.

## Intent

During a presentation the operator wants to enlarge part of the live slide (an object or a line of
text) so the audience sees it clearly, then go back. The operator controls it from the Program
monitor and sees the same zoomed picture the audience sees.

## Goals

- Zoom in/out, pan left/right/up/down, and reset, from controls next to the Program monitor.
- A small locator map ("minimap") showing which part of the slide is zoomed. Click it to move the
  zoom centre there; drag the zoom rectangle to follow what the operator wants to show.
- The zoom is live on the HDMI output at once (no "apply" step), and the operator monitor shows the
  same picture.
- Zoom resets to 1x on every take (next slide, goto, deck change).

## Non-goals (this version)

- OMT and NDI outputs do not zoom. Suggested for later (see "Later").
- No zoom presets, no saved zoom per slide, no mouse-wheel or pinch zoom (the user asked for
  buttons plus the minimap).
- No zoom of anything beyond the live slide (no zoom on the Next panel or thumbnails).

## Anti-goals

- The audience must never see black, the desktop, or a half-drawn frame because of zoom
  ("never black, never desktop" still holds). Zoom only changes a transform on layers that already
  exist.
- A zoomed output must never get stuck: any take, Off air, or reset button returns to 1x.

## Constraints

- `ProgramState` is the single source of truth and a pure reducer (`src/shared/program.ts`); main
  owns state, renderers only display it. Add the IPC channel in `src/shared/ipc.ts` first only if a
  new channel is needed; the existing action dispatch should carry the new actions.
- The monitor forwards clicks to a live web page (`useMonitorInteract` in `Program.tsx`). While
  zoomed, pointer coordinates must be mapped back to page coordinates.
- Operator UI follows `DESIGN.md`/`PRODUCT.md` (load the `impeccable` skill for the UI task). The
  dark palette is pinned; do not touch it.
- Tests are Vitest in node (no jsdom): zoom maths live in a plain `.ts` module.

## Approaches considered

1. **Zoom in `ProgramState`, rendered as a CSS transform (chosen).** One source of truth; monitor
   and HDMI cannot disagree; pure and easy to test. Trade-off: the OMT offscreen renderer receives
   the same state, so it must explicitly ignore zoom for now.
2. Per-window zoom synced by its own IPC channel. More code, monitor and output can drift.
3. Zoom at frame level for OMT/NDI. Only covers network outputs, not HDMI, and crops after
   rendering (blurrier).

Chosen by the user and agreed in conversation: approach 1, HDMI only.

## Design

**State.** `ProgramState.zoom: { scale: number; cx: number; cy: number }`. `scale` 1..4 (1 = off);
`cx, cy` is the centre of the visible window as fractions 0..1 of the canvas. Initial: `{1, 0.5, 0.5}`.

**Actions.** `zoomIn`, `zoomOut` (step 1.25x, clamped to 1..4), `zoomPan {dx, dy}` (fraction of the
visible window per click, default 0.2 of the visible width/height), `zoomTo {cx, cy}` (from the
minimap), `zoomReset`. After every action `cx, cy` are clamped so the visible window stays inside
the canvas (`half = 1 / (2 * scale)`; `cx` in `[half, 1 - half]`). At scale 1 the centre is
always 0.5/0.5.

**Reset rules.** Any action that changes `shown` to a different take (`next`, `prev`, `goto`,
`selectDeck`, `nextSection`, `nextDeck`, and so on, i.e. whenever `take` increments) resets zoom.
`offAir` also resets. Freeze, black and KV do not change the zoom (it returns with the picture).

**Rendering.** Pure helper `zoomTransform(zoom)` in a new `src/shared/zoom.ts` returns
`translate/scale` for the stage, with `transform-origin: 0 0`, `scale` and a translate of
`-(cx - half) * W * scale`. Applied to the stage content in `OutputView` (role `hdmi` only; role
`omt` ignores zoom) and to the monitor screen in `Program.tsx`. A short CSS transition (about
150 ms ease-out) makes it smooth; transitions are disabled when `prefers-reduced-motion`.
The stage clips overflow, so the zoom shows only the visible window.

**Controls (in the Program column, under or beside the monitor).**

```
 [ monitor with zoomed picture ]     +-------------+
                                     |  minimap    |   click = move centre
 [-] 1.5x [+]   [reset]              |  [ rect ]   |   drag rect = pan
        [^]                          +-------------+
   [<]       [>]
        [v]
```

- Buttons: zoom out, zoom in (with the current scale label), reset, four arrows.
- Arrows and pan are disabled at the canvas edge; reset and zoom out are disabled at 1x.
- The minimap is a small thumbnail of the live picture (same media as the monitor, no sound) with a
  rectangle for the visible window. Click moves the centre; dragging the rectangle follows the
  pointer (`zoomTo`). It has the canvas aspect ratio, so it is correct for any Canvas size.
- Controls are enabled only while something is on the output (not STANDBY with no slide); hidden
  or disabled otherwise.
- Accessible: real buttons with labels, keyboard focus, and the minimap exposes the centre as text
  (for example "Zoom centre 50% / 50%") for screen readers.

**Web decks.** While zoomed, clicks on the monitor are mapped back with the inverse transform
before being forwarded to the live page. The zoom does not change the page's own resolution, so the
quality depends on the capture size.

**Quality note.** PNG slides blur at high zoom. Vector PDF blurs the same way: `PdfLayer` rasterises
at `clientWidth * devicePixelRatio`, and a CSS transform does not change `clientWidth`, so the zoomed
page is an enlarged bitmap like a PNG. Stream layers follow the capture resolution. This is
acceptable for v1; mention it in the UI hint only if the user asks.

## Testing

- Vitest: `zoom.ts` (clamping, step, pan at edges, `zoomTo`, transform maths, inverse pointer
  mapping) and reducer tests (reset on take, `offAir`, unaffected by freeze/black/KV, no change
  when an action is refused).
- Playwright e2e (`smoke` style): press zoom in and an arrow, check the output window's stage
  transform, press next, check it is back to 1x. Check `omt` role stays untransformed.

## Later (not in this version)

- Apply zoom to OMT and NDI by passing the same `zoom` to the offscreen renderer (the state already
  reaches it; remove the "ignore zoom" rule for role `omt`). Decide then whether network viewers
  should see the zoom.
- Mouse wheel and keyboard shortcuts, saved zoom per slide.

## Left to the builder

- Exact button placement, sizes and icons (follow `DESIGN.md`, Phosphor icons already in use).
- Zoom step sizes and the transition time, if testing shows they feel off.
- Whether zoom actions go through the existing action IPC or need their own channel (prefer the
  existing one).
- Minimap thumbnail source (reuse the monitor's media; a still of the PNG is fine for streams).
