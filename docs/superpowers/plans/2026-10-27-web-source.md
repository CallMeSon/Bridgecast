# Web Source (Web Decks) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An operator adds a web page (Canva present, any site) as a deck, prepares it unseen in a Prepare window, takes it live on HDMI and OMT, and the speaker's clicker moves the page.

**Architecture:** `WebHost` in main keeps one hidden Canvas-sized window per web deck of the open event in session `persist:web`. Output windows and the operator monitor get the page through tab capture (`getMediaSourceId` + `getUserMedia`) shown by a shared `StreamLayer`. Next/Prev on a live web deck are forwarded to the page as arrow keys; D / Shift+D change deck; failures put the output on HOLD (last frame).

**Tech Stack:** Electron 45 (`BrowserWindow`, `session`, `webContents.getMediaSourceId`, `sendInputEvent`, `capturePage`), React 19, Web Audio, Vitest, Playwright smoke test with a local HTTP fixture.

**Spec:** `docs/superpowers/specs/2026-10-27-web-source-design.md` (depends on `2026-10-27-canvas-audio-levels-design.md` and `2026-10-27-omt-output-design.md`)

## Preconditions

- The canvas/audio-levels plan and the OMT plan are merged (`ProgramState.canvas`, `OutputAudio` with `setPlan`, `audioPlan`, OMT window with `role=omt`).
- `git status` clean for `package.json` / `package-lock.json`.

## Global Constraints

- UI copy is English, exact strings from the spec: `Enter a web address that starts with https://.`, `This page is not secure (http). Use https if the site supports it.`, `Web page not ready`, `Web page: Next goes to the page. Press D to take the next deck.`, `Web page lost its connection. The output holds the last good frame. Press K for the key visual or take the next deck.`, `Could not open <domain>. Check the internet connection, then Reload.`, `The web page cannot be shown on <HDMI|OMT>. It shows the last snapshot.`, `Not on air. You can click and type.`, `ON AIR: input locked. Press F to freeze before you click.`, `FROZEN: the output holds the last frame. Your clicks are not on air until you unfreeze.`, `Sign out of all websites on this PC? Web decks will reload.`, `Take another deck first, then sign out.`
- Session `persist:web`: no preload, `sandbox: true`, `contextIsolation: true`, `nodeIntegration: false`, `autoplayPolicy: 'no-user-gesture-required'`; user agent = Electron's Chrome UA with the `Electron/<v>` and `ppt-share/<v>` tokens removed.
- Permissions denied: `media` (camera/mic), `geolocation`, `notifications`, `midi`, `midiSysex`, `hid`, `serial`, `usb`, `clipboard-read`, `display-capture`, `pointerLock`, `openExternal`; allowed: `fullscreen`, `clipboard-sanitized-write`.
- Navigation: only `http:` and `https:`; downloads cancelled; `window.open` allowed only while the deck is not live (normal window on the operator display, same session, never captured).
- HOLD triggers (event based only, no connection polling): main-frame `did-fail-load`, `render-process-gone`, `unresponsive` longer than 5000 ms, capture track `ended`. HOLD never ends by itself.
- Next/Prev on a live, not frozen web deck never change position; D / Shift+D (`nextDeck`/`prevDeck`, Shift decides, not case) work for every deck.
- Every IPC from a page renderer is refused; only app windows (operator, HDMI, OMT, Prepare) may request capture ids or send input (check `event.sender` like existing handlers).
- Check Context7 before using: `webContents.getMediaSourceId`, `getUserMedia` with `chromeMediaSource: 'tab'`, `sendInputEvent`, `session.setPermissionRequestHandler`/`setPermissionCheckHandler`, `setUserAgent`, `will-download`, `setWindowOpenHandler`.
- UI tasks: load `impeccable:impeccable` first, follow `DESIGN.md` / `PRODUCT.md`.
- Commit with `git -c user.name="Gerson Sebastian" -c user.email="sebastiangerson24@gmail.com" commit ...`, message ending `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`. Never stage unrelated files.
- A task that fails more than 3 times (including on Opus) stops; report task, file, command and error to the user.

## Review Focus

1. Clicker held down or pressed twice fast on a live web deck: each press forwards exactly one arrow key (no repeat), position never changes. Test in Task 2.
2. A pasted URL with spaces, `canva.com/design/...` without scheme, `javascript:`, `file:///`: accepted with `https://` added, or refused with the exact message. Test in Task 1.
3. The event is switched while a web deck is on air: the page stays open and on air (existing rule: switching events never changes the output) and closes only after it leaves air. Removing the live web deck follows the existing rule (output goes black). Test in Task 4 and Task 8.
4. A page opens a popup or asks for the camera while live: refused, nothing on air changes. Test in Task 3 and Task 8.
5. Prepare input sent while the deck is live and not frozen (stale renderer, fast clicks): refused in main. Test in Task 3.

