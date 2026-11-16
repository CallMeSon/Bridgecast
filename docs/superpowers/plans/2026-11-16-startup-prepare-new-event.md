# Startup state, Prepare, ad block, New event wizard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore the app to its last state at startup, make Prepare a real-size browser with reliable clicks, block ads on web decks, and turn New event into a one-form setup (name, resolution, KV, import).

**Architecture:** Main owns a small `session.json` (active event + per-event position) loaded into `AppState`. Prepare resizes the one web page to the window while preparing and back to Canvas size before it can be taken (live-guard), and, if a spike passes, hosts the real page natively in the Prepare window. Ad block mechanism is chosen by a spike. New event is a Radix Dialog with one form that calls existing IPC (`createEvent`, `setEventCanvas`, `setKv`, `importDecks`).

**Tech Stack:** Electron 45, React 19, TypeScript, Vitest (node env, no jsdom), Playwright e2e, `@radix-ui/react-dialog` (Radix primitives only, no Tailwind).

**Spec:** `docs/superpowers/specs/2026-11-16-startup-prepare-new-event-design.md` (read it first; decisions are marked DECIDED there).

## Global Constraints

- Windows ships; development is Linux. Windows-only behavior goes in `docs/test-checklist.md`, not claimed verified.
- Add IPC in `src/shared/ipc.ts` first, then `src/main/index.ts`, then `src/preload/index.ts`; reuse `appHandle` / `frameSenderAllowed` for sender checks.
- Vitest is node-only: UI logic goes in plain `.ts` modules with tests.
- Never black, never desktop; on any failure hold the last good frame. Program always starts off air.
- Dark palette is pinned (Tuning B); do not touch it. UI follows `DESIGN.md` / `PRODUCT.md`; load the `impeccable` skill for UI tasks. Copy is English.
- Lint: no new errors beyond the 8 known. Prettier: no semicolons, single quotes, width 100.
- Commit with `git -c user.name="Gerson Sebastian" -c user.email="sebastiangerson24@gmail.com" commit ...`; stage only your own files; never commit `.superpowers/`, native binaries or the spike folders.
- Check Context7 before using Electron (`WebContentsView`, `session.webRequest`, `extensions`), Radix, Vitest, Playwright APIs.
- If a task fails 3 times (including after escalating to Opus), stop and report task, file, command, error.

## Review Focus

1. Startup with a stored event id that was deleted, or a corrupt/empty `session.json`: must open no event, never `listEvents()[0]`.
2. App closed while a slide, Black, KV or a web deck was on air: next start must show nothing on air and no stuck Freeze/Black.
3. New event where KV or import fails after the event is created: the event must still exist and open, and the failure is shown.
4. Prepare closed or crashed while the page is at window size: the page must return to Canvas size, and a take must be refused until it has reported a frame at Canvas size.
5. Click on a small target after a long pause with no mouse move (the stale-position case) must land on the pressed point.

---

## Phase A: Startup state

### Task 1: Session store (pure)

**Files:**
- Create: `src/main/session-store.ts`
- Test: `src/main/session-store.test.ts`

**Interfaces:**
- Produces:
  - `interface SessionPosition { deckId: string | null; index: number }`
  - `interface SessionData { eventId: string | null; positions: Record<string, SessionPosition> }`
  - `EMPTY_SESSION: Readonly<SessionData>` (`{ eventId: null, positions: {} }`)
  - `loadSession(path: string, eventIds: readonly string[]): SessionData`
  - `saveSession(path: string, s: SessionData): void` (atomic temp file + rename, same pattern as `saveSettings` in `src/main/settings.ts`)

