# Design, Layout and E2E Audit Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Run every implementer on model `sonnet`, effort `medium`. Escalate to `opus` when stuck or after a failed review. UI tasks load the `impeccable` skill first and read `DESIGN.md` and `PRODUCT.md`.

**Goal:** Fix what the 2026-11-05 audit found: e2e suites that cannot run or test stale UI, layouts that break at some window sizes, misleading copy, and places where the app drifts from `DESIGN.md` and the Rimo reference.

**Architecture:** No main-process or reducer change. Tasks 1 and 2 first make the tests trustworthy and add `e2e/layout.mjs`, a regression script that fails on today's layout bugs. Tasks 3 to 10 are renderer fixes that each turn part of that script green. Task 11 updates the docs. Task 12 waits for a user decision.

**Tech Stack:** Electron, React 19, TypeScript, plain CSS variables in `tokens.css` and `app.css`, Vitest (node env, no jsdom), Playwright driving Electron.

**Spec:** this plan, section Audit Findings. Rules come from `DESIGN.md`, `PRODUCT.md` and `.impeccable/surfaces/src-renderer-src-app-tsx.md`. Reference images: `design/original-*.webp` (PNG copies in `.superpowers/audit-2026-11-05/ref/`).

**Evidence:** `.superpowers/audit-2026-11-05/` (gitignored). `audit/`, `audit2/` and `audit3/` hold the screenshots, named `<state>__<theme>__<W>x<H>.png`, plus `results.json` from the DOM scanner. `audit.mjs` holds the scanner, `audit2.mjs` the seeding and the HDMI setup. If this folder is gone, Task 2 still has enough here to write the script.

## Global Constraints

- Do not touch product behaviour outside the task. Keyboard map, reducer, "never black, never desktop", output and Prepare black chrome stay as they are.
- CSS: read colours only from `tokens.css` variables. Radius only 3, 4, 6 or round. Control heights only 32, 40, 52. Type only 12, 14, 16 (24 only where already used). Gaps only 4, 8, 12, 16, 24.
- User-facing copy is English. No new state colour: errors and warnings are ink, weight and an icon.
- Tests are node-only, no jsdom. Logic that needs a test goes into a plain `.ts` module (pattern: `components/pdf-page.ts`). Pixel and layout behaviour is tested in `e2e/`.
- Commit with `git -c user.name="Gerson Sebastian" -c user.email="sebastiangerson24@gmail.com" commit ...`. Stage only your own files, never `git add -A`.
- The working tree holds the user's uncommitted work (`PRODUCT.md`, `src/main/index.ts`, `src/main/platform*.ts`, `src/renderer/src/model*.ts`, `design/*.webp`). Do not stage, revert or format these. They stay uncommitted on this branch.
- Lint has 8 known errors today (`scripts/*`, `program.test.ts`, `test/integration/libreoffice.test.ts`). Do not add any.
- After a task: `npm run typecheck`, `npm test`, and the e2e script the task names must pass.
- Headless e2e on this machine: `env -u WAYLAND_DISPLAY XDG_SESSION_TYPE=x11 xvfb-run -a -s '-screen 0 2560x1440x24' node e2e/<name>.mjs` until Task 1 is done, then without the `env` part.
- If a task fails more than 3 times, including after escalating to Opus, stop and report the task, file, command and error.

## Audit Findings

Severity: P0 blocks, P1 hurts during a show or breaks a rule, P2 looks untidy, P3 polish.

