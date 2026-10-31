# Home, Event Tabs and Output Sound Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Each task runs in one subagent, model `sonnet`, effort `medium`; escalate to `opus` when stuck or after a failed review. UI tasks load the `impeccable` skill, read `PRODUCT.md`, `DESIGN.md` and the surface brief `.impeccable/surfaces/src-renderer-src-app-tsx.md`, and compare against the mockup. Check Context7 before using Web Audio, `MediaDevices`, Electron, Vitest or Playwright APIs.

**Goal:** Finish the parts of the operator redesign that were left open: the Home view (event browser) and open-event tabs in the header from `mockups/operator-redesign/index.html`, the transport bar sound button as the output mute, and a Sound section in the Settings dialog that chooses where the output sound goes.

**Architecture:** The operator's current event stays what it is today: main's `AppState.eventId`, switched by `events:select`. Open tabs are renderer UI state in `localStorage`. A new main-owned field `ProgramState.airEvent` names the event the output belongs to, so the renderer can mark the live tab and the Home banner, and so that the canvas and the STANDBY key visual follow the on-air event instead of the visible tab. The library gains three optional event fields (`createdAt`, `lastOpened`, `archived`) that old `events.json` files load without. Home lists events through one new summary call. Sound reuses the existing `AudioSettings` (`muted`, `deviceId`, `route`) through a new partial-update call, so the transport button, the Output section and the Settings dialog write the same state without overwriting each other.

**Tech Stack:** Electron 45, React 19, TypeScript, plain CSS variables, Phosphor icons, Vitest 5 (node env, no jsdom), Playwright e2e.

**Spec:** `mockups/operator-redesign/index.html` (Home: `.home`, `#onair`, `.toolbar`, `#ltabs`, `#filterMenu`, `#evgrid`, `renderHome()`; tabs: `.tabsbar`, `.otab`, `renderTabs()`, `openEvent()`, the close handler; transport: the `Sound` `tbtn`), `DESIGN.md`, the surface brief, `PRODUCT.md`, and the redesign plan `docs/superpowers/plans/2026-10-30-operator-redesign.md` (all done except what this plan covers). The mockup wins where it and this plan disagree on looks; this plan wins on behaviour (the mockup is a static demo).

## Model decisions (settled here)

These answer the open questions of the brief. Tasks implement them; do not reopen them.

1. **Open tabs.** At most `MAX_TABS = 8` events are open as tabs. Opening a ninth closes the least recently used tab that is neither the current event nor the air event. Tabs are kept in the operator window's `localStorage` under `open-events` as `{ ids: string[] }` (per machine, like the panel tab). On load, ids of events that no longer exist are dropped, and main's current event is added if it is missing. Corrupt storage gives `[]` plus the current event. Main does not store tabs.
2. **Current event.** The current event is main's `AppState.eventId` (what `getSession()` returns). Clicking a tab calls `events:select`, exactly like the old Event menu. On Home no tab is selected (`aria-selected="false"` on all), but the current event does not change until the operator opens another one.
3. **One Program, one air event.** There is one output, so one event is on air at a time. `ProgramState.airEvent` (set by main, never by the reducer) is the event that holds the slide on the output, or the event whose key visual is on air. At STANDBY with nothing on air it is the event that owned the output last (at start: the current event). Selecting a tab never changes `shown`, `frozen`, `black`, `kv`, `kvUrl` on air or `canvas`. Today it can change `canvas` (an event canvas override) and can put the new event's KV on air at STANDBY; Task 2 fixes both.
4. **Live event not the visible tab.** The live tab shows the icon-only `StatusTag` of the output state (LIVE, FROZEN, BLACK or KV) after its name, with `title` and `aria-label` such as "Annual Meeting 2026, on air". This replaces the brief's earlier "the event tab has no state tag" (user decision 2026-11-01). The Program title row adds the air event's name to the grey sub text ("/ Program · Annual Meeting 2026") while the air event is not the current one. Home shows the on-air banner first and pins the air event first in every list it is in, with the accent ring.
5. **Back to console.** On Home, Back to console (and Esc) opens the air event's console: it opens its tab if it was closed and selects it. With nothing on air, Esc returns to the current tab; with no tab open it does nothing.
6. **Closing a tab.** Closing removes the tab only. The output never changes, the event is not deleted or archived. Closing the current tab selects the tab to its left (else the first one). Closing the last tab shows Home. The air event's tab can be closed; the Home banner and Back to console reopen it.
7. **Recent / All / Archive.** Recent: events that are not archived, sorted by `lastOpened` (then `createdAt`, then file order) newest first, at most 12. All: every event, archived ones included and marked "Archived" in the sub line (as in the mockup), same sort. Archive: archived events only. Filter (one choice): All events, On air, With web pages, No decks yet. Search matches the event name and its deck names, case-insensitive, trimmed.
8. **Archive.** An event card has a More button with Archive or Unarchive. Archiving never closes a tab and never changes the output. The air event cannot be archived while it is on air (the item is disabled with the reason as its description). Archived events can still be opened from All and Archive.
9. **Keys on Home.** As in the mockup: on Home the console keys (Space, arrows, PageUp/PageDown, F, B, K, N, D) are paused; N = New event, I = Import slides, W = Add web page, / = search, Esc = Back to console. A note at the bottom says so. See Open questions: the clicker.
10. **Import slides and Add web page on Home** act on the current event and switch to its console first. With no event at all they are disabled with the reason in `title` ("Create an event first.").
11. **Transport sound button = output mute.** It toggles `AudioSettings.muted`, the same flag as Mute all in Controls > Output. Accessible name stays "Mute output sound"; `aria-pressed` is the state; the icon changes shape (speaker, speaker with slash) and the pressed style is the hold-button pressed style (tint, border, ink), so state is not colour alone. `title`: "Mute output sound" or "Output sound muted. Click to unmute.".
12. **Sound destination in Settings.** A Sound section in the Settings dialog holds Output device and Sound to (Local device, Network, Both). It mirrors the controls in Controls > Output; both stay until the Windows check passes (Task 11 removes the device picker from Controls only after the user confirms). Master volume and Mute all stay in Controls > Output (show-time controls).