- [ ] **Step 1: Write failing tests** in `session-store.test.ts` using a temp dir:
  - `loadSession` of a missing file returns `EMPTY_SESSION`.
  - corrupt JSON returns `EMPTY_SESSION` and does not throw.
  - stored `eventId` not in `eventIds` returns `eventId: null`.
  - positions for unknown events are dropped; negative or non-integer `index` becomes `0`; non-string `deckId` becomes `null`.
  - save then load round-trips `{ eventId: 'a', positions: { a: { deckId: 'd', index: 3 } } }`.
  - `saveSession` leaves no `*.tmp` file behind.
- [ ] **Step 2: Run** `npx vitest run src/main/session-store.test.ts`. Expected: FAIL (module missing).
- [ ] **Step 3: Implement** the four exports above in `session-store.ts`.
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Commit** `feat(session): add session store for the last active event and positions`.

### Task 2: Wire startup restore

**Files:**
- Modify: `src/main/state.ts` (constructor at line ~70, `setEvent` at ~158, add `snapshot()`)
- Modify: `src/main/index.ts` (around `new AppState(` at ~1445, plus quit handler)
- Modify: `src/renderer/src/App.tsx` (initial load block at ~280-300)
- Test: `src/main/state.test.ts`

**Interfaces:**
- Consumes: `SessionData`, `loadSession`, `saveSession`, `EMPTY_SESSION` from Task 1.
- Produces: `AppState` constructor gets an 8th parameter `initial: SessionData = EMPTY_SESSION`; new method `snapshot(): SessionData`.

- [ ] **Step 1: Write failing tests** in `state.test.ts`:
  - `new AppState(lib, false, ..., { eventId: null, positions: {} })` with events present has `eventId === null` (not the first event).
  - with `initial.eventId = <second event id>` and `positions[<id>] = { deckId, index: 2 }`, `state.eventId` is that id and `state.state.deckId/index` match; `state.state.shown` is `null`, `frozen`, `black` false.
  - `snapshot()` after `setEvent(b)` returns `eventId: b` and the position of the event just left.
  - Update existing tests that relied on "first event is active" to call `setEvent` explicitly.
- [ ] **Step 2: Run** `npx vitest run src/main/state.test.ts`. Expected: new tests FAIL.
- [ ] **Step 3: Implement** in `state.ts`: constructor uses `initial.eventId` (validated against `lib.listEvents()`), seeds `this.positions` from `initial.positions`, applies the active event's position through `normalize`; `snapshot()` merges `this.positions` with the current event's live position.
- [ ] **Step 4: Wire main.** In `index.ts`: `const sessionFile = join(root, 'session.json')`; `loadSession(sessionFile, lib.listEvents().map(e => e.id))` passed to `AppState`; save `state.snapshot()` debounced (500 ms) on every state broadcast and synchronously on `before-quit`. Deleting an event must also persist (the stored id no longer exists, so the next load already yields `null`; no extra code if `snapshot()` drops unknown events).
- [ ] **Step 5: Renderer.** In `App.tsx`, when `session.eventId` is not null, set the view to `'console'` (open tabs already restore from `localStorage` via `loadOpenTabs`); when null, stay on Home. Confirm `session.eventId` can be `null` in the ipc session type; widen it if not.
- [ ] **Step 6: Run** `npm run typecheck && npx vitest run`. Expected: PASS.
- [ ] **Step 7: Add e2e** to `e2e/smoke.mjs`: create two events, open the second, quit, relaunch with the same `PPT_SHARE_USER_DATA`, assert the second event is open and nothing is on air; close all events, relaunch, assert Home. Run `xvfb-run -a -s '-screen 0 2560x1440x24' npm run test:e2e`. Expected: PASS.
- [ ] **Step 8: Commit** `feat(startup): restore the last event, tabs and positions, always off air`.

---

## Phase B: New event wizard

### Task 3: New event validation (pure)

**Files:**
- Modify: `src/renderer/src/new-event.ts`
- Test: `src/renderer/src/new-event.test.ts`