---

## File Structure

- `src/shared/web.ts` (URL rules, copy, pure helpers), `src/shared/types.ts`, `src/shared/program.ts` (actions, reducer rules)
- `src/main/web/policy.ts` (session policy, pure parts), `src/main/web/web-host.ts`, `src/main/web/prepare-window.ts`, `src/main/library.ts`, `src/main/state.ts`, `src/main/index.ts`, `src/shared/ipc.ts`, preload
- `src/renderer/src/components/StreamLayer.tsx`, `src/renderer/src/stream.ts` (constraints), `src/renderer/src/PrepareView.tsx`, `src/renderer/src/components/AddWebDialog.tsx`, changes in `SlideLayers.tsx`, `OutputView.tsx`, `Program.tsx`, `Library.tsx`, `NextPanel.tsx`, `Controls.tsx`, `model.ts`, `main.tsx`
- `fixtures/web/index.html`, `e2e/web.mjs` (or new section in `smoke.mjs`), docs

---

### Task 1: Spike (throwaway code)

**Files:**
- Create: `docs/superpowers/notes/web-source-spike.md` (results only; code in the scratchpad, never committed)

- [ ] **Step 1: Tab capture of a hidden window** (Linux): hidden `BrowserWindow` 1920×1080 (`show:false`, `paintWhenInitiallyHidden`, `backgroundThrottling:false`) loading a moving test page; a second visible window plays it via `getMediaSourceId` + `getUserMedia({ video: { mandatory: { chromeMediaSource: 'tab', chromeMediaSourceId, maxWidth, maxHeight, maxFrameRate } }, audio: { mandatory: { chromeMediaSource: 'tab', chromeMediaSourceId } } })`. Expected: moving picture in the visible window.
- [ ] **Step 2: Sound** with `webContents.setAudioMuted(true)` on the hidden page (YouTube or a local `<audio>`): is sound still in the captured stream? Record yes/no and the alternative if no.
- [ ] **Step 3: Input**: `sendInputEvent` clicks, typing and wheel on a local form page. Ask the user to run the Canva part (sign in by email, click Present, arrow keys move slides) and the Google sign-in check with the Chrome user agent; record results.
- [ ] **Step 4: Measure** capture latency (timestamp drawn on the page vs. shown) and CPU/RAM with 3 hidden pages at 1920×1080 and 3840×1080.
- [ ] **Step 5: Windows checklist** for the user in the notes (occlusion with and without `disable-features=CalculateNativeWinOcclusion`, same checks).
- [ ] **Step 6: Gate.** Step 1 or 2 fails → stop and report to the user (back to brainstorming). Else commit the notes `docs: web source spike results` and continue.

### Task 2: Model, URL rules and reducer

**Files:**
- Create: `src/shared/web.ts`, `src/shared/web.test.ts`
- Modify: `src/shared/types.ts`, `src/shared/program.ts`, `src/shared/program.test.ts`, `src/renderer/src/model.ts` (`keyToAction`), `src/renderer/src/model.test.ts`

**Interfaces:**
- Produces:
  - `sanitizeWebUrl(input: string): { url: string; warning?: string } | { error: string }` (trim; no scheme → `https://`; `http:` → warning copy; any other scheme, spaces inside the host, empty → error copy). `webDomain(url: string): string` (hostname without `www.`).
  - `DeckMeta.source` adds `'web'`; `DeckMeta.web?: { url: string }`.
  - `ShownSlide.web?: { deckId: string }` (set by `moveTo` when the deck is a web deck).
  - `ProgramState.webHold: boolean` (initial false).
  - Actions: `{ type: 'nextDeck' }`, `{ type: 'prevDeck' }`, `{ type: 'resumeWeb' }`.
  - `webKey(state: ProgramState, decks: DeckLike[], action: Action): 'ArrowRight' | 'ArrowLeft' | null` — non-null for `next`/`prev` when `shown` is a web deck, it is the operator deck and not frozen.
  - Reducer: `next`/`prev` with the operator deck being a web deck and not frozen return the same state (also with auto advance). `nextDeck`/`prevDeck` → `moveTo` slide 0 of the next/previous deck with slides in event order, crossing sections (frozen: preview only). `webHold` is cleared by any take of another deck, `toggleKv`, `toggleBlack`, `resumeWeb`; nothing else sets it (main does, Task 4).
  - `keyToAction`: `d`/`D` → `nextDeck`, with Shift → `prevDeck` (Caps Lock `'D'` without Shift → `nextDeck`).

