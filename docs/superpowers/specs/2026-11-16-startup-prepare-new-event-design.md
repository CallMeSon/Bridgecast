# Startup state, Prepare screen, ad block, New event wizard (draft design)

Status: **DRAFT, waiting for the user's approval.** Written 2026-11-16. The user answered the six
open questions the same day (decisions are marked **DECIDED** below). Two things remain
spike-gated, not question-gated: the ad block mechanism (section 3) and native embedding of the
page in Prepare (section 2/4). Nothing here has been built.

Language note: notes are English here; the user speaks Indonesian. User-facing app copy stays English.

## Intent

The operator wants Bridgecast to feel predictable and fast to set up:

1. Closing the app and reopening it should look the same. No event should open "at random".
2. Web decks should be easy to prepare: find the page to show, sign in, set it up, without the
   screen being tied to the output resolution.
3. Ads and popups on web pages should not reach the output.
4. Clicking inside the web preview should always register and not make the app heavy.
5. Creating an event should set it up in one go (name, resolution, KV, content), not just a name.

## Goals / non-goals / anti-goals

Goals
- Same state at startup as at last close, including "no event open".
- Prepare screen usable at any window size, independent of Canvas size.
- Ad blocking on web decks (mechanism **OPEN**, see section 3).
- Reliable, lighter Interact in the web preview.
- New event wizard with name, output resolution, optional KV, import by folder or file drop.

Non-goals
- No change to how Program output renders (precedence in `model.ts` `outputSource`).
- No change to the dark palette ("Tuning B" is pinned; do not retune it inside this work).
- No new IPC channel or Home redesign beyond what the wizard needs.

Anti-goals (would be a failure even if it technically works)
- Ad blocking that breaks sign-in flows or video on common sites without a per-site off switch.
- Prepare changes that alter what goes on air (the hidden page still renders at Canvas size).
- Startup that reopens something the operator had closed.
- Breaking "never black, never desktop" on any path.

## Findings from the code (verified 2026-11-16)

- Startup: `AppState` constructor sets `activeEvent = lib.listEvents()[0]?.id ?? null`
  (`src/main/state.ts:82`). The last active event is not persisted anywhere, so the first event in
  the list opens every time. `EventMeta.lastOpened` exists but is not used for this.
- Prepare: `PrepareView.tsx` (859 lines) draws the hidden page in a preview with the Canvas aspect,
  Fit or 100% with pan (`prepare-view.ts`, `stage.ts`). The web page itself is a hidden
  `BrowserWindow` at Canvas size (`web-host.ts` ~line 490) captured into a MediaStream.
- Interact: pointer and key input go renderer -> IPC (`prepareInput`) -> `validatePrepareInput`
  -> `webContents.sendInputEvent` (`web-host.ts:318-335`, `use-web-interact.ts`). Mouse moves are
  coalesced to one per animation frame; a mousedown/mouseup is sent on its own without a move to the
  press position first.
- New event: `NewEventDialog.tsx` has one Name field; `checkEventName` in `new-event.ts`;
  `createEvent(name)` in `ipc.ts:385`. `EventMeta` already has `canvas?` (per-event override,
  `setEventCanvas`) and `kv?` (`Library.setKv`). Import queue exists (`import-queue.ts`).
- The web session is `persist:web` (`web-host.ts`, `policy.ts` applies the web source policy).
- Electron is 45. The UI has no Tailwind or Radix today (shadcn needs both).
- Reference repo `/home/econ/work/stagecast` (mentor's, fork of mmdkcxx/stagecast; WPF + WebView2,
  up to date, branches `main`, `beta`, `pattern-app` checked): its Prepare-like screen has a tab
  list on the left, address bar with back/forward/reload, Fit/100% toggle, Interact toggle, and a
  large preview with a tally frame. **It contains no ad block or extension code.** WebView2 can
  load browser extensions through its API, but stagecast does not call it.

## 1. Restore state on startup