| # | Sev | Finding | Evidence | Task |
|---|-----|---------|----------|------|
| 1 | P1 | On a Wayland session `smoke`, `native`, `settings` and `network` die at launch: since commit 97b43ef the app relaunches on X11 and Playwright loses it. Only `web.mjs` passes the flag. | exit 1 in about 1 s, `<ws disconnected>` | 1 |
| 2 | P1 | `smoke.mjs` stops at check 28 of 253 on a stale check (it expects `img`, PDFs now play as vector `canvas`), so as committed it never reaches Freeze, Black, KV, video or restart. A private copy with soft checks reached 160 `ok`, with 2 failures that may be real. | see Task 1 | 1 |
| 3 | P1 | `native.mjs` looks for `complementary` named "Up next"; the panel is now `section[aria-label="Up next"]`. All 36 checks pass once that is changed. | `e2e/native.mjs:263` | 1 |
| 4 | P1 | Program column 460 to 506 px wide: the transport needs 506 px, the sound button is pushed out of view and the stage scrolls sideways. Happens at 1024 wide, and at any width once panels are dragged wider. The tight rule only starts at 459 px. | `12-console-live-info__light__1024x640.png`, `app.css:1723` | 3 |
| 5 | P1 | STANDBY monitor says "No slides yet / Drag .pptx..." when the deck has 12 slides. | `11-console-controls-open__dark__1440x900.png`, `Program.tsx:136` | 4 |
| 6 | P1 | Event tabs: `scrollbar-width: none`, no hint and no mouse way to reach hidden tabs. With OMT and NDI on at 1280 wide only 1.5 of 8 tabs show; even 1920 hides one. | `72-console-many-tabs__light__1280x720.png`, `app.css:107` | 8 |
| 7 | P1 | Decks footer eats the deck list: 325 of 588 px at 1024x640, room for about 3 rows. "Save imported PowerPoint files as" is a machine setting, not a show control, and is not in `DESIGN.md`. | `12-console-live-info__light__1024x640.png`, `Library.tsx:1422` | 6 |
| 8 | P1 | Deck row under Black or KV shows no state tag (`DESIGN.md` says it must) because `live` is null then. | `15-console-black-toast__dark__1024x640.png`, `App.tsx:1045` | 5 |
| 9 | P1 | Home: hero and guide push the event grid down to y=549 at every size; at 1366x768 no event name is visible without scrolling. With the on-air banner it is worse. | `03-home-grid__light__1366x768.png`, `20-home-onair__light__1024x640.png` | 9 |
| 10 | P2 | A long deck name cuts "/ Program" to "/ Progr..." or drops it; a short name centres. | `12-console-live-info__light__1440x900.png`, `app.css:1422` | 3 |
| 11 | P2 | Deck names cut hard ("Live P...", "Opening K...") because the tag shares their row. A web deck's LIVE tag wraps and clips. | `80-web-live__light__1024x640.png` | 5 |
| 12 | P2 | Missing-font warning row prints the whole font list and fills the deck list. | `78-violet-compare__light__1440x900.png` | 5 |
| 13 | P2 | Web deck reads as slides: "01 / 01", "1 slide", "Audience sees slide 1". | `80-web-live__light__1024x640.png`, `Program.tsx:302` | 4 |
| 14 | P2 | Text spills out of controls at 1024 wide: "LibreOffice (.odp)" 103/109, "Local device" 75/79, "Canvas" label 35/47 runs into its value. | `results.json`, `77-canvas-dialog.png` | 6, 7 |
| 15 | P2 | Canvas popover runs off the window bottom at 1024x640. Deck menu touches the bottom edge. | `77-canvas-dialog.png`, `76-deck-menu.png` | 7 |
| 16 | P2 | Prev/Next section and deck buttons wrap to uneven widths; dashed disabled borders add noise. Not in `DESIGN.md`. | `14-console-frozen__light__1280x720.png`, `Controls.tsx:46` | 7 |
| 17 | P2 | `.btn` uses `--edge` where `DESIGN.md` says labelled secondary buttons keep Line High, so every button looks heavy next to the reference. | `app.css:818` | 10 |
| 18 | P2 | Dialog primary is near-black `.btn.inverse`; Home primary is accent `.btn.primary`. | `75-add-web-dialog__light__1024x640.png` | 10 |
| 19 | P2 | Off-scale type: 13px seven times, 11px once (`app.css:2698`). | detector | 10 |
| 20 | P3 | After a mouse click, the next F or Space leaves a black focus ring on that control for the rest of the show. | `14-console-frozen__light__1280x720.png` | 10 |
| 21 | P3 | Section row is a heavy full-width band; default scrollbars look coarse beside the reference. | `11-console-controls-open__dark__1440x900.png` | 10 |
| 22 | P3 | Home holds at 1120 px and 3 columns even on 2560 wide. | `71-home-guide-hidden__dark__1920x1080.png` | 9 |
| 23 | P3 | `DESIGN.md` is out of date: min width 1180 (window is 1024), Add web page as a browser dialog, no Home hero or guide, no section and deck buttons. | `DESIGN.md:220,224,295` | 11 |

Checked and fine, keep working: page never scrolls at any of 10 sizes. Monitor stays 16:9. No black frame on vector PDF with Cut or Fade (canvas painted on every frame, HDMI and operator). Space still means Next after clicking any button, tab or segment. No console errors. Dark theme, violet accent and Prepare from 800x560 to 1920x1080 look right.

Not testable here: real PowerPoint and `native-real.mjs`, `packaged.mjs` (Windows only), a real second HDMI display, real OMT and NDI receivers.

## Library Docs

Checked in Context7 on 2026-11-05. Query the ID below before using a library's API, pinned to the installed version where one exists. This plan upgrades nothing.

| Package | Installed | Latest | Context7 ID |
|---------|-----------|--------|-------------|
| electron | 45.0.0 | 45.2.3 | `/websites/electronjs` (latest docs). No v45 snapshot exists, and the newest breaking-changes section it returned is 44.0. Treat `node_modules/electron/electron.d.ts` as the truth for 45. |
| playwright | 1.63.0 | 1.64.1 | `/microsoft/playwright/v1.63.0` |
| react, react-dom | 19.3.0 | 19.3.1 | `/websites/react_dev_reference` for API docs |
| vitest | 5.0.3 | 5.1.0 | `/vitest-dev/vitest/v5.0.3` |
| vite | 7.3.7 | 8.3.5 | `/vitejs/vite/v7.3.5` |
| electron-vite | 5.0.0 | 6.0.0 | `/alex8088/electron-vite-docs` |
| electron-builder | 26.15.3 | 26.18.0 | `/electron-userland/electron-builder/electron-builder_26.18.0` |
| pdfjs-dist | 6.4.299 | 6.5.438 | `/mozilla/pdf.js/v6.4.299` |
| koffi | 3.3.4 (pinned) | 3.3.6 | `/websites/koffi_dev` |
| @phosphor-icons/react | 2.1.10 | 2.1.10 | `/phosphor-icons/react/v2.1.10` |
| typescript | 5.9.3 | 7.0.2 | `/microsoft/typescript/v5.9.3` |
| eslint | 9.39.5 | 10.14.0 | `/eslint/eslint/v9.39.3` |
| prettier | 3.9.9 | 3.9.10 | `/prettier/prettier/3.9.10` |
| @vitejs/plugin-react | 5.2.0 | 6.2.1 | `/vitejs/vite-plugin-react/plugin-react_5.1.4` |
| pdf-lib | 1.17.1 | 1.17.1 | `/hopding/pdf-lib` |
| pptxgenjs | 4.0.1 | 4.0.1 | `/gitbrent/pptxgenjs` |
| tsx | 4.23.15 | 4.23.15 | `/privatenumber/tsx/v4.23.15` |
| @fontsource-variable/geist | 5.3.0 | 5.3.0 | `/fontsource/fontsource` |
| eslint-plugin-react | 7.37.5 | 7.37.5 | `/jsx-eslint/eslint-plugin-react` |
| eslint-plugin-react-refresh | 0.4.26 | 0.5.7 | `/arnaudbarre/eslint-plugin-react-refresh/v0.4.20` |

