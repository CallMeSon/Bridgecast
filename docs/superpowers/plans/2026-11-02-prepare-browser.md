# Prepare Browser Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Each task runs in one subagent, model `sonnet`, effort `medium`; escalate to `opus` when stuck or after a failed review. UI tasks load the `impeccable` skill, read `PRODUCT.md`, `DESIGN.md` and the surface brief `.impeccable/surfaces/src-renderer-src-app-tsx.md` (the Prepare window follows the same tokens and rules as the operator window). Check Context7 before using Electron (`webContents` events `cursor-changed`, `did-navigate`, `did-navigate-in-page`, `did-start-loading`, `did-stop-loading`, `setZoomFactor`, `navigationHistory`, `sendInputEvent` `mouseLeave`), Vitest or Playwright APIs.

**Goal:** Make the Prepare window a browser the operator can actually use: a readable page (Fit or 100% with pan and a mini-map), an explicit Interact switch, an address bar that follows the page and shows loading, Back/Forward that know whether they can go, Stop and Home, page zoom (labelled as changing the output), the page's mouse cursor, a tally frame, a larger default window and a working icon toolbar. The reference is Stagecast (`C:\stagecast`, WPF + WebView2): port the ideas, not the code.

**Architecture:** Nothing changes in how a web deck plays. Each web deck stays one hidden `BrowserWindow` at the Canvas size in `src/main/web/web-host.ts`, captured (`chromeMediaSource: 'tab'`) into every output, the operator monitor and the Prepare preview. The Prepare window stays a picture of that page plus forwarded input. Main gains one broadcast, `web:navState` (URL, title, can go back/forward, loading, zoom, cursor), so the Prepare window can show what the page is doing, and three calls: `web:stop`, `web:home`, `web:setZoom`. The view (Fit/100%, pan, mini-map) is pure renderer math in a new `prepare-view.ts`; it changes how the preview is drawn and how a pointer position maps to page coordinates (still 0 to 1 of the page), never the page.

**Tech Stack:** Electron 45, React 19, TypeScript, plain CSS variables, Phosphor icons, Vitest (node env, no jsdom), Playwright e2e.

**Spec:** `docs/superpowers/specs/2026-10-27-web-source-design.md` (sections Prepare, input, HOLD), `PRODUCT.md` (web decks), `DESIGN.md`. Stagecast reference: `src/Stagecast.App/MainWindow.xaml` (address row and view row), `MainWindow.xaml.cs` (`OnInteract`, `OnMore` page zoom, `ShowZoomLabel`), `PagePreview.xaml.cs` (Fit vs 100%, drag and Space+drag pan, mini-map, cursor mirroring, Esc releases the keyboard), `docs/PLAN_UI.md` ("Kontrol halaman dan tampilan diperbesar").

## Diagnosis (2026-11-01, real Electron on the Windows dev PC, `out/` build)

Driven with Playwright through a scratch script (a local login page with 14 px text, email and password fields, a link, a `<select>`, a 3000 px tall scroll area; canvas 1920x1080; Prepare window 1184x761 content).

Works today (keep it working):
- The page shows in the preview (live 1920x1080 stream at 30 fps), not black, not the poster.
- Click into a field, type (`me@x.com`), Tab to the next field, Enter submits the form, Ctrl+A and Backspace, Ctrl+V paste from the clipboard, double click selects a word, right click reaches the page, wheel scrolls (scrollY 600), hover reaches the page, a link navigates.
- The address bar Enter loads a new address. F6 moves focus to the address. Resizing the Prepare window (700x500, 1200x800) never changes the page window (content size stays 1920x1080).
- On air: the banner says input is locked; frozen: the banner changes and input is accepted (e2e covers this).

Actually broken:
1. **Toolbar icons are squashed**: the Phosphor SVG in `.prepare-icon` renders 8x16 px (`getBoundingClientRect` width 8, `width="16"`); Back, Forward, Reload and More look like dots. The bar reads as empty.
2. **Address bar does not follow the page**: after clicking a link to `/next` the field still says `/login`; after Back it is still stale. There is no page title anywhere.
3. **Back / Forward never know their state**: both enabled on a fresh page with no history.
4. **No loading state**: the page status `loading` is received but not shown; there is no Stop.
5. **Not readable**: the 1920x1080 page is drawn at 0.56 (1084x610). 14 px page text becomes about 8 px and blurry; a sign-in form is hard to read and to hit. There is no 100% view. A larger canvas (2520 or 3840 wide) is worse.
6. **Native page popups are invisible**: a `<select>` opens its list in a separate Chromium popup widget that is neither on screen nor in the tab capture. Keyboard still works blind (ArrowDown + Enter picked "Japan"), but the operator cannot see the list. Same class: date pickers and autofill lists.
7. **No cursor feedback**: the stage cursor is always `default`; links, text fields and buttons look the same.
8. **Hover can stick**: leaving the preview sends nothing, so a hover menu on the page stays open.

Merely different from Stagecast (design choices, addressed below): no Interact switch (input is always on while not on air), no tally frame, no page zoom, the window opens at 1200x800, the status banner is a separate strip in mono type.

Not reproduced here, to confirm with the user (see Open questions): "a browser screen should appear" may mean the user saw no page at all. On this PC the page shows. Known ways to get no page: the deck belongs to another event than the open one ("This web page is not part of the open event"), the page is still loading or failed (the preview then shows the poster or the error), or a Windows display scale above 100% clamps the page window.

## Model decisions (settled here)