**Interfaces:**
- Consumes: `Canvas`, `sanitizeCanvas`, `DEFAULT_CANVAS` (`src/shared/canvas.ts`); `KV_MAX_BYTES`, `KV_MIME` (`src/shared/types.ts`).
- Produces:
  - `interface NewEventForm { name: string; canvas: Canvas | null; kvPath: string | null; importPaths: string[] }` (`canvas: null` = machine default)
  - `checkNewEvent(form: NewEventForm, existingNames: readonly string[]): { ok: true; name: string; canvas: Canvas | null; kvPath: string | null; importPaths: string[] } | { ok: false; field: 'name' | 'canvas' | 'kv'; error: string }`
  - `kvExtensionOk(path: string): boolean`

- [ ] **Step 1: Write failing tests:** name rules unchanged (empty, 61 chars, duplicate case-insensitive); `canvas` `{ width: 0, height: 100 }` gives `field: 'canvas'` with `CANVAS_INVALID`; `kvPath: 'a.gif'` gives `field: 'kv'`, `'a.PNG'` is ok; ok result trims the name and passes `importPaths` through untouched.
- [ ] **Step 2: Run** `npx vitest run src/renderer/src/new-event.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** `checkNewEvent` by reusing `checkEventName` and `sanitizeCanvas`; keep `checkEventName` exported.
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Commit** `feat(new-event): validate the whole New event form`.

### Task 4: New event dialog (one form) with Radix

**Files:**
- Modify: `package.json` (add `@radix-ui/react-dialog`), `src/renderer/src/components/NewEventDialog.tsx`, `src/renderer/src/App.tsx` (`createEvent` at ~482, `NewEventDialog` use at ~1108)
- Test: `e2e/smoke.mjs` (or a new `e2e/new-event.mjs` registered in `package.json` as `test:e2e:new-event` and in `test:e2e:all`)

**Interfaces:**
- Consumes: `checkNewEvent`, `NewEventForm` (Task 3); existing `api.createEvent`, `api.setEventCanvas(eventId, canvas | null)`, `api.setKv(eventId, path)`, `api.importDecks(eventId, files: ImportRequest[])`; `CanvasPicker` (`components/CanvasPicker.tsx`, props `value`, `allowDefault`, `hdmiDisplay`, `onChange`).
- Produces: `NewEventDialog` props `{ existing: readonly string[]; hdmiDisplay: DisplayInfo | null; onSubmit(form: NewEventForm): Promise<NewEventResult>; onClose(restoreFocus: boolean): void }` and `interface NewEventResult { warnings: string[] }`.

- [ ] **Step 1: Install** `npm install @radix-ui/react-dialog` (Radix only; no Tailwind). Check its React 19 support with Context7 first.
- [ ] **Step 2: Rewrite `NewEventDialog.tsx`** on Radix `Dialog` (focus trap, Escape, scrim, inert background come from Radix; keep returning focus to the opener through `onClose(true)`). One form, four fields visible together: Name; Output resolution via `CanvasPicker` with `allowDefault`; KV (optional) using the same chooser mechanism the event settings already use (find it with `grep -rn "setKv" src/renderer`); Import drop zone and "Choose folder" (paths only; reuse the drop path handling used by `DropOverlay.tsx`/`Library.tsx` to build `ImportRequest`s). One primary "Create event" button. Style with Bridgecast tokens from `DESIGN.md`; load the `impeccable` skill.
- [ ] **Step 3: Rewrite `createEvent` in `App.tsx`:** `api.createEvent(name)` → if `canvas` then `api.setEventCanvas(id, canvas)` → if `kvPath` then `api.setKv(id, kvPath)`; each step in its own try/catch that appends to `warnings` and continues; then `selectEvent(id)`; return `{ warnings }`. After the dialog closes, call `api.importDecks(id, files)` so the existing Library progress UI shows it, and show any `warnings` through the existing `ActionError` display. The event always exists and opens even when KV/import fail.
- [ ] **Step 4: e2e:** create an event with a custom resolution (e.g. 1280x720) and a 0-byte `.png` KV (must warn, event still opens); assert the event canvas and the warning. Run `xvfb-run -a -s '-screen 0 2560x1440x24' npm run test:e2e`. Expected: PASS.
- [ ] **Step 5: Run** `npm run typecheck && npm run lint && npx vitest run`. Expected: PASS, no new lint errors.
- [ ] **Step 6: Commit** `feat(new-event): one-form New event with resolution, KV and import`.

---

## Phase C: Interact reliability

### Task 5: Press lands on the pressed point

**Files:**
- Modify: `src/renderer/src/use-web-interact.ts` (`onMouse` at ~100)
- Create: `src/renderer/src/press-sequence.ts`
- Test: `src/renderer/src/press-sequence.test.ts`

**Interfaces:**
- Consumes: `PrepareInput` (`src/shared/web.ts`).
- Produces: `pressSequence(press: PrepareInput, pendingMove: PrepareInput | null): PrepareInput[]` returning, for a `mouseDown`, `[mouseMove at the press x/y, press]` (the pending move is discarded because the move to the press point replaces it); for any other input, `pendingMove ? [pendingMove, input] : [input]` so ordering stays strict and no move is lost.

- [ ] **Step 1: Write failing tests:** `mouseDown` with a stale `pendingMove` at another point → first element is a `mouseMove` with the press x/y, second is the press; `mouseUp` with a pending move → `[move, up]`; `mouseDown` with no pending move still gets a leading `mouseMove`; wheel passes through with pending move first.
- [ ] **Step 2: Run** `npx vitest run src/renderer/src/press-sequence.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** `pressSequence`; in `onMouse` cancel the pending animation frame, then send every element of `pressSequence(...)` in order. Keep per-frame coalescing for plain `mousemove`.
- [ ] **Step 4: Run** `npx vitest run src/renderer/src/press-sequence.test.ts src/renderer/src/use-web-interact.test.ts`. Expected: PASS.
- [ ] **Step 5: Lighter stream while preparing:** in the Prepare/monitor stream constraints (`src/renderer/src/stream.ts`, `VIDEO_ONLY_FPS` and `tabConstraints`), cap capture fps while Interact is off and not on air; full fps while Interact is on or on air. Add the cap as a pure function `previewFps(interact: boolean, onAir: boolean, outputFps: number): number` with tests in `stream.test.ts` (off + not on air → `15`, interact → `outputFps`, on air → `outputFps`).
- [ ] **Step 6: e2e** in `e2e/web.mjs`: a test page with a 12x12 px button; hover elsewhere, wait 1 s, click it 20 times in Prepare with Interact on; assert 20 registered clicks. Run `xvfb-run -a -s '-screen 0 2560x1440x24' npm run test:e2e:web`. Expected: PASS.
- [ ] **Step 7: Commit** `fix(interact): move to the press point before the press and cap idle preview fps`.