No Context7 entry was found for `@electron-toolkit/*` or `eslint-plugin-react-hooks`: read their README in `node_modules`. `@types/*` need no docs.

Facts from these docs that this plan relies on:
- Electron has defaulted to native Wayland in a Wayland session since 38. `--ozone-platform=x11` forces XWayland (Task 1).
- `minWidth` and `minHeight` are documented as constraining only the user, yet the Prepare window came out 800x560 when asked for 800x500 on xvfb. Task 2 must measure `innerWidth` and `innerHeight` and report the real size.
- Playwright `isDisabled` does not retry, and its docs warn it can flake. `toBeDisabled` needs `@playwright/test`, which this repo does not use, so poll with `waitForFunction` (Task 1).
- Playwright `waitFor` defaults to `visible` and has `attached` (Task 1). `_electron` is still marked experimental.
- `createPortal` moves only the DOM node: React events still bubble to the React parent (Task 7).
- Phosphor names end in `Icon`; the shorter names are deprecated. `CaretDownIcon` exists (Task 8).

## Review Focus

- A Program column dragged to any width from 420 to 1900 px: the sound button stays visible. Pinned in Task 2 by sweeping the splitter width.
- A deck with no slides yet, a deck with slides on standby, and no deck at all each need their own monitor card. Pinned in Task 4's unit test.
- Black and KV pressed while frozen, or with no slide shown: the deck row tag must follow the same precedence as the Program head. Pinned in Task 5's unit test.
- Eight open tabs with the live tab hidden: the overflow menu still lists and opens every tab, and the live tab stays marked. Pinned in Task 8's e2e.
- Home with zero events, some events, all steps done, and hidden: the guide must never trap the first run or return after being hidden. Pinned in Task 9's unit test.

---

### Task 1: Make every e2e suite run and test the current UI

**Files:**
- Create: `e2e/launch-args.mjs`
- Modify: `e2e/smoke.mjs`, `e2e/network.mjs`, `e2e/native.mjs`, `e2e/settings.mjs`, `e2e/web.mjs`, `package.json`, `CLAUDE.md`

**Interfaces:**
- Produces: `export const linuxArgs: string[]` in `e2e/launch-args.mjs`, equal to `['--ozone-platform=x11']` on Linux and `[]` elsewhere. Task 2 uses it.

- [ ] **Step 1: See the launch failure.** Run `xvfb-run -a -s '-screen 0 2560x1440x24' node e2e/settings.mjs` in a shell with `WAYLAND_DISPLAY` set. Expected: fails at launch with `<ws disconnected>`.
- [ ] **Step 2: Add `e2e/launch-args.mjs`.** Spread `linuxArgs` into `args` of every `electron.launch` in the five scripts, before `root`, and drop the inline copy in `web.mjs`.
- [ ] **Step 3: Fix the stale selectors.**
  - `native.mjs:263`: `win.locator('section[aria-label="Up next"]')`.
  - `smoke.mjs` `layerRecorder` (line 112): a layer counts as painted when its `img` is decoded, or its `canvas` has `width > 0`.
  - `smoke.mjs` after `check(true, 'PDF imported as a 3-slide deck')`: `.screen img` no longer exists for a PDF, which plays as vector. Set the deck to still images through `window.api.setDeckPlayback(eventId, deckId, 'images')` so the image checks stay meaningful. Add one new check that a vector PDF is on air: `.screen canvas` is visible.
  - `smoke.mjs:2702`: scope to `[data-testid=right-panel] [role=radio][aria-checked=true]`.
  - `smoke.mjs`, the noise deck wait (`.deck` with name `noise`, then `.meta`): the wait never resolves. Read what the row shows after import and wait on that.
  - `smoke.mjs`, the audio device wait: `getByTestId('audio-device').locator('option').nth(1)` waits for `visible`; an `<option>` is never visible. Use `state: 'attached'`.
- [ ] **Step 4: Debug the remaining smoke failures with superpowers:systematic-debugging.** Each is either a stale test or a real bug; find out which before changing anything, and fix a stale test here. A real bug gets reported, not fixed in this task.
  - `a hidden output window mutes its video` stops the run at `smoke.mjs:1812` (known red baseline; last state `ended: true, paused: true, muted: false`). Decide whether the video ending before the display is unplugged explains it.
  - `KV removed on air: KV button disabled` at `smoke.mjs:2617`. `isDisabled` does not retry and the button uses a real `disabled` attribute, so first replace the instant check with `win.waitForFunction` on the button's `disabled` state.
  - `unplugged: the hidden output's video is muted though the saved Mute is off`, right after that check. If this is real, sound can leak from a hidden output: report it to the user at once.
  - The `Event Kedua` tab click times out (tab not open, or closed by the 8-tab limit). It then fails `another event without an override uses the default canvas` (wanted `1920x1080`, last `3840x1080`), which may be the same cause.
  - After those, about 90 of the 253 `check(` calls have never run in this audit: the last private run reached 160 `ok`. Expect more stale checks, and treat each the same way.
