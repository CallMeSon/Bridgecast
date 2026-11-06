# Off air and the live tab Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An on-air event can never lose its tab, and the operator can take the output off air (back to STANDBY) on purpose, from Home and from the console.

**Architecture:** A new reducer action `offAir` returns the output to STANDBY (`shown: null`, no freeze, black, KV or HOLD) and keeps the operator position. The renderer keeps the air event's tab open while it is on air (the × is hidden, Delete is ignored, a tab restored from a previous session is added back). One shared `OffAirButton` with an inline confirm sits in the Home on-air banner and in Controls.

**Tech Stack:** TypeScript, React, Electron IPC (existing `program:dispatch`), Vitest (node env), Playwright e2e.

**Spec:** Decided in conversation 2026-11-06 (user: "oke boleh plan"). Problem: closing the on-air event's tab leaves the event live with no tab, and Home keeps showing it on air with no way to end it. Decision: keep tabs (multi-event prep while one is on air); add control instead of removing tabs. Rules:
1. The tab of the on-air event (tally not `idle`) cannot be closed: no × button, Delete key does nothing, tooltip `On air. Take it off air first.`
2. A new, deliberate "Off air" control ends the show: output goes to STANDBY (the air event's KV shows by itself if it has one; otherwise the empty STANDBY canvas, as at app start). Needs an inline confirm. Lives in the Home on-air banner (next to Back to console) and in the console Controls tab.
3. While the air event is on air it is always in the open tabs (also after restart from localStorage). After Off air the tab is a normal tab again and can be closed.
4. Tabs and Home still never change the output by themselves: only the Off air confirm does.

## Global Constraints

- UI copy is English. Button: `Off air`. Confirm text: `Take <event name> off air? The output goes to STANDBY.` Confirm buttons: `Off air` (primary) and `Cancel`. Tab tooltip on live tab: `On air. Take it off air first.`
- Never black, never desktop: Off air goes to STANDBY, not to Black.
- Prettier: no semicolons, single quotes, width 100. Do not add lint errors (8 known ones stay).
- Vitest is node env, no jsdom: logic lives in plain `.ts` modules, components stay thin.
- UI tasks load the `impeccable` skill and follow `DESIGN.md` (one accent state colour, hairline rules, small radii). Dark palette is pinned; do not touch `tokens.css` colours.
- Commit: `git -c user.name="Gerson Sebastian" -c user.email="sebastiangerson24@gmail.com" commit ...`, stage only your own files.

## Review Focus

1. Off air while a **web deck** is live (also during HOLD): `webHold` clears, the page leaves air, Interact goes off (it already goes off "when the deck leaves air"); no gate refuses it. Test in Task 1 (AppState).
2. Off air while a **native PowerPoint** deck is live: `SlideShowManager` must treat `shown: null` like STANDBY at start (engine kept warm for `deckId`, no crash, `engineReady` unaffected). Test in Task 1 (manager test with FakeEngine).
3. Off air while **frozen**, **Black** or **KV pressed**: all three clear and tally becomes `idle`. Test in Task 1.
4. **Restart with the live tab closed in an older build** (localStorage without the air event): the tab comes back. Test in Task 2 (`keepAirTab`).
5. **Air event is not the current tab** and the operator presses Delete or × on another tab: only that tab closes; the air tab's lock never blocks closing other tabs. Test in Task 2 (`closeTab` with `locked`).

---

### Task 1: `offAir` reducer action

**Files:**
- Modify: `src/shared/program.ts` (Action union ~line 84, `reduce` switch ~line 376)
- Test: `src/shared/program.test.ts` (new `describe('offAir')`), `src/main/state.test.ts` (new `describe('offAir')`), `src/main/slideshow/manager.test.ts` (one case)

**Interfaces:**
- Produces: `Action` member `{ type: 'offAir' }`. Renderer calls it with the existing `api.dispatch({ type: 'offAir' })`; no new IPC channel.

- [ ] **Step 1: Write the failing tests** in `program.test.ts`:
  - `offAir from live goes to STANDBY and keeps the position`: from a state with `shown` set, `deckId: 'a', index: 2`, `take: 5` → result has `shown: null, frozen: false, black: false, kv: false, webHold: false`, `deckId: 'a'`, `index: 2`, `take: 5`.
  - `offAir clears freeze, black and a pressed KV`: three inputs (`frozen: true`; `black: true`; `kv: true, kvUrl: 'slide://x/kv.png'`), each → `shown === null && !black && !kv && !frozen` (shared code does not import the renderer's `tally`).
  - `offAir at STANDBY returns the same object`: `reduce(initialState, { type: 'offAir' }, []) === initialState`.
  - `offAir clears webHold`: live web slide with `webHold: true` → `webHold: false`.
- [ ] **Step 2: Run** `npx vitest run src/shared/program.test.ts -t offAir` → FAIL (unknown action returns undefined).
- [ ] **Step 3: Implement** the `offAir` case in `reduce`: return `state` unchanged when `shown === null && !black && !kv && !frozen && !webHold`; otherwise `{ ...state, shown: null, frozen: false, black: false, kv: false, webHold: false }`. Add a one-line doc comment on the Action member: "The output goes to STANDBY on purpose (Off air); the operator position stays."
- [ ] **Step 4: Run** the same command → PASS.
- [ ] **Step 5: AppState tests** in `state.test.ts`, `describe('offAir')`:
  - after taking a slide of event A, `app.dispatch({ type: 'offAir' })` → `shown: null`, `airEvent` still A (STANDBY keeps the previous air event), `kvUrl` is A's KV url when A has one.
  - with a web deck live and `webReady` returning false, `offAir` is not refused (state changes, `webHold: false`).
  Run `npx vitest run src/main/state.test.ts -t offAir` → PASS (no AppState change should be needed; if a gate refuses it, fix the gate, not the test).
- [ ] **Step 6: Manager test** in `src/main/slideshow/manager.test.ts`: with a native deck live on FakeEngine, dispatch `offAir` → no throw, `manager.ready()` unchanged, no `nativeFallback` dispatched. Run `npx vitest run src/main/slideshow` → PASS.
- [ ] **Step 7: Run** `npm run typecheck && npm test` → PASS.
- [ ] **Step 8: Commit** `feat: offAir action returns the output to STANDBY`

### Task 2: The air event keeps its tab (pure logic)

**Files:**
- Modify: `src/renderer/src/open-tabs.ts`
- Test: `src/renderer/src/open-tabs.test.ts`

**Interfaces:**
- Produces:
  - `closeTab(ids: string[], id: string, current: string | null, locked: string | null = null): { ids: string[]; next: string | null }`: when `id === locked`, returns `{ ids, next: current }` unchanged (same `ids` array).
  - `keepAirTab(ids: string[], air: string | null, onAir: boolean): string[]`: when `onAir && air && !ids.includes(air)`, returns `openTab(ids, air, [air])`; otherwise returns `ids` (same array).

- [ ] **Step 1: Failing tests**:
  - `closeTab refuses the locked tab`: `closeTab(['a','b'], 'a', 'a', 'a')` → `{ ids: ['a','b'], next: 'a' }`.
  - `closeTab still closes other tabs while one is locked`: `closeTab(['a','b','c'], 'b', 'b', 'a')` → `{ ids: ['a','c'], next: 'a' }`.
  - `keepAirTab adds the air event back`: `keepAirTab(['b'], 'a', true)` → `['b','a']`.
  - `keepAirTab leaves ids when off air or already open`: `keepAirTab(x, 'a', false) === x`; `keepAirTab(['a'], 'a', true)` returns the same array.
  - `keepAirTab respects MAX_TABS and keeps the air tab`: 8 ids without `'a'` → length 8, includes `'a'`.
- [ ] **Step 2: Run** `npx vitest run src/renderer/src/open-tabs.test.ts` → FAIL.
- [ ] **Step 3: Implement** both in `open-tabs.ts`.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat: open tabs keep the on-air event`

### Task 3: Live tab without close, wired in App

**Files:**
- Modify: `src/renderer/src/components/EventTabs.tsx` (× button ~line 204, Delete key ~line 145)
- Modify: `src/renderer/src/App.tsx` (`closeEventTab` ~line 328, tabs effects ~line 160)
- Modify: `src/renderer/src/styles/app.css` only if the tab width jumps without the ×

**Interfaces:**
- Consumes: `closeTab(..., locked)`, `keepAirTab` (Task 2); `tally` from `model.ts`.

- [ ] **Step 1:** Load the `impeccable` skill; read `DESIGN.md` header/tab rules.
- [ ] **Step 2: EventTabs**: when `live`, do not render the `.x` button; put `On air. Take it off air first.` in the tab's `title` after the name (`${ev.name}, on air. Take it off air first.`); keep `aria-label` `${ev.name}, on air`. In the Delete-key branch, skip `onClose` when that tab is live. The tab keeps the same width (reserve the × slot in CSS if the layout e2e shows a jump).
- [ ] **Step 3: App**: `closeEventTab` passes `locked = tally(program) !== 'idle' ? program.airEvent : null` to `closeTab`. Add an effect on `[program.airEvent, tally(program), events]` that runs `setOpenIds(ids => keepAirTab(ids, program.airEvent, tally(program) !== 'idle' && events.some(e => e.id === program.airEvent)))` after tabs are loaded (`tabsLoaded.current`).
- [ ] **Step 4: Run** `npm run typecheck && npm test && npm run lint` → PASS, no new lint errors.
- [ ] **Step 5: Commit** `feat: the on-air tab cannot be closed`

### Task 4: Off air control (Home banner and Controls)

**Files:**
- Create: `src/renderer/src/components/OffAirButton.tsx`
- Modify: `src/renderer/src/components/Home.tsx` (on-air banner ~line 259; new prop `onOffAir(): void`)
- Modify: `src/renderer/src/components/Controls.tsx` (new props `onAir: boolean`, `airName: string`)
- Modify: `src/renderer/src/App.tsx` (pass `onOffAir={() => dispatch({ type: 'offAir' })}` to Home; `onAir`/`airName` to Controls)
- Modify: `src/renderer/src/styles/app.css`

**Interfaces:**
- Produces: `OffAirButton({ eventName: string, onConfirm(): void, testId: string })`. Click `Off air` → inline confirm (same pattern as `.canvas-confirm` in `CanvasPicker.tsx`: `role="alertdialog"` region replacing the button) with text `Take <eventName> off air? The output goes to STANDBY.`, buttons `Off air` (primary, `data-testid={testId + '-yes'}`) and `Cancel`. Esc or Cancel closes the confirm without dispatching; focus moves to the confirm's Cancel on open and back to the button on close. The confirm region has `data-no-shortcuts` so B/K/F keys do not fire inside it.

- [ ] **Step 1:** Load `impeccable`; follow `DESIGN.md` (accent is the only state colour; Off air is a secondary button, not red).
- [ ] **Step 2:** Build `OffAirButton`.
- [ ] **Step 3: Home**: render `<OffAirButton eventName={airName} onConfirm={p.onOffAir} testId="home-offair" />` in the `.onair` banner after Back to console. Note that Esc on Home is Back to console; while the confirm is open, Esc closes only the confirm (stop propagation).
- [ ] **Step 4: Controls**: when `onAir`, render `<OffAirButton eventName={airName} onConfirm={() => onAction({ type: 'offAir' })} testId="controls-offair" />` as its own row after the deck buttons. App passes `onAir={tally(program) !== 'idle'}` and the air event's name.
- [ ] **Step 5: Run** `npm run typecheck && npm test && npm run lint` → PASS.
- [ ] **Step 6: Commit** `feat: Off air control in Home and Controls`

### Task 5: E2E and PRODUCT.md

**Files:**
- Modify: `e2e/smoke.mjs` (or `e2e/layout.mjs` next to the tab tests ~line 987)
- Modify: `PRODUCT.md:54` and the panel-names line `PRODUCT.md:59`
- Modify: `docs/test-checklist.md` (one Windows check: Off air with a native PowerPoint deck and with a web deck live)

- [ ] **Step 1: E2E** `live tab and off air`: take a slide → the live `.otab[data-live]` has no `.x` button; focus it and press Delete → tab still there; open Home → `home-onair` visible; click `home-offair`, then `home-offair-yes` → `home-onair` gone, no `.otab[data-live]`, the tab now has an `.x` and closing it works. Second case: Cancel leaves the output live (state dump `shown` not null).
- [ ] **Step 2: Run** `xvfb-run -a -s '-screen 0 2560x1440x24' npm run test:e2e:all` → all suites PASS.
- [ ] **Step 3: PRODUCT.md** line 54: replace "closing the on-air event's tab ... leaves what is shown" with: the on-air event's tab cannot be closed (no ×, Delete ignored) and is reopened if missing; switching tabs or opening Home leaves the output as it is; Off air (Home banner and Controls, with a confirm) is the only way besides taking another event's slide, KV or Black to change the air state from there, and it returns the output to STANDBY (dated 2026-11-06, decided by the user). Add Off air to the panel-names line 59.
- [ ] **Step 4: Commit** `test: e2e for the live tab and Off air; docs`