## Global Constraints

- "Never black, never desktop" and "switching events does not change the output" (PRODUCT.md, web decks) hold for tabs, Home and archive. Every task that touches event switching keeps the e2e `test:e2e:web` check that a live web page stays on air across an event switch green.
- Old data must load: an `events.json` without the new fields, with wrong types (`"lastOpened": "yesterday"`, `"archived": 1`) or with unknown keys loads, and wrong fields are dropped. Settings with any `audio` shape still go through `sanitizeAudio`.
- Every `deckId` and `eventId` from IPC is checked (`assertString`, the library's UUID check). New channels are added in `src/shared/ipc.ts` first, then `src/main/index.ts`, then `src/preload/index.ts`; operator-only channels use `appHandle` with the operator role.
- Exactly one window plays sound on this PC (`audioPlan` in `src/shared/omt.ts`). Nothing here changes `audioPlan`; the device choice applies to whichever window plays locally.
- Design rules from the redesign plan stand: accent is the only state colour, radii 3 / 4 / 6, heights 32 / 40 / 52, no pills for tabs, icon-only state tags only in the Program head, strip thumbnails and (new) the event tab; Home cards keep icon plus word. Colours only from `tokens.css`. WCAG 2.1 AA in both themes and every accent.
- UI copy is English, state first, no exclamation marks (`docs/brand/voice.md`). Every error names the problem and the recovery action.
- Prettier: no semicolons, single quotes, width 100. Do not add lint errors (7 known). Tests are node-only Vitest: put testable logic in plain `.ts` modules.
- Windows ships; only Linux checks here. Anything Windows-only goes into `docs/test-checklist.md`.

## Known failures (baseline, not caused by this plan)

- Unit: `libreoffice-engine` `loBridgePath` and `web/host-rules` `isAppPageUrl` fail at baseline.
- `npm run test:e2e` (smoke): "a hidden output window mutes its video" and "no black frame" fail at baseline.
- pdf.js CSP errors in the console are known noise.
- `npm run test:e2e:network`: the 30 fps check fails on this machine.

A task is done when it adds no failure beyond these.

## Review Focus

- A slide of event A is live, event B has a canvas override: select B, then Home, then a B tab close; the output canvas, `shown` and the network senders do not change (no `canvasChanged` restart). Test in Task 2.
- STANDBY, A has no KV, B has a KV: select B; the output stays as it was (no KV appears). Then a non-take action (Transition change) in B: still no KV. Test in Task 2.
- STANDBY with A's KV showing by itself: select B (no KV); A's KV stays on air. Test in Task 2.
- `events.json` from before this plan loads, and saving it again writes only the fields that exist. Test in Task 1.
- The open-tab list with a deleted event id, a duplicate, 20 ids and garbage JSON: loads to a valid list of at most 8 with the current event present. Test in Task 4.
- Pressing the transport mute while the Master volume slider is mid-drag: both the mute and the new volume are saved (no stale write). Test in Task 3 (`mergeAudio`) and by hand in Task 8.
- The Settings dialog focus trap reaches the `<select>` of Output device (today `FOCUSABLE` has no `select`). Task 9.
- Long event names (80 characters) in a tab with the live tag, on a Home card with the LIVE tag, and in the on-air banner: the name truncates, the tag never does.

## Execution Order

1. Task 1
2. Task 2, Task 3 and Task 4 in parallel (Task 2: `program.ts`, `state.ts`; Task 3: `ipc.ts`, `main/index.ts`, `preload`, `shared/settings.ts`; Task 4: new renderer modules). Task 3 calls `state.setEvent` unchanged in signature, so it does not wait for Task 2.
3. Task 5 (needs 2, 3, 4)
4. Task 6, then Task 7 (both in `Home.tsx`)
5. Task 8 and Task 9 in parallel only if run in separate worktrees (both touch `App.tsx` lightly); otherwise one after the other
6. Task 10 (verification and docs)
7. Task 11 only after the user reports the Windows sound checks of Task 10 as passed

## File Structure

- Modify `src/shared/types.ts`: `EventMeta` gains `createdAt?`, `lastOpened?`, `archived?`; new `EventSummary`.
- Modify `src/main/library.ts` (+ `library.test.ts`): load sanitising, `touchEvent`, `setArchived`, `eventOfDeck`, `eventSummaries`, `createEvent` stamps.
- Modify `src/shared/program.ts`: `ProgramState.airEvent`, `initialState.airEvent = null`.
- Modify `src/main/state.ts` (+ `state.test.ts`): air event, canvas and STANDBY KV follow it.
- Modify `src/renderer/src/model.ts` (+ `model.test.ts`): `needsCanvasConfirm` knows which event is edited.
- Modify `src/shared/settings.ts` (+ `settings.test.ts` in `src/main/` or a new `src/shared/settings.test.ts`): `mergeAudio`.
- Modify `src/shared/ipc.ts`, `src/main/index.ts`, `src/preload/index.ts`: `events:summaries`, `events:setArchived`, `audio:patch`.
- Create `src/renderer/src/open-tabs.ts` (+ test), `src/renderer/src/home.ts` (+ test).
- Create `src/renderer/src/components/EventTabs.tsx`, `src/renderer/src/components/Home.tsx`, `src/renderer/src/components/SoundSection.tsx`, `src/renderer/src/components/AudioDevicePicker.tsx`.
- Modify `Header.tsx`, `App.tsx`, `Program.tsx`, `TransportBar.tsx`, `AudioSection.tsx`, `SettingsDialog.tsx`, `EventCanvasDialog.tsx` (confirm rule), `styles/app.css`.
- Delete `src/renderer/src/components/EventMenu.tsx` once nothing imports it (Task 5); `EventCanvasDialog.tsx` stays (Deck settings opens it).

---

### Task 1: Event fields for Recent and Archive

**Files:**
- Modify: `src/shared/types.ts`, `src/main/library.ts`
- Test: `src/main/library.test.ts`

**Interfaces:**
- `EventMeta` gains, all optional so old files load:
  - `createdAt?: number` (ms since epoch; set by `createEvent`)
  - `lastOpened?: number` (ms since epoch; set by `touchEvent`)
  - `archived?: true` (absent = not archived; never stored as `false`)
- `EventSummary` (in `types.ts`): `{ id: string; deckCount: number; deckNames: string[]; hasWeb: boolean; first: { deckId: string; file: string; web: boolean } | null }`. `first` is the first slide of the first deck that has one (a web deck's `001.png` snapshot counts, with `web: true`).
- `Library` produces:
  - `touchEvent(eventId: string, now = Date.now()): EventMeta`
  - `setArchived(eventId: string, archived: boolean): EventMeta`
  - `eventOfDeck(deckId: string): string | null` (the event whose `deckIds` holds it)
  - `eventSummaries(): EventSummary[]` (one per event, in file order; a deck that cannot be read is skipped, never thrown)
  - `createEvent(name, now = Date.now())` sets `createdAt` and `lastOpened` to `now`.

- [ ] **Step 1: Write the failing tests** in `library.test.ts` (follow the existing temp-dir setup):
  - an `events.json` written by hand without the new fields loads; `listEvents()` has no `createdAt`, `lastOpened` or `archived` keys
  - `lastOpened: 'yesterday'`, `createdAt: NaN` written as `null`, `archived: 1` and `archived: false` are dropped on load; `lastOpened: 1730000000000` and `archived: true` are kept
  - `createEvent('A', 5)` has `createdAt === 5` and `lastOpened === 5`; `touchEvent(id, 9).lastOpened === 9` and the value survives a new `Library` on the same root
  - `setArchived(id, true).archived === true`; `setArchived(id, false)` removes the key (check the raw file has no `archived`)
  - `touchEvent` and `setArchived` on an unknown id throw the existing "Event not found..." message
  - `eventOfDeck` returns the owning event, and `null` for an unknown or removed deck
  - `eventSummaries()` for an empty event (`deckCount 0`, `first null`), an event with a PDF deck (first file `001.png`), an event whose first deck is a web deck (`hasWeb true`, `first.web true`), and an event with a deck folder deleted by hand (skipped, no throw)
- [ ] **Step 2: Run** `npx vitest run src/main/library.test.ts` and expect the new tests to FAIL.
- [ ] **Step 3: Implement.** In `loadEvents`, after the canvas block: keep `createdAt` and `lastOpened` only when `Number.isFinite` and `>= 0`, keep `archived` only when `=== true`, else `delete`. `copyEvent` needs no change (numbers and booleans copy with the spread). `touchEvent` and `setArchived` save with `saveEvents()` and return `copyEvent`. Do not rewrite `events.json` on load (old files stay as they are until the next real change). `eventSummaries` reads decks through `readDeck` inside try/catch per deck.
- [ ] **Step 4: Run** `npx vitest run src/main/library.test.ts`, then `npm test` and `npm run typecheck`; expect PASS except the known failures.
- [ ] **Step 5: Commit** `feat: event created, last opened and archived fields`.

### Task 2: The air event (switching events never changes the output)

**Files:**
- Modify: `src/shared/program.ts`, `src/main/state.ts`, `src/renderer/src/model.ts`, `src/renderer/src/components/EventCanvasDialog.tsx`
- Test: `src/main/state.test.ts`, `src/renderer/src/model.test.ts`

**Interfaces:**
- Consumes: `Library.eventOfDeck` (Task 1).
- `ProgramState.airEvent: string | null`, documented as "Set by main, never by the reducer", like `kvUrl` and `canvas`. `initialState.airEvent = null`. Add it to the `same()` comparison in `state.ts`.
- Rules in `AppState` (one private `resolveAir(s)` used by `normalize` and `normalizeKv`):
  - KV pressed on (`s.kv`): the air event is the event whose KV is on air (today: the current event when K was pressed).
  - Else a slide on the output (`s.shown`): `lib.eventOfDeck(s.shown.deckId)`.
  - Else (STANDBY or Black with nothing shown): the previous `airEvent`, or the current event when it is null.
  - `canvas` = `resolveCanvas(canvas of airEvent ?? current event, machine default)`.
  - The KV shown by itself at STANDBY (`kvOnAir` with `shown === null`) is the air event's KV. K pressed on still takes the current event's KV (unchanged behaviour). `setEvent` re-resolves nothing that is on the output.
- `needsCanvasConfirm(s: ProgramState, eventId?: string): boolean`: with an `eventId` that is not `s.airEvent`, a change of that event's canvas never touches the output, so it returns false. Without `eventId` (the machine default) it keeps today's rule. `EventCanvasDialog` passes its event id.

- [ ] **Step 1: Write the failing tests** in `state.test.ts` (reuse its library fixture helpers):
  - live slide of A, B has canvas 1280×720, A has none: `setEvent(B)` keeps `state.canvas` at the machine default and keeps `shown`; `airEvent === A`
  - then `next` in B (a take of a B slide): `airEvent === B` and `canvas` is 1280×720
  - STANDBY, A without KV, B with KV: `setEvent(B)` leaves `kvOnAir(state) === false`; a following `setTransition` dispatch leaves it false too
  - STANDBY with A's KV showing by itself: `setEvent(B)` (no KV) keeps `kvOnAir` true and `kvUrl` A's
  - Black with nothing shown, then `setEvent(B)`: `black` stays, `airEvent` stays A
  - K pressed in B while A's slide is live: B's KV on air (as today), `airEvent === B`; K off: `airEvent === A`
  - removing the live deck clears `shown`; `airEvent` stays the same event (STANDBY of that event)
  - no events at all: `airEvent === null`
  - `model.test.ts`: `needsCanvasConfirm(liveState, 'other-id')` is false, `needsCanvasConfirm(liveState, liveState.airEvent!)` is true, `needsCanvasConfirm(liveState)` is true
- [ ] **Step 2: Run** `npx vitest run src/main/state.test.ts src/renderer/src/model.test.ts`; expect FAIL.
- [ ] **Step 3: Implement** `resolveAir` and wire it into `normalize`, `normalizeKv` and the constructor. Keep the existing comments' intent; update the class comment ("The operator position always belongs to the active event; the output belongs to `airEvent`"). The renderer reads `airEvent` only for display; it never sends it.
- [ ] **Step 4: Run** `npm test`, `npm run typecheck`, then `xvfb-run -a -s '-screen 0 2560x1440x24' npm run test:e2e:web` (the event-switch check must stay green).
- [ ] **Step 5: Commit** `fix: switching events never changes the output canvas or key visual`.

### Task 3: IPC for summaries, archive and partial audio changes

**Files:**
- Modify: `src/shared/settings.ts`, `src/shared/ipc.ts`, `src/main/index.ts`, `src/preload/index.ts`, `src/main/settings.ts` if the save helper lives there
- Test: `src/main/settings.test.ts` (or a new `src/shared/settings.test.ts` if `mergeAudio` tests read better there)

**Interfaces:**
- `mergeAudio(saved: AudioSettings, patch: unknown): AudioSettings` in `src/shared/settings.ts`: takes only the known keys present in `patch` (`deviceId`, `muted`, `masterVolume`, `route`), runs the result through `sanitizeAudio`, and an invalid value in the patch keeps the saved one (not the default).
- Invoke channels:
  - `events:summaries`: `{ args: []; result: EventSummary[] }`
  - `events:setArchived`: `{ args: [eventId: string, archived: boolean]; result: EventMeta }`. Refused while that event is the air event and something is on air (`tally` not idle): throws "This event is on air. Take a slide of another event, then archive it."
  - `audio:patch`: `{ args: [patch: Partial<AudioSettings>]; result: Settings }`. Merges with the saved audio (`mergeAudio`), saves, and broadcasts like `setAudio` does today (the `onAudioSettings` push), so every window and the Output section follow.
- `events:select` also calls `lib.touchEvent(eventId)` after `state.setEvent` succeeds.
- `Api` (preload): `eventSummaries()`, `setEventArchived(eventId, archived)`, `patchAudio(patch)`.

- [ ] **Step 1: Failing tests** for `mergeAudio`: `{ muted: true }` changes only `muted`; `{ masterVolume: 140 }` clamps like `sanitizeAudio`; `{ route: 'bogus' }` keeps the saved route; `{ deviceId: '' }` sets `null`; `null`, `[]` and `'x'` return the saved settings unchanged; unknown keys are ignored.
- [ ] **Step 2: Run** the test file; expect FAIL. Implement `mergeAudio`; expect PASS.
- [ ] **Step 3:** Add the three channels in `ipc.ts`, the handlers in `index.ts` (`assertString` on ids, a boolean check on `archived`; `audio:patch` reuses the code path of `audio:set` so the output windows get the same push), and the preload methods.
- [ ] **Step 4: Run** `npm run typecheck`, `npm test`, `npm run test:e2e:network` (only the known 30 fps failure may stay red).
- [ ] **Step 5: Commit** `feat: event summaries, archive and partial audio settings over IPC`.

### Task 4: Open tabs and Home list logic (pure)

**Files:**
- Create: `src/renderer/src/open-tabs.ts`, `src/renderer/src/home.ts`
- Test: `src/renderer/src/open-tabs.test.ts`, `src/renderer/src/home.test.ts`

**Interfaces:**
- `open-tabs.ts` (storage passed in, like `panel-sections.ts`):
  - `MAX_TABS = 8`
  - `loadOpenTabs(storage: Pick<Storage, 'getItem'> | null, existing: string[], current: string | null): string[]` (drops unknown and duplicate ids, keeps order, adds `current` at the end if missing, caps at 8 keeping `current`)
  - `saveOpenTabs(storage, ids): void` (try/catch, key `open-events`)
  - `openTab(ids, id, keep: (string | null)[]): string[]` (no duplicate; over the cap, removes the oldest id that is not in `keep`, where `keep` is the current and air event)
  - `closeTab(ids, id, current: string | null): { ids: string[]; next: string | null }` (`next` is the tab to select when the closed one was current: left neighbour, else the first, else `null` = show Home)
- `home.ts`:
  - `type HomeTab = 'recent' | 'all' | 'archive'`, `type HomeFilter = 'all' | 'live' | 'web' | 'empty'`, `RECENT_MAX = 12`
  - `homeList(events: EventMeta[], summaries: EventSummary[], o: { tab: HomeTab; filter: HomeFilter; query: string; airEvent: string | null; onAir: boolean }): EventMeta[]` (rules in Model decision 7; the air event first when `onAir`)
  - `eventSubLine(ev: EventMeta, s: EventSummary | undefined, now: number): string`: count ("No decks yet", "1 deck", "4 decks") plus " · " plus "Archived", "Opened this minute", "Opened today, 18:40", "Opened yesterday, 18:40", "Opened 12 Oct", or "Created 28 Oct", or nothing when the event has no dates. Use the 24-hour clock and `en-GB` day month as in the mockup.
  - `FILTER_LABEL: Record<HomeFilter, string>` (`Filter`, `On air`, `With web pages`, `No decks yet`; the button shows `Filter` for `all`)

- [ ] **Step 1: Write the failing tests:** load with garbage JSON, a missing key, a deleted id, duplicates, 20 ids; `openTab` at the cap never drops the current or the air event; `closeTab` of the current, of another tab, of the last tab; `homeList` per tab, per filter, search by deck name, the air event first, archived only in All and Archive, Recent capped at 12 and sorted by `lastOpened` then `createdAt` then file order; `eventSubLine` for each wording above with a fixed `now`.
- [ ] **Step 2: Run** both files; expect FAIL. **Step 3: Implement**; expect PASS.
- [ ] **Step 4: Run** `npm test` and `npm run typecheck`.
- [ ] **Step 5: Commit** `feat: open event tabs and Home list logic`.

### Task 5: Event tabs in the header

UI task: load `impeccable`, compare with the mockup header (`.tabsbar`, `.otab`, `.x`, `#homeBtn`, `#newBtn`).

**Files:**
- Create: `src/renderer/src/components/EventTabs.tsx`
- Modify: `Header.tsx`, `App.tsx`, `Program.tsx`, `styles/app.css`
- Delete: `src/renderer/src/components/EventMenu.tsx` (after checking nothing else imports it and that "Canvas for this event…" is reachable from Deck settings > Canvas > Change; if it is not, keep `EventMenu.tsx` and report)

**Interfaces:**
- Consumes: `open-tabs.ts` (Task 4), `ProgramState.airEvent` (Task 2), `StatusTag` (`variant="icon"`).
- `EventTabs({ events, ids, current, view, airEvent, airState, onSelect(id), onClose(id), onHome(), onNew() })`. `view: 'console' | 'home'`.
- `App.tsx` gains `view` state (`'console' | 'home'`, starts `'console'` when an event exists, else `'home'`) and the tab list (`loadOpenTabs` on start, `saveOpenTabs` on change).

- [ ] **Step 1:** Header order as in the mockup: brand, separator, Home button (`aria-pressed` on Home, `aria-label="Events home"`), separator, the tab list (`role="tablist"`, `aria-label="Open events"`), New. Each tab is `role="tab"` with the name (truncates), then the live tag when `id === airEvent` and the tally is not idle, then a close control (`aria-label="Close <name>"`; keyboard reachable; Delete on a focused tab closes it). Arrow keys move between tabs, Enter or Space selects. Only the tab list shrinks.
- [ ] **Step 2:** Behaviour from Model decisions 1, 2, 4 and 6: selecting a tab calls the existing `selectEvent` and sets `view = 'console'`; close uses `closeTab` and selects `next` or shows Home; opening an event from anywhere uses `openTab` with `keep = [current, airEvent]`. New reuses the inline name field of the old Event menu (60 characters, Enter creates, Esc or blur cancels) and opens the new event as a tab.
- [ ] **Step 3:** Program title row: while `program.airEvent` is set, differs from the current event and something is on air, the grey sub text reads `/ Program · <air event name>` (truncates before the deck name does).
- [ ] **Step 4:** Remove `EventMenu` from the header. Update e2e selectors that open the Event menu (`grep -rn "Choose event\|event-btn\|New event name" e2e/`) to the tabs and the New field; keep every scenario.
- [ ] **Step 5:** Check by hand (`npm run dev`) at 1180px and 1920px, both themes: 8 tabs with 80-character names, the live tag on a non-current tab, close the current and the live tab, the output does not change (watch the HDMI window or `PPT_OUTPUT_DUMP`). Run `npm run typecheck`, `npm test`, `test:e2e:web`, `test:e2e`.
- [ ] **Step 6: Commit** `feat: open-event tabs in the header`.

### Task 6: Home view

UI task: load `impeccable`, compare with the mockup Home (`.home` and everything under it), in both themes and with orange, violet and rose.

**Files:**
- Create: `src/renderer/src/components/Home.tsx`
- Modify: `App.tsx`, `styles/app.css`

**Interfaces:**
- Consumes: `api.eventSummaries()` (Task 3), `home.ts` (Task 4), `StatusTag` (`variant="word"`), `thumbUrl`.
- `Home({ events, summaries, current, openIds, program, airEvent, onOpen(id), onBack(), onNew(), onImport(), onAddWeb(), onArchive(id, archived) })`. `App.tsx` loads summaries when Home opens and after an import finishes or a deck is added or removed while Home is open.

- [ ] **Step 1:** Layout from the mockup: centred 1120px column. The on-air banner first (`role="status"`, accent ring, word tag, "<deck>, slide 3" and the event name, primary Back to console with an `Esc` key cap), shown only when something is on air. Toolbar: search (`/` key cap, `type="search"`, label "Search events and decks"), New event (primary, `N`), Import slides (`I`), Add web page (`W`). Underlined tabs Recent / All / Archive (`role="tablist"`, arrow keys). Right side: Filter menu button (`aria-haspopup="menu"`, `aria-pressed` when a filter is set, label from `FILTER_LABEL`; radio items with `role="menuitemradio"`, Esc closes and returns focus) and the grid/list toggle (`aria-pressed`). The view, tab and filter are kept in `localStorage` (`home-view`), try/catch.
- [ ] **Step 2:** Cards (`<button>` with `aria-label="Open <name>"`): preview area with the first slide thumbnail (`thumbUrl(first.deckId, first.file)`, 16:9, `--r-sm`, `loading="lazy"`), the deck count or a globe in the corner chip, a film icon for an event with no decks; footer with the word tag on the air event, the name (truncates) and `eventSubLine`. Open tabs get the 50% accent ring, the air event the full accent ring. List view: 120px preview column, as in the mockup.
- [ ] **Step 3:** Empty and no-match states: "No events match “<query>”." or "No events here." with Clear search and filter and New event. A first start with no events at all shows New event and "No events yet. Create one to add decks." (copy per `docs/brand/voice.md`).
- [ ] **Step 4:** Keys (Model decision 9): while `view === 'home'` the console key handler in `App.tsx` does nothing; Home handles N, I, W, `/` and Esc (not while typing; Esc in the search field clears it first, as in the mockup). The note at the bottom: "Space, F, B and K are paused here and work again in the console. N, I, W and Esc work on this page." Back to console follows Model decision 5.
- [ ] **Step 5:** Import slides and Add web page follow Model decision 10 (switch to the current event's console, then open the file picker or the Add web page dialog).
- [ ] **Step 6:** Check: Home with and without something on air; 0, 1, 12 and 60 events; an 80-character name with the LIVE tag; an event whose first deck failed to import; a web-first event; both themes, three accents. `npm run typecheck`, `npm test`, `test:e2e:web`.
- [ ] **Step 7: Commit** `feat: Home event browser`.

### Task 7: Archive from Home

UI task: load `impeccable`. The mockup has no archive control; use the existing menu style (`.menu`, `menuNav.ts`) and keep it quiet.

**Files:**
- Modify: `src/renderer/src/components/Home.tsx`, `App.tsx` (handler), `styles/app.css`

- [ ] **Step 1:** Each card footer gets a 32px icon button "More actions for <name>" (`aria-haspopup="menu"`) that is a sibling of the card button, not inside it (no nested buttons). Menu items: Open, Archive (or Unarchive on archived events). For the air event while on air, Archive is disabled with the description "On air. Take a slide of another event first.".
- [ ] **Step 2:** Archive calls `api.setEventArchived`, replaces the event in `events`, keeps the tab open and shows the existing short note ("Archived <name>." / "Unarchived <name>."). A refused archive shows the main error message.
- [ ] **Step 3:** Check keyboard use (Tab to More, Enter, arrows, Esc returns focus) and that an archived event leaves Recent, stays in All with "Archived", and shows in Archive. `npm run typecheck`, `npm test`.
- [ ] **Step 4: Commit** `feat: archive and unarchive events from Home`.

### Task 8: Transport sound button mutes the output

UI task: load `impeccable`; the button is the mockup's `tbtn icon` at the right end of the transport bar, styled with the hold-button pressed state.

**Files:**
- Modify: `src/renderer/src/components/TransportBar.tsx`, `src/renderer/src/components/Program.tsx`, `App.tsx`, `src/renderer/src/components/AudioSection.tsx`, `styles/app.css`

**Interfaces:**
- Consumes: `api.patchAudio` (Task 3), `useOutputSettings().audio` and `setAudio`.
- `TransportBar` gains `muted: boolean | null` (null while the settings load: the button is disabled) and `onToggleMute(): void`.

- [ ] **Step 1:** Show the sound button after the spacer: `SpeakerHighIcon` when sound plays, `SpeakerSlashIcon` when muted; `aria-label="Mute output sound"`, `aria-pressed={muted}`, `title` per Model decision 11. Remove the comment that says it is hidden. No new keyboard shortcut.
- [ ] **Step 2:** `onToggleMute` calls `api.patchAudio({ muted: !muted })` and stores the returned audio with `out.setAudio`. An error goes to the existing action error next to the tally.
- [ ] **Step 3:** `AudioSection` switches every save to `patchAudio` with only the field it changes (`{ masterVolume }` from the debounce, `{ muted }`, `{ deviceId }`, `{ route }`), so a pending volume save can no longer undo a mute from the transport bar. The Mute all switch and the transport button show the same state (both read `out.audio.muted`).
- [ ] **Step 4:** Check: mute from the transport, the Output section switch flips; unmute from the switch, the button flips; drag the Master volume and press the button within 150 ms, then reload the renderer: both values kept. With a video slide on HDMI the sound goes silent and `data-gain` on the output root reads `0.00`. Both themes, three accents, key caps hidden under 560px still leave the button visible. `npm run typecheck`, `npm test`, `npm run test:e2e` (only the known smoke failures).
- [ ] **Step 5: Commit** `feat: transport sound button mutes the output`.

### Task 9: Sound section in the Settings dialog

UI task: load `impeccable`; follow the dialog sections of the mockup (`.dsec`, `h3`, `.row`, `.lbl`, `.seg`). Check Context7 for `MediaDevices.enumerateDevices`, `devicechange` and `AudioContext.setSinkId` before changing audio code.

What exists today (read before starting):
- Device list: `useAudioOutputs()` in `src/renderer/src/audio.ts` calls `navigator.mediaDevices.enumerateDevices()`, keeps `kind === 'audiooutput'` without Chromium's virtual `default` and `communications` entries (`audioOutputs`), and refreshes on `devicechange`. Labels need the media permission that `src/main/permissions.ts` (`permissionAllowed`) grants to the app's own pages only.
- Applying it: the output window (`OutputView.tsx`) picks the sink with `pickSink(deviceId, outputs)` (a saved device that is gone plays on the default and is reported `missing`) and calls `OutputAudio.setSink`, which uses `AudioContext.setSinkId` for the Web Audio graph (video, web deck streams, the PowerPoint sound worklet) and `HTMLMediaElement.setSinkId` for an element outside the graph (`SlideLayers.tsx` `applySink`).
- Route: `AudioSettings.route` (`local`, `omt` shown as Network, `both`) and `audioPlan` decide which single window plays on this PC and whether the OMT window taps the sound for the network.
- The controls live in `AudioSection.tsx` inside Controls > Output (`OutputStatus.tsx`): Audio device, Sound to, Master volume, Mute all.

**Files:**
- Create: `src/renderer/src/components/AudioDevicePicker.tsx` (the device `<select>`, its missing-device warning and hint, moved out of `AudioSection.tsx`), `src/renderer/src/components/SoundSection.tsx`
- Modify: `AudioSection.tsx` (uses `AudioDevicePicker`), `SettingsDialog.tsx`, `App.tsx`, `styles/app.css`

**Interfaces:**
- `AudioDevicePicker({ id, deviceId, disabled, onChange(deviceId: string | null) })`; ids must differ between the two places (`audio-device` in Controls, `set-audio-device` in Settings) and test ids too (`audio-device`, `settings-audio-device`).
- `SoundSection({ audio: AudioSettings | null, onSaved(a: AudioSettings) })`: heading "Sound"; Output device (`AudioDevicePicker`); Sound to (`Segmented`, the same three labels and hint as Controls); a note "Exactly one window plays sound on this PC: the HDMI output while it shows, otherwise the network output." Saves with `api.patchAudio`. Loading state "Loading sound settings." while `audio` is null.
- `SettingsDialog` gains `audio` and `onAudioSaved` props; section order Appearance, Sound, About.

- [ ] **Step 1:** Extract `AudioDevicePicker` from `AudioSection` with no behaviour change; run `npm run test:e2e` and check the Controls device picker still works (e2e uses `audio-device`).
- [ ] **Step 2:** Build `SoundSection` and add it to the dialog. Add `select` (and `textarea`) to the dialog's `FOCUSABLE` selector so the focus trap reaches the picker.
- [ ] **Step 3:** Both places read `out.audio` and write through `patchAudio`, so a change in one shows in the other at once (the dialog is open over the console; the Output section updates behind it).
- [ ] **Step 4:** Check on Linux: pick a device in Settings, the Controls picker follows; unplug or fake a missing device (save an unknown id through `patchAudio` in the devtools console) and both show "Saved device (not connected)" with the warning; reload, the choice persists. Tab cycles through the dialog including the select. `npm run typecheck`, `npm test`, `npm run test:e2e`.
- [ ] **Step 5: Commit** `feat: sound device and route in Settings`.

### Task 10: Verification and documentation

**Files:**
- Modify: `docs/test-checklist.md`, `PRODUCT.md`, `.impeccable/surfaces/src-renderer-src-app-tsx.md`, `DESIGN.md` (only the tab-tag rule), e2e scripts if selectors changed
- Create: `.impeccable/review/*.png` (not committed)

- [ ] **Step 1:** `npm run typecheck && npm test && npm run lint` (7 known lint errors, the 2 known unit failures). `xvfb-run -a -s '-screen 0 2560x1440x24' npm run test:e2e:web`, `npm run test:e2e:network` (known 30 fps failure only), `npm run test:e2e` (known smoke failures only), `npm run test:e2e:native`.
- [ ] **Step 2:** Add an e2e check to `e2e/web.mjs` (or the smoke file, whichever already creates two events): with a slide live in event A, open event B in a tab, open Home, close A's tab; the output dump (`PPT_OUTPUT_DUMP`) shows the same `shown`, `canvas` and `take` before and after.
- [ ] **Step 3:** Capture Home (empty, with events, on air, no match, list view), the header with 8 tabs and a live non-current tab, the transport bar muted and unmuted, and the Settings dialog Sound section, in light and dark at 1280×800 with orange and violet. Compare with the mockup and fix what the captures show in one batch.
- [ ] **Step 4:** `docs/test-checklist.md`, new items (Indonesian, like the rest of the file) under "Jendela operator yang didesain ulang (Windows)" or a new "Home dan tab event" section, and under "Slide video" for sound:
  - the transport mute silences HDMI sound, PowerPoint native sound (named pipe) and a web deck's sound, and the network sound in vMix or OBS
  - Settings > Sound lists the Windows devices with names (not empty labels), including the HDMI display's audio device and a Bluetooth headset, and the choice plays there
  - unplug the chosen device during a video slide: sound moves to the Windows default, the "not connected" warning shows, plug it back and pick it again
  - change the Windows default device while "Default (Windows)" is chosen: note whether the output follows without a restart
  - the saved device survives an app restart and a Windows restart (device ids can change after driver updates; if it shows "not connected", note it)
  - switch tabs and open Home while a slide, a native PowerPoint deck and a web page are on air: nothing changes on HDMI or in the network receiver
- [ ] **Step 5:** `PRODUCT.md`: Panel and label names (header: Home, event tabs, New; Settings dialog: Appearance, Sound, About; Controls > Output keeps Master volume and Mute all), the air event rule ("one event is on air; tabs and Home never change the output, including the canvas and the KV"), Recent / All / Archive, and replace the "Event menu" wording. Brief: close the Open items for the sound icon and the event-tab tag; record the tab tag decision. `DESIGN.md`: the icon-only tag list adds the event tab.
- [ ] **Step 6: Commit** `docs: Home, event tabs and output sound checks`.

### Task 11 (gated): Device picker only in Settings

Run only after the user reports the Task 10 Windows sound checks as passed.

**Files:**
- Modify: `AudioSection.tsx`, `OutputStatus.tsx`, e2e scripts that use `audio-device`, `PRODUCT.md`, `docs/test-checklist.md`

- [ ] **Step 1:** In Controls > Output replace the device picker with one row "Sound device: <name or Default (Windows)>" and a Change button that opens the Settings dialog scrolled to Sound with focus on the picker. Keep Sound to in both places unless the user says otherwise.
- [ ] **Step 2:** Move the e2e device checks to `settings-audio-device`. Run `npm run test:e2e`.
- [ ] **Step 3: Commit** `feat: choose the sound device in Settings only`.

## Open questions (not settled by the code)

- **Clicker on Home.** The mockup pauses Space, arrows and PageDown on Home. A speaker's clicker then does nothing while the operator browses Home. This plan follows the mockup. If the user wants Next and Prev to keep working on Home (N stays New event), change one line in Task 6 Step 4.
- **Which event opens at start.** Main starts on the first event in `events.json` (`AppState` constructor). With `lastOpened` it could start on the most recent one instead; that is the proposed "Open the last event on start" setting and is not built here.
- **Default device follow on Windows.** Whether an `AudioContext` on the default sink (`''`) follows a change of the Windows default device without a restart is not known from the code; Task 10 asks the field check.