- [ ] **Step 5: Add scripts to `package.json`.** `test:e2e:settings` and `test:e2e:layout` (builds first, as the others do), and `test:e2e:all` running smoke, network, web, native, settings and layout one after another.
- [ ] **Step 6: Run all five suites.** Run `npx electron-vite build`, then each script. Expected: each ends with exit 0, and smoke prints `SMOKE PASSED`.
- [ ] **Step 7: Update `CLAUDE.md`.** Remove "red at baseline" and "Lint has 7 known errors" if they are no longer true, and note that `linuxArgs` is required on Wayland sessions.
- [ ] **Step 8: Commit.** `test: e2e suites run on Wayland sessions and follow the current UI`

### Task 2: Layout regression script

**Files:**
- Create: `e2e/layout.mjs`

**Interfaces:**
- Consumes: `linuxArgs` from Task 1.
- Produces: `node e2e/layout.mjs`, printing `ok - ...` or `FAIL - ...` for every check, never stopping at the first, and exiting 1 if any failed. Later tasks run it. Named checks below are the contract.

- [ ] **Step 1: Write the script.** Launch with `PPT_SHARE_USER_DATA` in a temp dir and no `PPT_SKIP_HOME`. Seed with `fixtures/sample.pdf` through the real file input, renamed to `Opening Keynote: The Future of Regional Trade and Long Deck Names That Keep Going`, plus `fixtures/video-deck` and a local-server web deck (see `.superpowers/audit-2026-11-05/audit2.mjs`). Size the operator window with `BrowserWindow.setContentSize`, then read back `innerWidth` and `innerHeight` and fail the run if they differ from the asked size. Run on a screen larger than the biggest size, because a window as large as the xvfb screen comes out 1 px short: `xvfb-run -a -s '-screen 0 2640x1520x24'`. Selectors: `[data-testid=transport]`, `[data-testid=transport-mute]`, `.stage-col`, `.screen`, `.ptitle .where` and its `.sub`, `.deck .name`, the Library footer block that holds `[data-testid=kv-block]`.

Sizes: `1024x640, 1024x900, 1180x700, 1280x720, 1366x768, 1440x900, 1600x900, 1920x640, 1920x1080, 2560x1440`. In both themes, on air, check at every size:

```js
check('page does not scroll', html.scrollWidth <= innerWidth && html.scrollHeight <= innerHeight)
check('stage does not scroll sideways', stage.scrollWidth <= stage.clientWidth)
check('transport fits', transport.scrollWidth <= transport.clientWidth)
check('sound button in view', muteRect.right <= innerWidth && muteRect.left >= transportRect.left)
check('monitor is 16:9', Math.abs(w / h - 16 / 9) < 0.02)
check('program title keeps "/ Program"', subRect.right <= whereRect.right + 1 && subRect.width > 0)
check('no text spills from a control', spills('[role=radio], .seg button, .k').length === 0)
check('decks footer is compact', footerHeight <= 150)
check('deck name has its own row', deckNameRect.width >= 130)
```

Then these once each:

```js
// Splitter sweep: Program column at 420, 460, 480, 506, 520, 560 px, dragged as smoke.mjs does for 'narrow Program (420px)'.
check('sound button in view at Program <width>', ...)
// Standby with slides, then with an empty event.
check('standby card does not say No slides yet', !monitorText.includes('No slides yet'))
check('empty event says No slides yet', monitorText.includes('No slides yet'))
// Black, then KV.
check('deck row shows BLACK', tagText === 'BLACK')
check('deck row shows KV', tagText === 'KV')
// Web deck live.
check('web deck has no slide position', !transportText.includes('/ 01'))
check('web deck says page', metaText.includes('web page'))
// Open 9 events at 1280x720 with OMT and NDI on (PPT_OMT_FAKE=1, PPT_NDI_FAKE=1).
check('tab overflow menu lists every open tab', menuItems === 8)
check('tab overflow menu opens the tab', selectedTabName === 'Event 5')
// Home with 9 events and the guide not hidden, at 1366x768.
check('first event name is on screen', firstCardNameRect.bottom <= innerHeight)
// Popovers at 1024x640.
check('canvas dialog fits the window', rect.bottom <= innerHeight)
check('deck menu fits the window', rect.bottom <= innerHeight)
// Focus: click the Info tab, press F twice, then Tab.
check('no ring after click then key', outline === 'none')
check('ring back after Tab', outline !== 'none')
```

- [ ] **Step 2: Run it.** Run `npx electron-vite build && node e2e/layout.mjs`. Expected: exit 1. `page does not scroll` and `monitor is 16:9` are ok; `transport fits` at 1024, `standby card`, `deck row shows BLACK` and the others fixed by later tasks are FAIL. Paste the FAIL list into the task report.
- [ ] **Step 3: Commit.** `test: layout regression across window sizes (red until the audit fixes land)`