Persist the last active event id (or `null`) when the operator opens, closes, or deletes an event,
and read it on startup. Where: `settings.json` is for machine settings; a small `session.json` next
to it is cleaner, because it is state not configuration. **Builder's call** unless the user prefers
otherwise.

Rules
- Closed all events -> persist `null` -> next start shows Home / no event.
- Stored id no longer exists (deleted, library reset) -> fall back to no event, never to `[0]`.
- Written atomically like `saveSettings` (temp file + rename). A corrupt file means "no event".
- `AppState` takes the initial event id as a constructor argument instead of guessing.
- **DECIDED:** restore "like before closing". Restored: the active event (or none), the open event
  tabs, and the selected deck and slide position per event (`AppState.positions` is in memory today
  and must be persisted with the event id). Not restored, by safety rule: anything on air. Program
  starts off air, with no slide shown, no Black/KV/Freeze left on, and web decks not live, even if
  the app closed while they were. The operator sees the same screen, but nothing is put on the
  output until they take it. (This is my call to keep "never surprise the output"; the user said
  "pulihkan seperti sebelum ditutup" and can widen it.) Output settings (HDMI, OMT, NDI) already
  persist in `settings.json` and are unchanged.

## 2. Prepare screen redesign

Goal: easy to use and to find the source to show, not tied to Canvas size.

- **DECIDED: option C.** Browsing in Prepare feels like a normal browser: the page fills the
  Prepare window at its real size and reflows to it. The same page (one `webContents`, so login,
  scroll and state are shared) is resized to the window while it is being prepared and goes back
  to Canvas size before it is on air. Options A (separate page copy) and B (only change the zoom)
  were rejected: A cannot share state cleanly, B does not make the page behave like a browser.
- **Live-guard (required):** a deck can be taken only after the page is back at Canvas size and
  has reported a frame at that size (the existing ready gate). While a web deck is on air, Prepare
  never resizes it: on air, Prepare falls back to the old Canvas-size preview with Interact (see
  section 4), so the viewers never see a reflow.
- **Native embedding (my proposal, spike-gated):** when the deck is not on air, show the real page
  inside the Prepare window (an Electron `WebContentsView` that hosts the page's own `webContents`)
  instead of a captured stream. Clicks, scroll and typing are then native: no IPC hop, no synthetic
  input, no capture cost. The page host must create the page as a view that can be attached to the
  hidden host window (for capture and on air) or to the Prepare window (for preparing), one at a
  time. If the spike shows this is not reliable on Windows, keep option C with the stream preview
  and the input fixes in section 4.
- **Test bar (DECIDED, "utuh diuji"):** the C change gets unit tests for the size state machine
  (prepare size -> Canvas size -> ready -> take, refused while not ready), an e2e that runs a web
  deck through prepare -> take -> back to prepare in `test:e2e:web`, a reflow check with a
  responsive test page at two sizes, and an entry in `docs/test-checklist.md` for the Windows
  checks (capture size, take after resize, popups, sign-in).
- Layout inspired by stagecast: source list on the left, address bar (back, forward, reload, URL),
  Fit/100%, Interact toggle, big preview. Keep the existing Prepare features (HOLD, status, mini
  map, bounds persistence in `prepare-window.ts`).
- Easier source search (not answered by the user; **my call**, small): the address bar accepts a
  search term as well as a URL (anything that is not a valid URL or host goes to a web search,
  engine is a constant that is easy to change), and the bar suggests pages already used in this
  event's web decks. No favorites or history UI in this round.
- Window rules stay: opening again focuses it, saved bounds are clamped to a reachable display.

## 3. Ad block for web decks

The user asked to "download uBlock Origin and AdBlock Ultimate". Verified facts and risks:

- uBlock Origin (original) is Manifest V2; Chromium has removed MV2 support, so it almost
  certainly cannot load in Electron 45. The MV3 sibling is uBlock Origin Lite.
- AdBlock Ultimate advertises MV3 (developer claim, unverified).
- MV3 blockers use `declarativeNetRequest`. Electron's extension docs do not list it, and
  unlisted APIs are "provisional". Electron also loads only unpacked extensions (no `.crx`).
- Likely result: the extensions load but block nothing. **Unverified.**

**DECIDED (intent):** the user wants web decks to behave "like browsing the web" with an ad
blocker on: ads, popups and trackers gone by default, the page otherwise normal. Which mechanism
delivers that is decided by a spike, not by preference. The user's named extensions are tried
first; the built-in blocker is the fallback.

**Spike (throwaway, outside the repo, first step of this work):** load uBlock Origin Lite and
AdBlock Ultimate unpacked in a plain Electron 45 session and open an ad-heavy page, then compare
network requests blocked and visible ads.
- If they block: ship an "Extensions" panel (install from folder/zip, enable, per-site off), applied
  to the `persist:web` session only.
- If they do not: ship a built-in blocker on the `persist:web` session using the same filter lists
  (EasyList, EasyPrivacy, uBO lists) through `session.webRequest` (for example the
  `@ghostery/adblocker-electron` package; **check its current Electron 45 support and licence
  before choosing**). On by default, with a per-deck or per-site off switch.
- Either way: never block the page the operator typed into the address bar itself, and a block
  failure must fall open (page still loads), consistent with "never black".
- The user said ad block works in the mentor's app, but stagecast has no such code (checked all
  branches). It may be installed by hand in the WebView2 profile. Not needed to proceed; the spike
  decides.