1. **The preview stays a captured picture; the live page is never shown inside the Prepare window.** Alternative evaluated: host the page `WebContents` in a `WebContentsView` and move it into the Prepare window while preparing. Not viable as the default:
   - A view's bounds are its CSS viewport. The page must stay exactly Canvas-sized, so the view would be 1920x1080 (or 2520, 3840) inside a window that is usually smaller: no Fit, only a clipped 100%, and no scaling (zoom factor changes layout, which changes the output).
   - Moving a view to a window on another display changes its device scale factor; the page re-lays out and the captured frame size changes, on air too.
   - A view can live in one window at a time; re-parenting a live page risks a dropped or blank captured frame, which breaks "never black".
   - What it would bring (native caret, IME, `<select>` lists, drag and drop) is real. Task 9 offers the honest part of it as a separate, gated spike ("Open page window", not on air only), not as the preview.
2. **Interact switch.** A toggle button "Interact" in the view row (`aria-pressed`, pressed style of the hold buttons, icon `CursorClick`). On: clicks, wheel and keys go to the page. Off: the preview only looks; drag pans (in 100%), the wheel pans (in 100%), keys are not sent. Defaults:
   - Opening the window while the deck is not on air: **on** (the window exists to prepare the page).
   - The deck goes on air and is not frozen: forced **off** and disabled, `title` "Locked while on air. Press F to freeze first." Main keeps refusing input in this state regardless of the switch (unchanged rule).
   - Frozen: stays **off** until the operator presses it. Clicking a frozen live page changes what the audience sees after Unfreeze, so it must be deliberate.
   - The deck leaves air: stays as it was (off), the operator turns it on.
   The switch is renderer state in the Prepare window only (per window, not stored).
3. **Keyboard trap safety.** The stage holds the keyboard only after a click on it while Interact is on. F6 always leaves the page (to the address field), never sent. Esc is sent to the page (it closes page dialogs and leaves Canva present mode) and then releases the keyboard: focus moves to the Interact button and the hint says "Keyboard released. Click the page to type again." Tab and Shift+Tab stay with the page while it holds the keyboard. While the deck is live and not frozen, app shortcuts work from the window (unchanged).
4. **View: Fit | 100%.** A two-button segmented control. Fit (default) draws the whole page in the stage box with the canvas aspect. 100% draws one page pixel per device pixel (CSS size = canvas / `devicePixelRatio`), centred, clipped by the stage box. When 100% is larger than the box: drag pans with Interact off; with Interact on, hold Space and drag, but only while the page does not hold the keyboard (Space in a text field types a space); a mini-map (168 px wide, bottom right of the stage, page thumbnail is not needed: an outline of the page and a filled rect of the visible part) pans on click and drag at any time. The view is per window, remembered in `localStorage` (`prepare-view`, `'fit' | 'actual'`). Changing the view never touches the page or main.
5. **Input mapping.** The renderer always sends 0 to 1 page coordinates, as today. `prepare-view.ts` maps a client point through the current view (scale, pan offset) to page coordinates; a point in the stage but outside the drawn page gives null. Main's validation is unchanged except the new `mouseLeave` input (decision 11).
6. **Page zoom.** In the More menu: a disabled heading "Page zoom (changes the output)", then 50, 75, 90, 100, 110, 125, 150, 200 % as `menuitemradio`. Stored per deck as `DeckMeta.web.zoom` (absent = 1; valid values are exactly that list; anything else in `deck.json` is dropped on load). WebHost applies it with `setZoomFactor` after every main-frame navigation (`did-navigate`), because Chromium zoom is per origin and per navigation, and two decks on the same site must not share one zoom. Changing the zoom while the deck is live and not frozen is refused in main (`Freeze first or take another deck, then change the page zoom.`), and the menu items are disabled with that text as their description. When the zoom is not 100% a label sits beside the view control: "Page zoom 125%", `title` "Changes what the audience sees, not only this preview."
7. **Navigation state.** Main broadcasts `web:navState` for every open page: `{ deckId, url, title, canGoBack, canGoForward, loading, zoom, cursor }` on `did-navigate`, `did-navigate-in-page`, `did-start-loading`, `did-stop-loading`, `page-title-updated` (title only, the window title stays blocked), `cursor-changed`, and after a zoom change. `cursor` is the Electron cursor type string. The renderer also gets the current list through `web:navStates` (like `web:statuses`). Sends are coalesced per deck to at most one per 50 ms, except `loading` changes, which go at once.
8. **Address bar.** Shows the page's current URL from `web:navState` unless the field has focus or has been edited since the last load. Enter: same as today (`setWebUrl`, which also saves it as the deck's address). Esc in the field: restores the current URL and leaves the edit. While loading: a 2 px indeterminate bar along the bottom edge of the field (accent, no motion with `prefers-reduced-motion`; then a static "Loading" word inside the field end instead) and Reload turns into Stop (`X` icon, "Stop loading").
9. **Buttons in the address row**, left to right: Back, Forward, Reload/Stop, Home ("Go to the deck address", `HouseSimple`; navigates to `deck.web.url`, disabled when the page is already there), address field, More. Back/Forward are disabled from `canGoBack`/`canGoForward` and, as today, while live and not frozen. Reload, Home and a new address on a live page go through HOLD first (existing `holdFirst`). Stop is allowed live (it only stops a load). No "open in a new window" button in this row (see Task 9).
10. **Tally frame.** The stage gets a 2 px ring: none (1 px `--line-hi` shadow as today) when not on air; solid accent (`--tally`) with a filled LIVE tag (icon plus word, top left, outside the page rect) when this deck is on air; accent ring plus FROZEN tag when frozen. The separate banner strip stays as the status line (`role="status"`) but uses the app's sans type, not mono, and the hint text moves into it. The Fill Means On Air rule holds.
11. **Pointer leave and cursor.** Leaving the stage sends one `{ kind: 'mouse', type: 'mouseLeave', x, y }` with the last position (main maps it to Electron `mouseLeave`), so hover menus close. With Interact on, the stage `cursor` is the page cursor mapped to CSS (`pointer`, `text`, `wait`, `progress`, `crosshair`, `move`, resize types, `grab`, `grabbing`, `not-allowed`, `help`, `default`); unknown or `custom` gives `default`. With Interact off: `grab`/`grabbing` when it can pan, else `default`. Locked: `not-allowed`.
12. **Window size.** Default `min(1600, 92% of work area) x min(1000, 92%)`, min 800x560, centred on the operator display (never the HDMI display). The toolbar wraps to two rows below 900 px. Bounds are not remembered (open question).