### Task 3: Transport and Program title never lose anything

**Files:**
- Modify: `src/renderer/src/styles/app.css:1422-1450`, `:1714-1735`

- [ ] **Step 1: Confirm red.** Run `node e2e/layout.mjs`. Expected: FAIL on `transport fits`, `sound button in view`, `stage does not scroll sideways`, `program title keeps "/ Program"`.
- [ ] **Step 2: Transport.** Change the tight rule at `app.css:1723` from `max-width: 459px` to `max-width: 519px`. Measure with the new rule; if the row still needs more than the column at 420 px, reduce `.tbtn.hold` padding within the scale, and do not remove a button.
- [ ] **Step 3: Title.** Make `.ptitle .where` a flex row for every state, not only `:has(.air)`: `.nm` is `flex: 0 1 auto; min-width: 0` with ellipsis, `.sub` is `flex: none; white-space: pre`. The whole title stays centred when it fits. Merge the `:has(.air)` rules that become duplicates and keep the rule that makes the air event's name give way first.
- [ ] **Step 4: Run.** Run `node e2e/layout.mjs` and `node e2e/smoke.mjs`. Expected: the four checks are ok, and smoke's `narrow Program (420px)` still passes.
- [ ] **Step 5: Commit.** `fix: transport and Program title fit at every column width`

### Task 4: Honest monitor and web deck copy

**Files:**
- Create: `src/renderer/src/components/program-copy.ts`, `src/renderer/src/components/program-copy.test.ts`
- Modify: `src/renderer/src/components/Program.tsx:136,298-312`, `src/renderer/src/components/TransportBar.tsx:55,68`, `src/renderer/src/components/Strip.tsx`

**Interfaces:**
- Produces:
  - `standbyCard(deck: DeckMeta | null, index: number, emptyHint: string): { title: string; sub?: string }`
  - `audienceNote(state: ProgramState, t: ReturnType<typeof tally>, isWeb: boolean): string`, moved from `Program.tsx`

- [ ] **Step 1: Write the failing tests.**

```ts
it('no deck: asks for files', () => expect(standbyCard(null, 0, 'Drag files')).toEqual({ title: 'No slides yet', sub: 'Drag files' }))
it('deck with no slides: asks for files', () => expect(standbyCard(deck(0), 0, 'Drag files').title).toBe('No slides yet'))
it('deck with slides: says what Next does', () => expect(standbyCard(deck(12), 2, 'x')).toEqual({ title: 'Standby', sub: 'Press Space to put slide 3 on air.' }))
it('web deck on standby', () => expect(standbyCard(webDeck(), 0, 'x')).toEqual({ title: 'Standby', sub: 'Press Space to put this page on air.' }))
it('web live', () => expect(audienceNote(s, 'live', true)).toBe('Audience sees the web page'))
it('web frozen', () => expect(audienceNote(s, 'frozen', true)).toBe('Audience sees the web page, held'))
it('slide live is unchanged', () => expect(audienceNote(s, 'live', false)).toBe('Audience sees slide 3'))
it('black ignores isWeb', () => expect(audienceNote(s, 'black', true)).toBe('Audience sees black'))
```

- [ ] **Step 2: Run to see them fail.** Run `npx vitest run src/renderer/src/components/program-copy.test.ts`. Expected: FAIL, module not found.
- [ ] **Step 3: Implement.** Write `program-copy.ts`, call both from `Program.tsx`, and use the deck in `Program.tsx` to pick `isWeb` (`deck.source === 'web'`). In `TransportBar.tsx` hide `.tpos` when the deck is web. In `Strip.tsx` replace the `1 slide` count with `Web page` for a web deck.
- [ ] **Step 4: Run.** Run `npm test` and `node e2e/layout.mjs`. Expected: tests pass; `standby card`, `empty event`, `web deck` checks ok.
- [ ] **Step 5: Commit.** `fix: the monitor and web decks say what is really happening`

### Task 5: Deck rows

**Files:**
- Create: `src/renderer/src/components/deck-row.ts`, `src/renderer/src/components/deck-row.test.ts`
- Modify: `src/renderer/src/components/Library.tsx:81,1108-1145,1178-1195`, `src/renderer/src/App.tsx:1045-1046`, `src/renderer/src/styles/app.css` (deck row rules)

**Interfaces:**
- Produces: `deckRowTag(deckId: string, shownDeckId: string | null, t: ReturnType<typeof tally>): 'live' | 'frozen' | 'black' | 'kv' | null`, returning `t` only when `deckId === shownDeckId`, and `null` for standby.
- `Library` gets the prop `airTag(deckId: string): 'live' | 'frozen' | 'black' | 'kv' | null`, replacing its use of `live` and `frozen` for the tag. `live` and `frozen` stay for the `Slide N of M` line.