- Downloading and bundling third-party extension code needs a licence check (uBO is GPLv3; check
  distribution terms before bundling) and an update story (filter lists age).

## 4. Interact: reliable clicks, lighter preview

Likely causes (from reading code, not yet measured):
1. A click lands at the position of the last mouse move that was coalesced per frame; a press with
   no preceding move can hit a stale point, so small targets and hover menus miss.
2. The preview is a captured MediaStream of a Canvas-size page, so latency and load grow with
   Canvas size (4K is heavy). A lower-latency view while preparing would help.

The user reported (2026-11-16): clicks sometimes miss and are not registered, and the preview is
somewhat heavy; they asked for "an alternative that is better", not a patch.

**DECIDED direction: remove the cause instead of patching it.**
- Not on air (the common case while preparing): show the real page in the Prepare window
  (native embedding, section 2). Input is then handled by Chromium itself: no coalescing, no IPC,
  no stale position, and no capture or MediaStream, so it is also much lighter. This replaces the
  streamed preview for this case.
- On air with Interact (rare, the operator touches the live page): keep the streamed preview and
  synthetic input, with these fixes:
  - send a `mouseMove` to the exact press position immediately before `mouseDown`, flushing any
    pending move first; per-frame coalescing only for plain hover;
  - strict ordering (mouseMove, mouseDown, mouseUp) on one channel;
  - cap the Prepare/monitor capture fps and size while Interact is off.
- Measure before and after: count of inputs sent versus applied, press-to-first-change time, and
  CPU of the app with a heavy page. "Does not register" must become a reproducible number, in a
  Vitest test for the input mapping and in an e2e that clicks a small target repeatedly.
- If native embedding fails the spike on Windows, the stream-preview fixes above still apply to
  every case.

## 5. New event wizard

Replace the one-field dialog with a short flow, in one modal:

1. Name (existing rules: trim, 60 chars, no duplicate).
2. Output resolution: preset list plus custom width x height, default = machine Canvas. Saved as
   `EventMeta.canvas` only when it differs from the machine default (absent means default, matching
   `setEventCanvas`). Reuse validation from `shared/canvas.ts` and `CanvasPicker.tsx`.
3. KV (optional): choose an image, validated by `KV_MAX_BYTES`, `KV_MIME`, `KV_FILE_RE`; stored via
   `Library.setKv`. Can be skipped.
4. Import: drop files or pick a folder; goes through `import-queue.ts` (pptx/ppt, pdf, video
   folders). Only these two entry points (folder, drop file); web decks and other sources are
   added later from the event as today.