- [ ] **Step 1: Write failing tests**: URL table (`' https://canva.com/x '`, `'canva.com/design/ABC/view'`, `'http://x.org'` → warning, `'javascript:alert(1)'`, `'file:///etc/passwd'`, `'ht tps://x'`, `''` → error); `webDomain`; reducer: next/prev on live web deck unchanged (`toBe`), with autoAdvance too; frozen web deck: next moves the preview normally; nextDeck/prevDeck across a section boundary; nextDeck at last deck unchanged; webHold cleared by K, B, take of another deck, resumeWeb, not by next; `webKey` cases; `keyToAction` D, Shift+D, Caps Lock, `e.repeat` → null.
- [ ] **Step 2: Run** `npx vitest run src/shared/web.test.ts src/shared/program.test.ts src/renderer/src/model.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the same, `npm run typecheck`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: web deck model, URL rules, next deck keys`

### Task 3: Session policy and input validation

**Files:**
- Create: `src/main/web/policy.ts`, `src/main/web/policy.test.ts`

**Interfaces:**
- Produces:
  - `chromeUserAgent(electronUa: string): string`
  - `permissionAllowed(permission: string): boolean`
  - `navigationAllowed(url: string): boolean` (`http:`/`https:` only)
  - `popupAllowed(live: boolean): boolean`
  - `type PrepareInput = { kind: 'mouse'; type: 'mouseDown' | 'mouseUp' | 'mouseMove'; x: number; y: number; button: 'left' | 'right' | 'middle'; clickCount: number } | { kind: 'wheel'; x: number; y: number; deltaX: number; deltaY: number } | { kind: 'key'; type: 'keyDown' | 'keyUp' | 'char'; keyCode: string; modifiers: string[] }`
  - `validatePrepareInput(raw: unknown, canvas: Canvas, deck: { live: boolean; frozen: boolean }): Electron.InputEvent | null` — rejects when live and not frozen, coordinates outside 0–1 or not finite, unknown kinds/types, `keyCode` longer than 32; maps x/y to canvas pixels (rounded).
  - `applyWebSession(ses: Session, electronUa: string, isLive: (webContentsId: number) => boolean): void` — UA, permission handlers, `will-download` cancel. (Not unit tested; covered in Task 8.)

- [ ] **Step 1: Write failing tests**: UA strips both tokens and keeps `Chrome/x`; permission table; navigation table (`mailto:`, `canva:`, `ms-word:`, `file:` false); `popupAllowed`; `validatePrepareInput`: live+not frozen → null, live+frozen → event, x=1.2 → null, NaN → null, `{x:0.5,y:0.5}` on 3840×1080 → `{x:1920,y:540}`, unknown kind → null.
- [ ] **Step 2: Run** `npx vitest run src/main/web/policy.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** again, `npm run typecheck`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: web session policy and prepare input validation`

### Task 4: Library, WebHost and main wiring

**Files:**
- Create: `src/main/web/web-host.ts`
- Modify: `src/main/library.ts`, `src/main/library.test.ts`, `src/main/state.ts`, `src/main/state.test.ts`, `src/shared/ipc.ts`, preload, `src/main/index.ts`

**Interfaces:**
- Consumes: Tasks 2–3; `ProgramState.canvas`.
- Produces:
  - `Library.addWebDeck(eventId: string, d: { name: string; url: string; snapshotPath: string; width: number; height: number }): DeckMeta` (source `'web'`, one slide `001.png` = snapshot); `Library.setWebUrl(eventId, deckId, url): DeckMeta`; `Library.updateWebSnapshot(deckId, pngPath): void` (replaces `001.png` and its thumbnail).
  - `AppState`: `constructor(..., webReady: (deckId: string) => boolean = () => true, forwardKey: (deckId: string, key: 'ArrowRight' | 'ArrowLeft') => void = () => {})`; `dispatch` calls `forwardKey` and returns the current state when `webKey` is non-null; refuses (returns current state) a result whose new `shown` is a web deck that is not `webReady`; `setWebHold(on: boolean): ProgramState`.
  - `type WebStatus = 'loading' | 'ready' | 'error'`; `class WebHost`: `constructor(lib, state, canvas: () => Canvas, onStatus: (deckId: string, s: WebStatus, message?: string) => void)`; `syncEvent(decks: DeckMeta[], shownDeckId: string | null): void` (open missing pages; close pages of decks no longer in `decks` unless the deck is `shownDeckId`, which closes once it leaves air); `reload(deckId)`, `navigate(deckId, url)`, `back(deckId)`, `forward(deckId)`; `key(deckId, key)`; `input(deckId, ev: Electron.InputEvent)`; `sourceIdFor(deckId, requester: WebContents): string`; `frameSeen(deckId)` (ready gate); `resize()` on canvas change; `signOut(): Promise<void>`; `shutdown()`. On `did-finish-load` and when a deck leaves air: `capturePage` → `updateWebSnapshot`. HOLD triggers from Global Constraints call `state.setWebHold(true)` when the deck is live.
  - IPC: `'web:add'` `[eventId, url, name?]` → `DeckMeta` (validated with `sanitizeWebUrl`; name default `<title>` then domain); `'web:setUrl'`, `'web:reload'`, `'web:nav'` `[deckId, 'back' | 'forward']`, `'web:input'` `[deckId, PrepareInput]`, `'web:sourceId'` `[deckId]` → string, `'web:frame'` `[deckId]`, `'web:openPrepare'` `[deckId]`, `'web:signOut'`; broadcast `'web:status'` `{ deckId, status, message? }`. Sign out refused with the copy while a web deck is live.
  - `index.ts`: `WebHost` follows `state.setEvent` / deck add/remove (`syncEvent`), canvas changes (`resize`); `app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion')` merged with any existing value.