- [ ] **Step 1: Write the failing tests.** One each: live on the shown deck, frozen, black, kv, a different deck gives null, standby gives null, and black with `shownDeckId` null gives null.
- [ ] **Step 2: Run to see them fail.** Run `npx vitest run src/renderer/src/components/deck-row.test.ts`. Expected: FAIL, module not found.
- [ ] **Step 3: Implement the tag.** Render `<StatusTag kind={tag} size="sm" />` for all four kinds. `StatusTag` already has them; check the word variant.
- [ ] **Step 4: Two-row layout.** Row 1 is the name alone at full width. Row 2 is the sub line (ellipsis, `min-width: 0`) on the left with the tag, web chip or count on the right. Row height stays as it is now. Remove the inline web-deck tag inside `.sub`.
- [ ] **Step 5: Warning row.** `.deck.err .msg` clamps to 3 lines (`-webkit-line-clamp: 3`). Put the full text in `title` on the message. Clicking still dismisses.
- [ ] **Step 6: Run.** Run `npm test`, `node e2e/layout.mjs`, `node e2e/smoke.mjs`. Expected: `deck row shows BLACK`, `deck row shows KV` and `deck name has its own row` are ok. Fix any smoke check that reads the old row markup.
- [ ] **Step 7: Commit.** `fix: deck rows show every on-air state and keep names readable`

### Task 6: Compact Decks footer, import format moves to Settings

**Files:**
- Modify: `src/renderer/src/components/Library.tsx:101,1400-1430`, `src/renderer/src/components/SettingsDialog.tsx`, `src/renderer/src/App.tsx:1057-1060`, `src/renderer/src/components/ImportFormat.tsx`, `src/renderer/src/styles/app.css`

- [ ] **Step 1: Confirm red.** Run `node e2e/layout.mjs`. Expected: FAIL on `decks footer is compact` and the "LibreOffice" spill.
- [ ] **Step 2: Move the setting.** Pass `importFormat` to `SettingsDialog` and render `ImportFormat` under a section head `Import` above This computer, with its existing hint. Remove it from `Library`. It keeps its existing condition (only when `App.tsx:1057` provides it).
- [ ] **Step 3: Footer.** One KV row: thumbnail, `Key visual (KV)` with `Shown with K`, and `Choose image` as `.btn.sm` on the right. Then `Add files` and `Web page` as `.btn.sm` in a `grid-template-columns: 1fr 1fr` row with `gap: 8px`. Inset stays 20px. The footer must be 150 px or less at every size. All `data-testid` values stay.
- [ ] **Step 4: Run.** Run `node e2e/layout.mjs`, `node e2e/smoke.mjs`, `node e2e/settings.mjs`. Expected: `decks footer is compact` is ok at all sizes and the suites pass.
- [ ] **Step 5: Commit.** `fix: Decks footer leaves room for decks; import format lives in Settings`

### Task 7: Right panel and popovers

**Files:**
- Create: `src/renderer/src/components/menuNav.test.ts`
- Modify: `src/renderer/src/components/Controls.tsx:40-60`, `src/renderer/src/components/EventCanvasDialog.tsx:72-100`, `src/renderer/src/components/SettingsDialog.tsx`, `src/renderer/src/components/menuNav.ts`, `src/renderer/src/styles/app.css:1826-1860,1899`, the deck menu positioning in `src/renderer/src/components/Library.tsx`

- [ ] **Step 1: Confirm red.** Run `node e2e/layout.mjs`. Expected: FAIL on `canvas dialog fits the window`, the "Local device" and "Canvas" spills.
- [ ] **Step 2: Section and deck buttons.** `.decks-nav` is `display: grid; grid-template-columns: 1fr 1fr; gap: 8px`, buttons fill their cell at 32 px. Make `.right` a size container (`container: right / inline-size`) and hide their key caps under 320 px. Disabled buttons in this block and `.btn:disabled`, `.tbtn:disabled` drop the dashed border: 1px solid `--line`, transparent fill, `--text-3` text, so state is still not colour alone.
- [ ] **Step 3: Rows.** Under 320 px the Canvas row stacks: label on its own line, then value and `Change`. `.seg button` padding goes down to `0 4px` under 320 px so "Local device" fits.
- [ ] **Step 4: Canvas dialog.** Render it through `createPortal` with the same centred scrim and classes as `AddWebDialog`, with `max-height: calc(100vh - 32px)` and an inner scroll. Keep `role="dialog"`, `data-no-shortcuts`, the testid and Escape.
- [ ] **Step 5: Deck menu.** `max-height: calc(100vh - 16px); overflow-y: auto`, and shift it up when it would pass the bottom edge. Put the position math in a pure `fitMenuTop(top: number, height: number, viewport: number): number` in `menuNav.ts` (8 px margin from the window edge) with a unit test in `menuNav.test.ts`: `fitMenuTop(155, 500, 640) === 132`, `fitMenuTop(100, 200, 640) === 100`, `fitMenuTop(10, 900, 640) === 8`.
- [ ] **Step 6: Settings head.** `SettingsDialog` head is `position: sticky; top: 0` so Close stays in view on a short window.
- [ ] **Step 7: Run.** Run `npm test`, `node e2e/layout.mjs`, `node e2e/smoke.mjs`, `node e2e/settings.mjs`. Expected: those checks are ok.
- [ ] **Step 8: Commit.** `fix: right panel rows and popovers fit small windows`

### Task 8: Header keeps every tab reachable

**Files:**
- Create: `src/renderer/src/components/tab-overflow.ts`, `src/renderer/src/components/tab-overflow.test.ts`
- Modify: `src/renderer/src/components/EventTabs.tsx`, `src/renderer/src/components/OutputMenu.tsx:51-65`, `src/renderer/src/components/Header.tsx:44-63`, `src/renderer/src/styles/app.css:77,107-125,507-511`