## Global Constraints

- One hidden page per web deck at the Canvas size, captured into every output. Nothing in the Prepare window changes the page window's size, position, visibility, device scale or zoom, except the explicit page zoom of decision 6. Resizing, moving or closing the Prepare window never reaches main. The e2e checks that the page window content size equals the canvas stay green.
- Input is refused by main while the deck is on air and not frozen (`validatePrepareInput`); the Interact switch is UI on top, never the guard. Zoom follows the same rule. Navigation on a live page goes through HOLD first.
- Never black, never desktop. The Prepare preview never reports a frame (`web:frame` from the `prepare` role stays ignored) and never opens the ready gate. A failed page in Prepare shows the poster and the error, as today.
- F6 always leaves the page; Esc releases the keyboard; no key combination can keep focus inside the stage.
- New IPC: add to `src/shared/ipc.ts` first, then `src/main/index.ts`, then `src/preload/index.ts`. Use `appHandle` (operator and prepare roles); check every `deckId` with `assertString` and the library UUID check; validate zoom and input in main (`policy.ts`).
- Old data loads: a `deck.json` without `web.zoom`, with `zoom: "2"`, `zoom: 0.33`, `zoom: null` loads with no zoom key.
- Design: accent is the only state colour; radii 3/4/6; control heights 32/40/52; colours only from `tokens.css`; icon buttons have `aria-label` and `title`; WCAG 2.1 AA in both themes. Copy is English, state first, no exclamation marks; every error names the problem and the recovery.
- Prettier: no semicolons, single quotes, width 100. No new lint errors (7 known). Tests are node-only Vitest; logic goes in plain `.ts` modules.
- This PC runs Windows, so `npm run test:e2e:web` runs here without xvfb (it opens real windows; do not use the PC meanwhile). Anything not covered goes into `docs/test-checklist.md`.

## Known failures (baseline, not caused by this plan)

- Unit: `libreoffice-engine` `loBridgePath` and `web/host-rules` `isAppPageUrl` fail at baseline.
- `npm run test:e2e` (smoke): "a hidden output window mutes its video" and "no black frame" fail at baseline.
- pdf.js CSP errors in the console are known noise.
- `npm run test:e2e:web` on this Windows PC at `447ad6b` (2026-11-01): all 49 checks pass. It must stay fully green.

A task is done when it adds no failure beyond these.

## Review Focus

- Mapping accuracy: at Fit, at 100% centred, and at 100% panned to each corner, a click on a 10x10 px target in the page lands on it. Unit test in Task 1 (pure math), e2e in Task 10.
- On air, not frozen: no click, wheel, key or zoom from the Prepare window reaches the page, whatever the Interact switch shows (main test in Task 2, e2e in Task 10).
- Freeze, then press Interact, click, Unfreeze: the switch goes off again only when the deck goes live unfrozen; it never turns itself on.
- Two web decks on the same site: zoom 150% on one leaves the other at 100%, also after both reload (Task 3, e2e Task 10).
- Navigating a page with zoom 125%: the new document is at 125% too (Task 3).
- Esc in the stage: the page receives exactly one keyDown/keyUp Escape and focus is on the Interact button afterwards. F6: the page receives nothing.
- Space with Interact on and the keyboard in the page types a space in the field; it does not pan.
- `web:navState` traffic: a page that changes its cursor 200 times a second does not flood the IPC (coalescing).
- The address field while typing: a `did-navigate` from the page does not overwrite the text the operator is typing.

## Execution Order

1. Task 1 and Task 2 in parallel (Task 1: new renderer modules only; Task 2: `shared/web.ts`, `shared/types.ts`, `main/web/policy.ts`, `main/library.ts`).
2. Task 3 (main: WebHost nav state, zoom, stop, home, IPC; needs Task 2).
3. Task 4 (Prepare toolbar, address, buttons, icon fix; needs Task 3).
4. Task 5 (view: Fit/100%, pan, mini-map; needs Task 1 and Task 4).
5. Task 6 (Interact switch, keyboard, cursor, pointer leave; needs Task 5).
6. Task 7 (tally frame, status line, window size; needs Task 6). Tasks 4 to 7 all edit `PrepareView.tsx` and the Prepare block of `app.css`, so they run one after the other.
7. Task 8 (page zoom menu; needs Task 3 and Task 7).
8. Task 10 (verification, e2e, docs).
9. Task 9 (gated spike) only after the user decides, after Task 10.

## File Structure