- [ ] **Step 1: Write failing tests**: library `addWebDeck` / `setWebUrl` / `updateWebSnapshot` (files and JSON); `AppState` with fakes: live web deck + `next` → `forwardKey('ArrowRight')` once and same state; take of a not-ready web deck refused; `setWebHold(true)` then `toggleKv` clears it.
- [ ] **Step 2: Run** `npx vitest run src/main/library.test.ts src/main/state.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** library and state changes, then `WebHost`, IPC and wiring.
- [ ] **Step 4: Run** `npx vitest run`, `npm run typecheck`, `npm run build`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: web host, web decks in the library and program`

### Task 5: StreamLayer in the output and the operator monitor

**Files:**
- Create: `src/renderer/src/stream.ts`, `src/renderer/src/stream.test.ts`, `src/renderer/src/components/StreamLayer.tsx`
- Modify: `src/renderer/src/model.ts`, `src/renderer/src/model.test.ts`, `src/renderer/src/components/layers.ts`, `SlideLayers.tsx`, `src/renderer/src/OutputView.tsx`, `src/renderer/src/components/Program.tsx`, `src/renderer/src/output-audio.ts`

**Interfaces:**
- Consumes: Task 4 IPC; `OutputAudio`.
- Produces:
  - `OutputMedia` adds `{ kind: 'stream'; source: 'tab'; deckId: string; poster: string; paused: boolean }` from `outputSource` when `shown.web` is set (`paused` = `frozen || webHold`).
  - `tabConstraints(sourceId: string, canvas: Canvas, fps: number, audio: boolean): MediaStreamConstraints` in `stream.ts` (shape from Task 1 Step 1).
  - `StreamLayer` (used by `SlideLayers` for `kind: 'stream'`; generic so the native-slideshow plan reuses it with `source: 'desktop'`): requests the id, opens the stream, reveals on first frame (`requestVideoFrameCallback`), reports `api.webFrame(deckId)`, pauses the `<video>` when `paused`, shows `poster` and reports the capture warning on failure or track `ended`, stops tracks on unmount. Cut/Fade with other layers as today.
  - `OutputAudio.attachStream(stream: MediaStream): void` (MediaStreamAudioSourceNode → the same gain node; detach on unmount). Program monitor and Prepare request video only, 30 fps.

- [ ] **Step 1: Write failing tests**: `tabConstraints` shape and limits; `outputSource` returns the stream media for a web `shown`, `paused` true when frozen or `webHold`, KV/Black still win; `layerFor` gives a stable id per `deckId` + take.
- [ ] **Step 2: Run** `npx vitest run src/renderer/src/stream.test.ts src/renderer/src/model.test.ts src/renderer/src/layers.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the same, `npm run typecheck`, `npm run lint`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: stream layer for web decks in the output and monitor`

### Task 6: Prepare window

Load `impeccable:impeccable` first; follow `DESIGN.md`.

**Files:**
- Create: `src/main/web/prepare-window.ts`, `src/renderer/src/PrepareView.tsx`
- Modify: `src/renderer/src/main.tsx` (route `#/prepare?deck=<id>`), `src/renderer/src/model.ts`, `src/renderer/src/model.test.ts`