**Interfaces:**
- Produces: `hiddenTabs(tabs: {left: number; right: number}[], viewLeft: number, viewRight: number): number[]`, the indexes of tabs not fully inside the view.

- [ ] **Step 1: Write the failing test.** `hiddenTabs([{left:0,right:100},{left:100,right:200},{left:200,right:300}], 0, 150)` is `[1, 2]`. A view covering all gives `[]`. Exact fit counts as visible.
- [ ] **Step 2: Run to see it fail.** Run `npx vitest run src/renderer/src/components/tab-overflow.test.ts`. Expected: FAIL, module not found.
- [ ] **Step 3: Overflow menu.** In `EventTabs`, watch the list with `ResizeObserver` and `scroll`. When `hiddenTabs` is not empty, show a `CaretDownIcon` icon button (`aria-label="All open events"`, `aria-haspopup="menu"`, 32 px) before New. It opens a menu with the existing popover style listing every open tab with its state icon; choosing one calls `onSelect`. Keep the existing keyboard rules. A vertical wheel over the list scrolls it sideways.
- [ ] **Step 4: Room for tabs.** Change the `.canvas-tag` rule at `app.css:507` from `max-width: 1279px` to `1599px`. In `OutputMenu`, under 1600 px show only `OMT` and `NDI` with the icon and keep the full text in `title` and `aria-label`; the `.text` values from `src/shared/omt.ts` do not change. Use a CSS class on the word part, not a JS width check. `ThemeSwitch` shows icons only under 1440 px with `aria-label="Light"` and `aria-label="Dark"`. The brief keeps the Light/Dark switch in the header, so it stays.
- [ ] **Step 5: Run.** Run `npm test`, `node e2e/layout.mjs`, `node e2e/smoke.mjs`. Expected: `tab overflow menu` checks are ok.
- [ ] **Step 6: Commit.** `fix: every open event is reachable when the header runs out of room`

### Task 9: Home shows events first

**Files:**
- Modify: `src/renderer/src/tutorial.ts`, `src/renderer/src/tutorial.test.ts`, `src/renderer/src/components/GettingStarted.tsx`, `src/renderer/src/components/Home.tsx:229-236`, `src/renderer/src/styles/app.css:3074-3080,3246-3250,3437-3450,3521-3530`

**Interfaces:**
- Produces: `guideMode(steps: TutorialStep[], hidden: boolean, eventCount: number): 'full' | 'compact' | 'off'`.

- [ ] **Step 1: Write the failing tests.**

```ts
it('no events: full, even if hidden', () => expect(guideMode(steps(0), true, 0)).toBe('full'))
it('some events, not finished: compact', () => expect(guideMode(steps(2), false, 3)).toBe('compact'))
it('hidden stays off', () => expect(guideMode(steps(2), true, 3)).toBe('off'))
it('all done: off', () => expect(guideMode(steps(4), false, 3)).toBe('off'))
```

- [ ] **Step 2: Run to see them fail.** Run `npx vitest run src/renderer/src/tutorial.test.ts`. Expected: FAIL, `guideMode` is not a function.
- [ ] **Step 3: Implement.**
  - `full`: today's checklist.
  - `compact`: one 52 px row on Panel with a 1px ring: `Getting started`, `2 of 4 done`, `Next: <step title>`, then `Show steps` and `Hide` as `.btn.sm`. `Show steps` expands for this view only.
  - `off`: nothing on the page. `Show the guide again` becomes a quiet text button at the left of the Filter control in the tab row, shown only when the guide is hidden and not finished. Keep `guide-show` and `guide-hide` testids.
  - Hero: render only when there are no events. The header already carries the brand.
- [ ] **Step 4: Grid.** `.hwrap` `max-width: 1440px`. `.evgrid` `grid-template-columns: repeat(auto-fill, minmax(280px, 1fr))`, and remove the 1100 px media rule. Keep `.evgrid.list`.
- [ ] **Step 5: Run.** Run `npm test`, `node e2e/layout.mjs`, `node e2e/smoke.mjs`. Expected: `first event name is on screen` is ok; smoke's first-run checks still see the hero and the checklist.
- [ ] **Step 6: Commit.** `fix: Home shows events first and the guide stays out of the way`

### Task 10: Match DESIGN.md and calm the chrome

**Files:**
- Modify: `src/renderer/src/styles/app.css` (`:818`, `:1126-1145`, `:2698`, `:2790-2797`, the seven `13px` rules, new scrollbar and focus rules), `src/renderer/src/styles/tokens.css`, `src/renderer/src/components/AddWebDialog.tsx:205`, `src/renderer/src/components/NewEventDialog.tsx:159`, `src/renderer/src/main.tsx`