- Create `src/renderer/src/prepare-view.ts` (+ `prepare-view.test.ts`): view math (fit, actual, pan clamp, client to page, mini-map).
- Create `src/renderer/src/prepare-ui.ts` (+ `prepare-ui.test.ts`): Interact rules, address field rule, cursor map, zoom label, keyboard routing.
- Modify `src/shared/web.ts`: `PAGE_ZOOMS`, `isPageZoom`, `WebNavState`, `PrepareInput` gains `mouseLeave`.
- Modify `src/shared/types.ts`: `DeckMeta.web` gains `zoom?: number`.
- Modify `src/main/library.ts` (+ `library.test.ts`): load sanitising of `web.zoom`, `setWebZoom`.
- Modify `src/main/web/policy.ts` (+ `policy.test.ts`): `mouseLeave` input, `zoomAllowed`.
- Modify `src/main/web/host-rules.ts` (+ `host-rules.test.ts`): `NavCoalescer` (pure timing logic with an injected clock).
- Modify `src/main/web/web-host.ts`: nav state, `stop`, `home`, `setZoom`, apply zoom on navigation.
- Modify `src/main/web/prepare-window.ts`: `prepareBounds` new sizes (+ a test, the function is pure).
- Modify `src/shared/ipc.ts`, `src/main/index.ts`, `src/preload/index.ts`: `web:stop`, `web:home`, `web:setZoom`, `web:navStates`, broadcast `web:navState`.
- Modify `src/renderer/src/PrepareView.tsx`, `src/renderer/src/model.ts` (`prepareBannerText` copy), `src/renderer/src/styles/app.css` (Prepare block).
- Create `src/renderer/src/components/PrepareMiniMap.tsx`.
- Create `fixtures/web/prepare.html`; modify `e2e/web.mjs`.
- Modify `PRODUCT.md`, `docs/superpowers/specs/2026-10-27-web-source-design.md` (Prepare section), `docs/test-checklist.md`.

---

### Task 1: View math for Fit and 100% (pure)

**Files:**
- Create: `src/renderer/src/prepare-view.ts`
- Test: `src/renderer/src/prepare-view.test.ts`

**Interfaces:**
- `type ViewMode = 'fit' | 'actual'`
- `interface Box { width: number; height: number }`
- `interface View { mode: ViewMode; panX: number; panY: number }` (pan = page pixels of the visible top-left, only used in `actual`)
- `interface Layout { left: number; top: number; width: number; height: number; scale: number; cropped: boolean }`: where the page is drawn inside the stage box (CSS px; `left`/`top` may be negative in `actual`).
- `layout(canvas: Box, box: Box, view: View, dpr: number): Layout`. Fit: same result as `stageRect` in `stage.ts` (reuse it). Actual: `scale = 1 / dpr`, size `canvas * scale`; when the page is smaller than the box on an axis it is centred on that axis and pan on that axis is ignored; else `left = -panX * scale` (same for y).
- `clampPan(canvas: Box, box: Box, view: View, dpr: number): View` (pan between 0 and `canvas - box * dpr`, 0 when not cropped).
- `centred(canvas, box, dpr): View` (actual mode, page centre in the box centre; used when switching to 100%).
- `panBy(canvas, box, view, dpr, dxCss, dyCss): View` (drag right moves the page right, i.e. pan decreases; result clamped).
- `toPage(clientX: number, clientY: number, stage: DOMRectLike, l: Layout): { x: number; y: number } | null`: 0 to 1 page coordinates; null outside the drawn page. `DOMRectLike = { left: number; top: number }`.
- `miniMap(canvas: Box, box: Box, view: View, dpr: number, width = 168): { width: number; height: number; rect: { x: number; y: number; w: number; h: number } }` (height at least 24).
- `panFromMiniMap(canvas, box, dpr, mx: number, my: number, width = 168): View` (centre the visible rect on the mini-map point, clamped).

- [ ] **Step 1: Write the failing tests:**
  - Fit with canvas 1920x1080 in box 1084x700 equals `stageRect` (width 1084, height 609.75, centred vertically).
  - Actual, dpr 1, box 1084x610: width 1920, `cropped` true; `centred` gives pan (418, 235); dpr 2: width 960, height 540, not cropped, centred, pan ignored.
  - `clampPan` with pan (-50, 9999) gives (0, 1080 - 610).
  - `panBy` by (+100, +40) CSS px at dpr 1 from (418, 235) gives (318, 195); at dpr 2 a page that is not cropped stays (0, 0).
  - `toPage`: Fit, a click at the stage centre gives (0.5, 0.5); Actual dpr 1 panned to (836, 470) (bottom-right), a click at the box's bottom-right pixel maps to about (1, 1); a click on a page pixel (1000, 500) drawn at `left + 1000 * scale` maps back to (1000/1920, 500/1080) within 1e-6; a point in the box but outside a centred, uncropped page gives null.
  - `miniMap` for 1920x1080 at width 168: height 94.5; at Fit the rect is the whole map; at Actual centred dpr 1 in a 1084x610 box the rect is (36.6.., 20.5.., 94.85.., 53.37..) (compute exactly in the test from the formula, do not hard-code rounding).
  - `panFromMiniMap` at the map centre equals `centred`.
- [ ] **Step 2: Run** `npx vitest run src/renderer/src/prepare-view.test.ts` and expect FAIL.
- [ ] **Step 3: Implement** with no DOM types beyond plain objects (node test env).
- [ ] **Step 4: Run** the file, then `npm test` and `npm run typecheck`; expect PASS except the known failures.
- [ ] **Step 5: Commit** `feat: Prepare view math for Fit and 100%`.

### Task 2: Shared web types, zoom storage and input policy

**Files:**
- Modify: `src/shared/web.ts`, `src/shared/types.ts`, `src/main/library.ts`, `src/main/web/policy.ts`
- Test: `src/main/library.test.ts`, `src/main/web/policy.test.ts`, `src/shared/web.test.ts` (create if missing)