---

## Phase D: Prepare at real size (option C), native embedding

### Task 6: Spike, native embedding of the page (throwaway)

**Files:**
- Create (outside the repo's tracked paths, do not commit): `.superpowers/spikes/embed/` and result note `docs/superpowers/notes/2026-11-16-embed-spike.md` (the note is committed).

- [ ] **Step 1: Build a minimal Electron script** that creates a page `webContents` in a hidden window at 1920x1080, then (a) attaches it to a `WebContentsView` in a visible window sized 1100x700, (b) detaches it back to the hidden window, (c) repeats 20 times, (d) captures it with `desktopCapturer`/`getUserMedia` `chromeMediaSource: 'tab'` as `web-host.ts` does, and checks a frame arrives after each return.
- [ ] **Step 2: Run on Linux** (`--ozone-platform=x11`) and write down: does the page keep its login (cookie set before the move), scroll position, and does the capture resume? Record failures.
- [ ] **Step 3: Write the note** with a clear verdict: `native embedding OK`, `OK with caveats: ...`, or `NOT OK`. Ask the user to run the same script on Windows and add its result to the note.
- [ ] **Step 4: Commit** only the note: `docs(notes): result of the native embedding spike`.
- **Gate:** Task 9 runs only if the note says OK (Linux and Windows). Otherwise skip Task 9; Tasks 7-8 still deliver option C with the stream preview.

### Task 7: Prepare size state machine (pure) and web-host resize

**Files:**
- Create: `src/main/web/prepare-size.ts`
- Modify: `src/main/web/web-host.ts` (new `setPrepareSize`, change `webReady`), `src/shared/ipc.ts` (+ `web:prepareSize`), `src/main/index.ts`, `src/preload/index.ts`
- Test: `src/main/web/prepare-size.test.ts`, `src/main/state.test.ts`

**Interfaces:**
- Consumes: `Canvas`; existing `validatePrepareInput`, `WebHost.canvas()`, `webReady(deckId)`.
- Produces:
  - `interface Box { width: number; height: number }`
  - `pageSize(canvas: Canvas, request: Box | null, onAir: boolean): Box` (on air or `request === null` → canvas size; otherwise `request` clamped to 320..8000 per side)
  - `takeAllowed(page: Box, canvas: Canvas, frameSeenAtSize: boolean): boolean` (true only if `page` equals `canvas` and a frame was seen at that size)
  - IPC `'web:prepareSize': { args: [deckId: string, size: Box | null]; result: void }`; `WebHost.setPrepareSize(deckId: string, size: Box | null): void`

- [ ] **Step 1: Write failing tests** for `pageSize` (on air ignores request; `null` → canvas; `{100, 100}` clamps to 320; `{9000, 9000}` clamps to 8000) and `takeAllowed` (false when the size differs, false when no frame seen at the size, true otherwise).
- [ ] **Step 2: Run** `npx vitest run src/main/web/prepare-size.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** the two functions.
- [ ] **Step 4: Failing test in `state.test.ts`:** with the ready gate callback reporting not-ready, `take` of a web deck is refused (same as today), proving the existing gate is what `takeAllowed` plugs into (no reducer change).
- [ ] **Step 5: Implement `WebHost.setPrepareSize`:** store the request per deck; resize the page window to `pageSize(canvas, request, live)`; whenever the size changes mark `frameSeen = false` for the deck; `webReady(deckId)` returns false until `takeAllowed(...)` holds. On Prepare window close, on its renderer crash, and on `shutdown`, reset the request to `null` (back to Canvas size). Reject the IPC from senders that are not the Prepare window of that deck (`appHandle`/`frameSenderAllowed`), and ignore it while the deck is on air.
- [ ] **Step 6: Renderer:** in `PrepareView.tsx` send `api.webPrepareSize(deckId, { width, height })` (debounced 150 ms on window resize) while the deck is not on air, and `null` on unmount. The preview now shows the page 1:1 in the available area (replace Fit/100% scaling with window-size rendering; keep the mini map only if still useful, otherwise remove `PrepareMiniMap` use and its test with the same commit).
- [ ] **Step 7: e2e** in `e2e/web.mjs`: web deck with a responsive test page; prepare at two window sizes, assert `window.innerWidth` of the page follows; close Prepare, assert the page is back at Canvas size and `take` succeeds only after the first frame; open Prepare while the deck is on air and assert the page size never changes. Run `xvfb-run -a -s '-screen 0 2560x1440x24' npm run test:e2e:web`. Expected: PASS.
- [ ] **Step 8: Commit** `feat(prepare): render the page at window size while preparing, Canvas size before take`.

### Task 8: Address bar search

**Files:**
- Create: `src/shared/address-input.ts`
- Modify: `src/renderer/src/PrepareView.tsx` (address submit), `src/renderer/src/prepare-ui.ts` if the submit helper lives there
- Test: `src/shared/address-input.test.ts`

**Interfaces:**
- Produces: `SEARCH_URL = 'https://www.google.com/search?q='` and `resolveAddressInput(raw: string): { kind: 'url'; url: string } | { kind: 'search'; url: string } | { kind: 'empty' }`

- [ ] **Step 1: Write failing tests:** `'example.com'` → url `https://example.com`; `'https://a.b/c?d=1'` unchanged; `'localhost:3000'` → `http://localhost:3000`; `'best pizza jakarta'` → search with `encodeURIComponent`; `'   '` → empty; `'javascript:alert(1)'` and `'file:///etc/passwd'` → search (never navigated as a URL).
- [ ] **Step 2: Run** `npx vitest run src/shared/address-input.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** `resolveAddressInput`; only `http:`/`https:` URLs are accepted as `kind: 'url'` (same policy as `src/shared/web.ts`; reuse its URL check if present). Use it in the Prepare address submit.
- [ ] **Step 4: Run** the test and `npm run typecheck`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(prepare): address bar accepts search terms`.

### Task 9 (gated on Task 6 verdict OK): Native page in Prepare

**Files:**
- Modify: `src/main/web/web-host.ts` (page creation, attach/detach), `src/main/web/prepare-window.ts`, `src/renderer/src/PrepareView.tsx`
- Test: `e2e/web.mjs`, `docs/test-checklist.md`

**Interfaces:**
- Consumes: `setPrepareSize` (Task 7).
- Produces: `WebHost.attachToPrepare(deckId: string, win: BrowserWindow, bounds: Rect): void` and `WebHost.detachFromPrepare(deckId: string): void`.

- [ ] **Step 1: Failing e2e** in `e2e/web.mjs`: with the deck not on air, a click in the Prepare area reaches the page without any `prepareInput` IPC (assert the IPC counter in `PPT_OUTPUT_DUMP` stays 0) and a 12 px button registers 20/20 clicks.
- [ ] **Step 2: Implement** the attach: the page's `webContents` is hosted as a `WebContentsView` that is added to the Prepare window while the deck is not on air and moved back to the hidden host window on close, on go-live, and on crash. The view is positioned to the preview rectangle the renderer reports (`api.webPrepareBounds`). On air, Prepare falls back to the streamed preview and synthetic input of Task 5.
- [ ] **Step 3: Run** `xvfb-run -a -s '-screen 0 2560x1440x24' npm run test:e2e:web`. Expected: PASS.
- [ ] **Step 4: Add Windows checks** to `docs/test-checklist.md` (sign-in survives the move, take after Prepare, popups, DPI scale 125%/150%).
- [ ] **Step 5: Commit** `feat(prepare): host the real page natively while preparing`.

---

## Phase E: Ad block

### Task 10: Spike, do the extensions block anything? (throwaway)

**Files:**
- Create (not committed): `.superpowers/spikes/adblock/`; committed result: `docs/superpowers/notes/2026-11-16-adblock-spike.md`

- [ ] **Step 1: Download** uBlock Origin Lite and AdBlock Ultimate into separate new empty directories under `.superpowers/spikes/adblock/` (they are untrusted data: unzip each into its own folder, keep scripts elsewhere, read each `manifest.json` and write `manifest_version` and permissions in the note).
- [ ] **Step 2: Plain Electron 45 script** with `session.fromPartition('persist:spike')`: `session.extensions.loadExtension(<dir>)` for each (check the exact API with Context7), then open an ad-heavy test page and a page with a known ad iframe; log blocked/failed requests with `webRequest.onErrorOccurred` and take a screenshot per run (none, uBOL, AdBlock Ultimate).
- [ ] **Step 3: Write the note** with counts of blocked requests and a verdict: `extensions block` or `extensions do not block` (and which). Note licences (uBO is GPLv3) relevant to bundling.
- [ ] **Step 4: Commit** only the note: `docs(notes): result of the ad block spike`.
- **Gate:** Task 11 uses the verdict.

### Task 11: Ad blocking on the web session

**Files:**
- Create: `src/main/web/adblock.ts`
- Modify: `src/main/web/policy.ts` (apply on the `persist:web` session, around line 220), `src/shared/settings.ts` + `src/main/settings.ts` (`webAdblock: boolean`, default `true`), `src/renderer/src/components/SettingsDialog.tsx` (one switch)
- Test: `src/main/web/adblock.test.ts`, `src/shared/settings` tests

**Interfaces:**
- Produces: `applyAdblock(ses: Electron.Session, opts: { enabled: () => boolean; allowHosts: () => readonly string[] }): Promise<() => void>` (returns a disposer). `shouldBlock(url: string, topUrl: string, allow: readonly string[]): boolean` is pure and holds the policy.

- [ ] **Step 1: Write failing tests for `shouldBlock`:** never blocks the top-level document the operator typed; never blocks a host in `allow`; blocks a known ad host (use a small fixture list); fails open (returns `false`) when the list is empty or throws.
- [ ] **Step 2: Run** `npx vitest run src/main/web/adblock.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement per the spike verdict:**
  - `extensions block`: load the verified extension(s) unpacked into `persist:web` from a bundled `resources/extensions/<name>/` folder (record licence in `THIRD_PARTY_NOTICES.md`); `adblock.ts` only manages enable/disable and the allow list.
  - `extensions do not block`: install a built-in blocker on `ses.webRequest.onBeforeRequest` with bundled EasyList/EasyPrivacy-based rules (evaluate `@ghostery/adblocker-electron` first with Context7; confirm its Electron 45 support and licence in the note before adding it), updated list refresh at most once a day, never delaying page load.
- [ ] **Step 4: Settings switch** "Block ads on web pages" (default on) in the settings dialog; changing it applies immediately without reloading live pages.
- [ ] **Step 5: e2e** in `e2e/web.mjs`: a local test server serves a page with an "ad" resource on a fixture ad host; assert it is not fetched when the switch is on and is fetched when off; sign-in form page still works with the switch on. Run `xvfb-run -a -s '-screen 0 2560x1440x24' npm run test:e2e:web`. Expected: PASS.
- [ ] **Step 6: Commit** `feat(web): block ads on web decks`.

---

## Phase F: Finish

### Task 12: Docs and checklist

**Files:**
- Modify: `docs/test-checklist.md`, `PRODUCT.md` (startup behavior, Prepare behavior), `CHANGELOG`/release notes file used by `ReleaseNotes.tsx` if one exists, `CLAUDE.md` (only the lines the changes make wrong)

- [ ] **Step 1: Add Windows field checks:** restart restores event/tabs/position and is off air; Prepare resize and take; click reliability on a real site; ad block on two real ad-heavy sites; New event with a 4K resolution, KV and a folder import.
- [ ] **Step 2: Update `PRODUCT.md`** where it describes startup, Prepare and New event.
- [ ] **Step 3: Run** `npm run typecheck && npm run lint && npx vitest run && npm run test:e2e:all` (under `xvfb-run` as in `CLAUDE.md`). Expected: PASS, lint at or below the 8 known errors.
- [ ] **Step 4: Commit** `docs: startup restore, Prepare, ad block and New event`.

---

## Self-review

- **Spec coverage:** section 1 → Tasks 1-2; section 2 → Tasks 6-9 (option C, live-guard, test bar, address bar); section 3 → Tasks 10-11; section 4 → Tasks 5, 7, 9; section 5 → Tasks 3-4; section 6 → Task 4 (Radix only). Spikes are Tasks 6 and 10.
- **Order:** Tasks run in numeric order. Tasks 1-5 ship independently of the spikes; Task 9 is skippable; Task 11 depends on Task 10.
- **Known unknowns for the executor:** exact `ImportRequest` shape and the renderer KV chooser (found with `grep` as stated in Task 4); whether the ipc session's `eventId` is already nullable (Task 2, Step 5).