**Interfaces:**
- Consumes: Tasks 3–5.
- Produces:
  - `prepareBanner(s: ProgramState, deckId: string): 'idle' | 'live' | 'frozen'` (live = `shown.deckId === deckId`; frozen when also `frozen`), mapped to the three banner strings.
  - `toPrepareInput(e: MouseEvent | WheelEvent | KeyboardEvent, rect: DOMRect): PrepareInput | null` (normalized 0–1).
  - Prepare window: normal resizable window placed on the operator display (never the HDMI display), one per deck (re-open focuses it); toolbar Back, Forward, Reload, URL field (Enter navigates via `web:setUrl`), menu with **Sign out of all websites** (confirm copy); preview via `StreamLayer` (video only) in canvas aspect; input sent only in `idle`/`frozen`; in `live` the app shortcuts (`keyToAction`) are dispatched instead and other keys ignored.

- [ ] **Step 1: Write failing tests** for `prepareBanner` (3 states, other deck live → idle) and `toPrepareInput` (centre click → 0.5/0.5, outside rect → null, key event mapping).
- [ ] **Step 2: Run** `npx vitest run src/renderer/src/model.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npx vitest run`, `npm run typecheck`, `npm run lint`; check in `npm run dev` with the local fixture page (keyboard and mouse, both themes). Expected: PASS.
- [ ] **Step 5: Commit** `feat: prepare window for web decks`

### Task 7: Operator UI for web decks

Load `impeccable:impeccable` first; follow `DESIGN.md`.

**Files:**
- Create: `src/renderer/src/components/AddWebDialog.tsx`
- Modify: `Library.tsx`, `NextPanel.tsx`, `Controls.tsx`, `App.tsx`, `src/renderer/src/model.ts`, `src/renderer/src/model.test.ts`

**Interfaces:**
- Consumes: Tasks 2, 4, 6.
- Produces:
  - `webUpNext(s: ProgramState, decks: DeckMeta[], status: Record<string, WebStatus>): string | null` → the live-web copy, `'Web page not ready'` when the next take is a not-ready web deck, else null (NextPanel shows its normal view).
  - **Add web page** button next to Import → `AddWebDialog` (URL, optional name, inline error/warning from `sanitizeWebUrl`).
  - Web deck row: globe icon, `webDomain`, status chip `Loading` / `Ready` / `Error` / `HOLD` (text + shape). Menu: **Prepare…**, **Edit URL**, **Reload**, **Sound…**; no Fit items.
  - Controls: **Prev deck** / **Next deck** buttons with `Shift+D` / `D` hints.
  - HOLD warning with **Resume web** (enabled when the deck status is `ready`), dispatching `resumeWeb`.

- [ ] **Step 1: Write failing tests** for `webUpNext` (live web deck, next is not-ready web deck, normal deck).
- [ ] **Step 2: Run** `npx vitest run src/renderer/src/model.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npx vitest run`, `npm run typecheck`, `npm run lint`; check in `npm run dev`, keyboard only, both themes. Expected: PASS.
- [ ] **Step 5: Commit** `feat: add web page, web deck rows, next deck controls, HOLD`

### Task 8: End to end and docs

**Files:**
- Create: `fixtures/web/index.html` (counter changed by ArrowLeft/ArrowRight shown large, a 440 Hz tone button, a button that calls `window.open`, a button that calls `getUserMedia({video:true})`, `window.__counter` for tests)
- Modify: `e2e/smoke.mjs` (or a new `e2e/web.mjs` registered in `test:e2e`), `PRODUCT.md`, `docs/test-checklist.md`, `docs/superpowers/specs/2026-10-06-ppt-share-design.md`

- [ ] **Step 1: E2E** with a local `http.createServer` serving `fixtures/web/`: add web deck; take refused before ready, accepted after; live → Next increments `__counter` (read with `executeJavaScript` on the host page via a `PPT_OUTPUT_DUMP` hook `globalThis.__pptWeb`) and position unchanged; D takes the next deck; output pixels not black; stop the server and Reload while live → `webHold` true, output still shows the last frame; popup refused while live and allowed when not live; camera request denied; Prepare input refused while live and accepted while frozen; switching to another event keeps the live web page on air and its host window open, taking a slide of the new event closes it.
- [ ] **Step 2: Run** `npm run test:e2e`. Expected: all pass, old checks included.
- [ ] **Step 3: Docs**: `PRODUCT.md` (web decks; the only part of a show that needs the network, guarded by the ready gate and HOLD; D / Shift+D; HOLD), main spec, checklist items from the spec (Canva present from a view link and an account, clicker on Canva, YouTube sound Local/OMT/Both, odd canvas, internet unplugged then Reload → HOLD, Sign out).
- [ ] **Step 4: Commit** `test: web decks end to end; docs`