**Interfaces:**
- `src/shared/web.ts`:
  - `export const PAGE_ZOOMS = [0.5, 0.75, 0.9, 1, 1.1, 1.25, 1.5, 2] as const`
  - `export function isPageZoom(v: unknown): v is number` (exact member of the list)
  - `export const ZOOM_LIVE_REFUSED = 'Freeze first or take another deck, then change the page zoom.'`
  - `export interface WebNavState { deckId: string; url: string; title: string; canGoBack: boolean; canGoForward: boolean; loading: boolean; zoom: number; cursor: string }`
  - `PrepareInput` mouse variant: `type` gains `'mouseLeave'` (button `'left'`, `clickCount` 0 for it).
- `DeckMeta.web`: `{ url: string; zoom?: number }`.
- `Library.setWebZoom(eventId: string, deckId: string, zoom: number): DeckMeta` (throws `Choose a page zoom from the list.` for a value not in `PAGE_ZOOMS`; `zoom === 1` removes the key).
- `policy.ts`: `validatePrepareInput` maps `mouseLeave` to Electron `{ type: 'mouseLeave', x, y }`; `export function zoomAllowed(s: { live: boolean; frozen: boolean }): boolean` (false only when live and not frozen).

- [ ] **Step 1: Write the failing tests:**
  - `isPageZoom(1.25)` true; `1.3`, `'1'`, `NaN`, `null` false.
  - library: a hand-written `deck.json` with `web: { url, zoom: 1.5 }` keeps it; `zoom: '2'`, `0.33`, `null`, `-1` are dropped on load; `setWebZoom(ev, d, 1.25)` persists across a new `Library`; `setWebZoom(..., 1)` leaves no `zoom` key in the raw file; `setWebZoom(..., 3)` throws the exact message; a non-web deck throws the existing "not a web deck" style error (reuse what `setWebUrl` throws).
  - policy: `mouseLeave` at (0.5, 0.5) on a 1920x1080 canvas gives `{ type: 'mouseLeave', x: 960, y: 540 }`; refused when live and not frozen like every other input; `zoomAllowed` truth table (4 cases).
- [ ] **Step 2: Run** the three test files; expect FAIL.
- [ ] **Step 3: Implement.** Keep `cleanWebUrl` behaviour; sanitise `zoom` next to it.
- [ ] **Step 4: Run** `npm test` and `npm run typecheck`; expect PASS except known failures.
- [ ] **Step 5: Commit** `feat: page zoom field and pointer leave input for web decks`.

### Task 3: WebHost navigation state, Stop, Home and zoom; IPC

**Files:**
- Modify: `src/main/web/web-host.ts`, `src/main/web/host-rules.ts`, `src/main/index.ts`, `src/shared/ipc.ts`, `src/preload/index.ts`
- Test: `src/main/web/host-rules.test.ts`