Rules
- Creating is one action: the event exists and opens even if KV or import fails, and the failure is
  shown without losing the event (partial success is reported, not hidden).
- Cancel at any step creates nothing.
- Focus handling stays as in `NewEventDialog` today (inert background, focus trap, Escape).
- **DECIDED:** one form (not a stepper) with the four fields above visible together; Create is the
  only primary action.
- **My call:** import starts after the dialog closes and reuses the existing import progress UI in
  the Library, so the dialog stays quick and there is one place to see progress.

## 6. UI library (shadcn)

Request: use shadcn "to be quick" but adapted to the Bridgecast design system.

Facts: shadcn is Tailwind + Radix primitives + copied component files; the app has neither
Tailwind nor Radix, and `DESIGN.md` / `PRODUCT.md` are the source of truth (and `Bridgecast.pen`).
Approaches:
- A. Add Tailwind and Radix, copy shadcn components, map shadcn CSS variables onto Bridgecast tokens
  (`--bg`, `--panel`, `--raised`, `--text`, ...). Fast for new screens, adds a build step and a
  second styling system next to existing CSS.
- B. Use only the Radix primitives (Dialog, Select, Tabs, Tooltip) with existing CSS. Smaller
  footprint, less "copy and paste speed".
- C. Hand-built, as today. Slowest, no new dependency.
**DECIDED (user: "paling kompatibel dan jangan yang berat"): B.** Radix primitives only, where
they help (Dialog, Select, Tooltip and similar; React 19 compatible), no Tailwind, existing CSS and
Bridgecast tokens. Each primitive is added only when a screen needs it, starting with the New
event dialog. Dark palette stays as pinned; follow `DESIGN.md` and the `impeccable` skill for UI.

## Constraints

- Windows is the shipping platform; development is on Linux. Anything involving WebView/capture
  behaviour that differs by OS is verified on Windows by the user (`docs/test-checklist.md`).
- Reducer in `src/shared/program.ts` stays pure; new IPC goes `ipc.ts` first, then main, then
  preload; reuse `appHandle` / `frameSenderAllowed` for sender checks.
- Tests: Vitest in a node environment, so UI logic goes into plain `.ts` modules. New e2e only
  where cheap (`test:e2e:web`, `test:e2e:settings`).
- Lint: no new errors beyond the 8 known.

## Suggested order (for planning)

1. Startup state (small, independent, safe to ship alone).
2. New event wizard (self-contained; decide shadcn/Radix first).
3. Interact reliability (small input fix first, measure, then the render-size part).
4. Prepare redesign (depends on the section 2 OPEN decision and a spike).
5. Ad block (depends on the spike result).

## Spikes before planning each dependent part

1. **Ad block spike** (section 3): do the two extensions block anything in Electron 45? Output:
   keep extensions or use the built-in blocker.
2. **Native embedding spike** (sections 2 and 4): can the page's `webContents` move between the
   hidden host window and a `WebContentsView` in the Prepare window on Windows, resize cleanly,
   and still be captured and take on air afterwards? Output: native Prepare or stream Prepare.
   Windows behaviour is confirmed by the user (Linux dev machine).

## Remaining judgment calls (builder may settle)

Session file name and shape, search engine constant, filter list set and update schedule, exact
Radix packages, and the measurement harness.

## Approaches considered and decided

- Startup: persist active event, tabs and positions; off air at start. (Decided)
- Prepare: one page resized to the window (option C) with a live-guard; native embedding if the
  spike passes. A and B rejected. (Decided; the embedding is a proposal)
- Ad block: user-named extensions if the spike shows they block, otherwise a built-in blocker on
  the `persist:web` session. (Intent decided; mechanism by spike)
- Interact: remove the cause (native page when not on air); fix the stream path for the on-air
  case. (Direction decided)
- New event: one form, import after close. (Decided)
- UI library: Radix primitives only. (Decided)