- [ ] **Step 1: Buttons.** `.btn` border becomes `--line-hi`. Hover goes to `--edge`. Inputs and `.tbtn.hold` keep `--edge`, as `DESIGN.md` says. Check with `impeccable detect` that nothing drops below 3:1 where it is needed: a labelled button's name carries its identity.
- [ ] **Step 2: Dialog primary.** Use `btn primary` in both dialogs and delete `.btn.inverse`.
- [ ] **Step 3: Type.** Each 13px becomes 12 or 14 by its role in `DESIGN.md` Typography. `.prepare-togglestate` 11px becomes 12px. Check Prepare at 800x560 after this.
- [ ] **Step 4: Section row.** `.section` loses its full-width top and bottom rules: an uppercase 12px label in `--text-3`, the name at 500, and one hairline under it only. Keep its drag and rename behaviour.
- [ ] **Step 5: Scrollbars.** Add `scrollbar-width: thin; scrollbar-color: var(--line-hi) transparent` on `.props`, `.thumbs`, `.home` and the deck list. Both themes.
- [ ] **Step 6: Focus ring.** In `main.tsx`, for the operator role only: `pointerdown` sets `document.documentElement.dataset.input = 'mouse'`, and a `Tab` keydown deletes it. CSS: `:root[data-input='mouse'] :focus-visible { outline: none }`, except `input`, `textarea` and `select`. Focus itself must not move: dialogs and the gear still need it.
- [ ] **Step 7: Run.** Run `npm test`, `node e2e/layout.mjs`, `node e2e/settings.mjs`, `node e2e/smoke.mjs`, then `impeccable detect --json src/renderer/src`. Expected: focus checks are ok and the detector no longer lists the 11px rule.
- [ ] **Step 8: Look.** Screenshot 1440x900 in both themes and compare with `.superpowers/audit-2026-11-05/ref/`. Fix what stands out within this task's scope.
- [ ] **Step 9: Commit.** `fix: buttons, type and scrollbars follow DESIGN.md`

### Task 11: Docs follow the app

**Files:**
- Modify: `DESIGN.md`, `.impeccable/surfaces/src-renderer-src-app-tsx.md`, `docs/test-checklist.md`

- [ ] **Step 1: Update `DESIGN.md`.** Minimum window 1024x640 with side columns 256 and 288 under 1180. Add web page is the small dialog, then Prepare. Decks footer as built. Section and deck buttons in the right panel. Disabled style without dashes. Home with a conditional hero and three guide modes. Event tab overflow menu. Grid auto-fill to 1440 px.
- [ ] **Step 2: Add to `docs/test-checklist.md`.** In Indonesian, field checks on Windows for the new header at 1366x768 with HDMI, OMT and NDI on, and the moved import format setting.
- [ ] **Step 3: Run all.** Run `npm run typecheck`, `npm test`, `npm run lint`, and `npm run test:e2e:all`. Expected: lint has no new errors and every suite exits 0, including `layout`.
- [ ] **Step 4: Commit.** `docs: DESIGN.md and the checklist follow the audit fixes`

### Task 12: Rimo density (run only after the user approves)

Do not start until the user answers: this changes rules the user pinned in `DESIGN.md` (control height 40, section head 16px).

**Files:**
- Modify: `src/renderer/src/styles/app.css`, `src/renderer/src/styles/tokens.css`, `src/renderer/src/panel-sections.ts` (`DEFAULT_OPEN`), `src/renderer/src/panel-sections.test.ts`, `DESIGN.md`

The reference fits 11 sections in one window height; with all sections open this panel is 2692 px tall.

- [ ] **Step 1: Test the new defaults.** In `panel-sections.test.ts`: on a fresh install, Transition is open; Deck settings, Output and Network are closed.
- [ ] **Step 2: Rows.** Rows in Controls become 32 px, with 12px labels in `--text-2`, section heads 14px at 600 and 40 px tall. The transport, Next and monitor do not change: those are pressed under pressure. Keep 40 px on any control used during a show.
- [ ] **Step 3: Run and look.** Run `npm test`, `node e2e/layout.mjs`, and screenshot 1440x900 next to `ref/ref3.png`.
- [ ] **Step 4: Update `DESIGN.md` scale and commit.** `feat: denser Controls panel after the Rimo reference`

### Task 13: Safe dependency upgrades

The user approved upgrades only if they are safe and break nothing. No major versions.

**Files:**
- Modify: `package.json`, `package-lock.json`, `CLAUDE.md` only if a version it names changes

- [ ] **Step 1: Record the baseline.** Run `npm outdated`, and confirm `npm run typecheck`, `npm test`, `npm run test:e2e:all` pass before any change.
- [ ] **Step 2: Upgrade in groups, in this order, one commit per group.** After each group run `npm run typecheck`, `npm test`, `npm run build`, and the suites named. If a group breaks anything and the cause is not a one-line fix, revert that group and record why.
  - Tooling: `prettier@3.9.10`, `vitest@5.1.0`, `electron-builder@26.18.0`. Suites: none beyond the three commands, plus `npx electron-builder --dir` for electron-builder.
  - `playwright@1.64.1`. Suites: `test:e2e:all`.
  - `react@19.3.1`, `react-dom@19.3.1`. Suites: `test:e2e:all`.
  - `pdfjs-dist@6.5.438`. Suites: smoke and layout. Vector PDF on air and PDF import must still work.
  - `electron@45.2.3`. Suites: `test:e2e:all`.
  - `koffi@3.3.6`, keeping the exact pin. Suites: network.
- [ ] **Step 3: Leave these alone.** vite 8, electron-vite 6, `@vitejs/plugin-react` 6, eslint 10, typescript 7, `@types/node` 26, `@electron-toolkit/eslint-config-ts` 4, `eslint-plugin-react-refresh` 0.5.
- [ ] **Step 4: Run all.** Run `npm run test:e2e:all`. Expected: every suite exits 0. Report each package's result: upgraded, or reverted with the reason. Note that Windows-only behaviour was not tested.
- [ ] **Step 5: Commit** per group: `chore: upgrade <packages> within the current range`