**Interfaces:**
- `host-rules.ts`: `export class NavCoalescer { constructor(send: (s: WebNavState) => void, schedule: (fn: () => void, ms: number) => unknown, cancel: (h: unknown) => void, ms = 50); push(s: WebNavState): void; flush(deckId: string): void; drop(deckId: string): void }`. A push whose `loading` differs from the last sent state of that deck is sent at once (and cancels the pending one); others are sent at most once per `ms` per deck with the newest state.
- `WebHost`:
  - constructor gains `onNav: (s: WebNavState) => void` (last parameter, optional, default no-op, so existing calls compile).
  - `navStates(): WebNavState[]`
  - `stop(deckId: string): void` (`webContents.stop()`; allowed live).
  - `home(deckId: string): Promise<void>` (navigate to the deck's saved `web.url` through `holdFirst`, like `navigate`).
  - `setZoom(deckId: string, zoom: number): void` (throws `ZOOM_LIVE_REFUSED` when `!zoomAllowed`; saves through `lib.setWebZoom`; applies `setZoomFactor`; pushes nav state).
  - On `did-navigate` (main frame) re-apply the deck's stored zoom with `setZoomFactor`.
  - Nav state sources: `did-navigate`, `did-navigate-in-page` (main frame), `did-start-loading`, `did-stop-loading`, `page-title-updated` (keep `preventDefault` on the window event; read `wc.getTitle()`), `cursor-changed` (`type`). `canGoBack`/`canGoForward` from `wc.navigationHistory`.
  - `close(deckId)` calls `coalescer.drop(deckId)`.
- IPC (`ipc.ts`): `Invoke.webStop 'web:stop'` `{ args: [deckId]; result: void }`, `Invoke.webHome 'web:home'` `{ args: [deckId]; result: void }`, `Invoke.webSetZoom 'web:setZoom'` `{ args: [deckId, zoom: number]; result: DeckMeta }`, `Invoke.webNavStates 'web:navStates'` `{ args: []; result: WebNavState[] }`, `Broadcast.webNavState 'web:navState'` (payload `WebNavState`). Preload `Api`: `stopWeb`, `homeWeb`, `setWebZoom`, `webNavStates`, `onWebNavState`.
- `main/index.ts`: handlers with `appHandle`, `assertString(deckId)`, zoom checked with `isPageZoom` before the library call; `web:setZoom` returns the updated deck and triggers the same deck-list refresh as `web:setUrl`.

- [ ] **Step 1: Write the failing tests** for `NavCoalescer` with a fake clock: 10 cursor pushes inside 50 ms send once with the last cursor; a `loading` true push after a pending cursor push sends immediately with both changes; two decks do not delay each other; `drop` cancels a pending send.
- [ ] **Step 2: Run** `npx vitest run src/main/web/host-rules.test.ts`; expect the new tests to FAIL.
- [ ] **Step 3: Implement** `NavCoalescer`, then the WebHost changes and the IPC in the order ipc, main, preload. Check Context7 for the exact `cursor-changed`, `did-navigate-in-page` and `setZoomFactor` signatures in Electron 45, and whether `setZoomFactor` is per origin (if it is, the re-apply on `did-navigate` per deck is what keeps two same-site decks apart; note the finding in a code comment).
- [ ] **Step 4: Run** `npm test`, `npm run typecheck`, `npm run lint`; expect no new failures.
- [ ] **Step 5: Commit** `feat: web page navigation state, stop, home and page zoom in main`.

### Task 4: Prepare toolbar: icons, address that follows the page, Back/Forward state, Stop, Home

**Files:**
- Create: `src/renderer/src/prepare-ui.ts` (address rule part)
- Test: `src/renderer/src/prepare-ui.test.ts`
- Modify: `src/renderer/src/PrepareView.tsx`, `src/renderer/src/styles/app.css`

**Interfaces:**
- `prepare-ui.ts`: `addressShown(a: { pageUrl: string | null; typed: string; editing: boolean }): string` (typed while editing, else the page URL, else typed); `homeDisabled(pageUrl: string | null, deckUrl: string | undefined): boolean` (true when equal after trimming one trailing `/`).
- Consumes `api.onWebNavState`, `api.webNavStates`, `api.stopWeb`, `api.homeWeb` from Task 3.

- [ ] **Step 1: Write the failing tests** for `addressShown` (editing keeps typed text across a page URL change; not editing shows the page URL; no page URL yet shows typed) and `homeDisabled` (`https://a.com` vs `https://a.com/` disabled; different path enabled; undefined deck URL disabled).
- [ ] **Step 2: Run**; expect FAIL. **Step 3: Implement** the helpers, then the UI (load the `impeccable` skill first):
  - Fix the squashed icons: the SVG must keep 16x16 (`flex: none` on the svg or the right rule on `.prepare-icon`); buttons are 32x32 (height token 32).
  - Subscribe to nav state (broadcast newer than the first fetch, the same pattern as `onWebStatus`). Address field follows `addressShown`; `editing` = focused or edited since the last submit; Esc in the field restores and blurs to the stage.
  - Back/Forward disabled from `canGoBack`/`canGoForward` (and live as today), `title` says why ("No earlier page", "Locked while on air").
  - Reload becomes Stop while `loading` (`XIcon`, `aria-label` "Stop loading"). Home button (`HouseSimpleIcon`, "Go to the deck address") between Reload and the field.
  - Loading bar under the field per decision 8; reduced motion shows "Loading" text instead.
  - Window title: `Prepare: <deck name> · <page title>` when a title exists.
- [ ] **Step 4: Run** `npm test`, `npm run typecheck`, `npm run lint`; build and open the Prepare window by hand (or with the scratch approach of the diagnosis) and check: icons 16 px, address follows a link click and Back, Back disabled on a fresh page, Stop shows while a slow page loads.
- [ ] **Step 5: Commit** `feat: Prepare toolbar follows the page, with Stop and Home`.

### Task 5: Fit | 100% view with pan and mini-map

**Files:**
- Create: `src/renderer/src/components/PrepareMiniMap.tsx`
- Modify: `src/renderer/src/PrepareView.tsx`, `src/renderer/src/styles/app.css`

**Interfaces:**
- Uses `layout`, `clampPan`, `centred`, `panBy`, `toPage`, `miniMap`, `panFromMiniMap` from Task 1.
- `PrepareMiniMap` props: `{ canvas: Box; box: Box; view: View; dpr: number; onPan: (v: View) => void }`; it renders only when `layout(...).cropped`; pointer down/move on it calls `onPan(panFromMiniMap(...))`; it is a `role="slider"`-free plain group with `aria-label="Page position"` and arrow keys pan 10% per press.

- [ ] **Step 1:** Load `impeccable`. Add a view row under the address row: segmented Fit | 100% (`aria-pressed` on each), later Interact (Task 6) on the right.
- [ ] **Step 2:** The stage element becomes a clipping box filling the free area; the `StreamLayer` sits in an inner element positioned and sized from `layout(...)`. Pointer mapping uses `toPage` against the stage box and the layout instead of `toPrepareInput`'s own rect math (pass a synthetic rect = the drawn page rect, so `toPrepareInput` stays the single event-to-input converter).
- [ ] **Step 3:** Pan: with Interact off (for now: always, Task 6 adds the switch) a left drag pans when cropped; the wheel pans when cropped. Re-clamp on box resize and on canvas change; switching to 100% starts `centred`. `devicePixelRatio` is read on each layout and on `matchMedia('(resolution: ...)')` change (window moved to another display).
- [ ] **Step 4:** Remember the mode in `localStorage` `prepare-view` (try/catch, default `fit`).
- [ ] **Step 5: Run** `npm test`, `npm run typecheck`, `npm run lint`; by hand at 100% the login page text is sharp, the mini-map rect moves with the drag, and a click on the email field after panning lands in the field.
- [ ] **Step 6: Commit** `feat: Prepare 100% view with pan and mini-map`.

### Task 6: Interact switch, keyboard release, page cursor, pointer leave

**Files:**
- Modify: `src/renderer/src/prepare-ui.ts`, `src/renderer/src/prepare-ui.test.ts`, `src/renderer/src/PrepareView.tsx`, `src/renderer/src/model.ts` (only if `toPrepareInput` needs `mouseleave`), `src/renderer/src/model.test.ts`, `src/renderer/src/styles/app.css`

**Interfaces:**
- `prepare-ui.ts`:
  - `type InteractEvent = { kind: 'banner'; banner: PrepareBanner } | { kind: 'press' }`
  - `nextInteract(on: boolean, prev: PrepareBanner | null, e: InteractEvent): boolean` implementing decision 2 (banner to `live`: false; press while `live`: unchanged false; press otherwise: toggles; `frozen` or `idle` arriving: unchanged).
  - `interactLocked(b: PrepareBanner): boolean` (`live`).
  - `keyRoute(e: { key: string; spaceForPan: boolean }, s: { interact: boolean; holdsKeyboard: boolean; banner: PrepareBanner }): 'page' | 'release' | 'leave' | 'pan' | 'app' | 'none'` (F6: `leave`; Escape while holding: `release` (the caller also sends it to the page); Space with `spaceForPan` and not holding: `pan`; live: `app`; interact and holding: `page`; else `none`).
  - `cssCursor(electronType: string): string` (decision 11 map).
  - `stageCursor(s: { interact: boolean; locked: boolean; canPan: boolean; panning: boolean; page: string }): string`.
- `toPrepareInput` handles `mouseleave` as `mouseLeave` (button left, clickCount 0) with the clamped last position.

- [ ] **Step 1: Write the failing tests** for `nextInteract` (every row of decision 2, including: idle open = true, goes live = false, frozen = still false, press while frozen = true, unfreeze to live = false, leaves air = false), `keyRoute` (F6 never `page`; Escape `release` only while holding; Space types into the page while holding even when cropped), `cssCursor` (`hand` to `pointer`, `ibeam` to `text`, `wait`, `ew-resize`, `custom` and `xyz` to `default`), `stageCursor` precedence (locked, panning, page cursor, grab, default), and `toPrepareInput` for `mouseleave`.
- [ ] **Step 2: Run**; expect FAIL. **Step 3: Implement** helpers, then UI (load `impeccable`):
  - Interact toggle in the view row (right), `aria-pressed`, `CursorClickIcon` plus the word "Interact", pressed style = hold-button pressed style; disabled with `title` "Locked while on air. Press F to freeze first." when locked.
  - Initial state: `nextInteract` starting from `program` at first render (idle: on).
  - Interact off: no input sent (mouse, wheel, keys); drag and wheel pan (Task 5). Interact on: input as today; Space+drag pans only per `keyRoute`.
  - "Holds the keyboard" = the stage has focus after a click with Interact on. Esc: send keyDown/keyUp Escape, then focus the Interact button and show the released hint for 4 s in the status line (polite).
  - `onMouseLeave` sends one `mouseLeave` when Interact is on and input is allowed.
  - Stage `cursor` from `stageCursor`, page cursor from `web:navState.cursor`.
- [ ] **Step 4: Run** `npm test`, `npm run typecheck`, `npm run lint`; by hand: Esc closes a page dialog and gives the keyboard back; F6 never reaches the page; the cursor is a hand over the link and a text cursor over the field.
- [ ] **Step 5: Commit** `feat: Prepare Interact switch, keyboard release and page cursor`.

### Task 7: Tally frame, status line and window size

**Files:**
- Modify: `src/renderer/src/PrepareView.tsx`, `src/renderer/src/model.ts` (`prepareBannerText`), `src/renderer/src/model.test.ts`, `src/renderer/src/styles/app.css`, `src/main/web/prepare-window.ts`
- Test: `src/main/web/prepare-window.test.ts` (create; `prepareBounds` is pure, the test imports only it, so mock `electron` with `vi.mock('electron', () => ({}))` and `@electron-toolkit/utils` likewise)

**Interfaces:**
- `prepareBounds(workArea)`: width `min(1600, round(0.92 * w))`, height `min(1000, round(0.92 * h))`, centred; `minWidth 800`, `minHeight 560` in the window options.
- `prepareBannerText` new copy (state first): idle "Not on air. Interact to click and type in the page."; live "On air. Input is locked. Press F to freeze, then turn on Interact."; frozen "Frozen. The output holds the last frame. Your clicks show on air after Unfreeze."

- [ ] **Step 1: Write the failing tests:** `prepareBounds` for a 1920x1040 work area (1600x957, centred), a 1366x728 one (1257x670) and a 3840x2100 one (1600x1000); update the `prepareBannerText` expectations in `model.test.ts`.
- [ ] **Step 2: Run**; expect FAIL. **Step 3: Implement** (load `impeccable`):
  - Tally: the stage ring and the LIVE / FROZEN tag per decision 10 (`StatusTag` component if it fits, icon plus word).
  - The status strip uses the sans UI type at 13 px weight 600, accent fill only when live (filled = on air), tinted when frozen, neutral when idle; the bottom hint line is removed and its text (shortcut help) joins the status strip or the `aria-label` of the stage.
  - Toolbar wraps into two rows below 900 px window width without horizontal scroll.
- [ ] **Step 4: Run** `npm test`, `npm run typecheck`, `npm run lint`; by hand in both themes and two accents: idle, live, frozen.
- [ ] **Step 5: Commit** `feat: Prepare tally frame and a larger window`.

### Task 8: Page zoom menu

**Files:**
- Modify: `src/renderer/src/prepare-ui.ts`, `src/renderer/src/prepare-ui.test.ts`, `src/renderer/src/PrepareView.tsx`, `src/renderer/src/styles/app.css`

**Interfaces:**
- `zoomLabel(zoom: number): string | null` (`null` at 1, else `Page zoom 125%`).
- Uses `api.setWebZoom` and `web:navState.zoom`.

- [ ] **Step 1: Write the failing tests** for `zoomLabel` (1 gives null, 0.9 gives "Page zoom 90%", 1.1 gives "Page zoom 110%").
- [ ] **Step 2: Run**; expect FAIL. **Step 3: Implement** (load `impeccable`): in the More menu, above Sign out, the heading "Page zoom (changes the output)" and the `PAGE_ZOOMS` as `menuitemradio` with `aria-checked`; disabled while live and not frozen with `ZOOM_LIVE_REFUSED` as `title`; a refusal from main shows in the address note (problem). The zoom label sits in the view row, ink with a warning icon, not a second colour.
- [ ] **Step 4: Run** `npm test`, `npm run typecheck`, `npm run lint`; by hand: 150% enlarges the page in the preview and on the HDMI output; the label shows; Reload keeps 150%.
- [ ] **Step 5: Commit** `feat: Prepare page zoom, labelled as changing the output`.

### Task 9 (gated spike): Open page window for native page controls

Run only after the user decides (Open question 2). Stop and report after Step 2 if any check fails; do not ship it half-working.

**Goal:** A More menu item "Open page window" (not on air only) that shows the deck's hidden page window itself on the operator display, so `<select>` lists, date pickers, autofill and IME work natively. Closing it hides it again.

- [ ] **Step 1: Spike on Windows** (scratch script, no product code): `win.show()` on a page window that is not on air: is the content size still exactly the canvas (also at 125% and 150% Windows scale)? Does a `<select>` list appear? Does the capture keep running at the canvas size while shown and after `hide()`? Does the window land on the HDMI display if the operator display is not primary? Record results in `docs/superpowers/notes/2026-11-xx-page-window-spike.md`.
- [ ] **Step 2:** If every check passes: design the rules (non-resizable, not movable to the HDMI display, close = hide, auto-hide when the deck goes on air, refused while on air) and write them as a follow-up task in this plan. If a check fails: document the limit in `PRODUCT.md` (native page lists are not visible; use the keyboard: click the list, then arrow keys and Enter). The app cannot detect an open `<select>` in the page, so put the hint in the stage `aria-label` and the status line help text, not in a conditional warning.
- [ ] **Step 3: Commit** `docs: page window spike` (and code only if Step 2 approved it).

### Task 10: Verification, e2e and documentation

**Files:**
- Create: `fixtures/web/prepare.html` (sign-in form with 14 px text, a link to a second page, a button with `cursor: pointer`, a 3000 px scroll area, a hover menu, a dialog that closes on Escape; test hooks on `window`)
- Modify: `e2e/web.mjs` (serve `/prepare` and `/prepare2` from the fixture), `PRODUCT.md`, `docs/superpowers/specs/2026-10-27-web-source-design.md`, `docs/test-checklist.md`

- [ ] **Step 1:** Run `npm run test:e2e:web` before the e2e edits; it must still pass fully (baseline 49 checks).
- [ ] **Step 2: Add e2e checks** in `e2e/web.mjs`, in a separate block with its own web deck that is not on air:
  - open the Prepare window (`window.api.openPrepare`), wait for `.prepare-stage video` with `videoWidth === 1920`
  - toolbar icons are 16 px wide
  - Back is disabled on the fresh page; click the link through the preview (page coordinates mapped through the stage rect), the address field shows `/prepare2`, Back is enabled; Back returns and the field shows `/prepare`
  - switch to 100% (stage page width = 1920 / dpr), pan with a drag, click the email field at its panned position, type, the page field has the text
  - Interact off: a click does not change `window.__clicks`
  - Esc with the keyboard in the page: the page dialog closed and `document.activeElement` in Prepare is the Interact button; F6 sends nothing (`window.__keys` unchanged)
  - cursor: hover the button, the stage cursor becomes `pointer`
  - zoom 150%: `window.devicePixelRatio`-independent check `await pageEval(..., 'window.outerWidth / window.innerWidth')` or `visualViewport.scale` per Context7; a second deck on the same origin stays at 100%; Reload keeps 150%
  - take the deck live: `web:setZoom` is refused with the exact message; the Interact button is disabled; `webInput` still returns false; the page window content size is still 1920x1080 after resizing the Prepare window to 800x560
- [ ] **Step 3: Run** `npm test`, `npm run typecheck`, `npm run lint`, `npm run build`, `npm run test:e2e:web`; expect no failures beyond the baseline.
- [ ] **Step 4: Docs.** `PRODUCT.md` web decks paragraph: Prepare has Interact, Fit/100%, page zoom (changes the output), Stop and Home, and the native list limit (per Task 9's outcome). Spec Prepare section: the new toolbar and rules (Indonesian, like the spec). `docs/test-checklist.md` (Windows, real sites): Canva sign-in with 100% view; a site with a `<select>`; page zoom on the HDMI and NDI outputs; 125% and 150% Windows display scale with 100% view (sharp text, click lands); Esc closes a cookie dialog and releases the keyboard; a clicker in the Prepare window while live still sends Next to the page.
- [ ] **Step 5: Commit** `test: Prepare browser end-to-end checks and docs`.

## Open questions (not settled by the code)

1. What did the user see? On this PC the page shows and accepts input. If the user saw an empty or black preview, ask for the case: deck of another event, page still loading or failed, or a Windows scale above 100%. The answer may add a bug fix task before Task 4.
2. Native page popups (`<select>` lists, date pickers, autofill): accept the keyboard workaround, or run the Task 9 spike for a visible page window when not on air?
3. Esc: send to the page and release (this plan), or release only (Stagecast) so the page never gets Esc from Prepare?
4. Should the Prepare window remember its size and position per machine?
5. Page zoom while frozen: allowed in this plan (the audience sees it after Unfreeze). Should it be refused whenever the deck is on air, frozen or not?
6. Prepare preview sound stays muted (exactly one window plays sound). Does the operator need to hear the page while preparing (for example to check a video), through the operator's own monitor output?
