# Operator Window Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. UI tasks load the `impeccable` skill, read `PRODUCT.md`, `DESIGN.md` and the surface brief, and compare against the mockup.

**Goal:** Rebuild the operator window as the flat docked editor in `mockups/operator-redesign/index.html`: soft light and dark themes, small radii, one accent state colour with six presets, a transport bar and timeline strip under the monitor, a tabbed right panel and a Settings dialog.

**Revision 2026-11-01:** the first version of this plan (2026-10-30) described a rounded soft-app with red on-air and an accent Next button. The user rejected rounded shapes and iterated the mockup; this plan follows the mockup, `DESIGN.md` (rewritten 2026-11-01) and the surface brief. Where the plan and the mockup disagree, the mockup wins; open the file in a browser and compare.

**Architecture:** Visual change plus a regrouping of controls. Tokens move to accent-based names in `tokens.css`; a pure module `appearance.ts` holds theme and accent logic so it is testable in the node-only Vitest. The control deck becomes a `TransportBar`; the strip becomes a timeline; the right panel becomes two tabs; Settings opens in a dialog. No reducer, IPC or main-process change, except where Task 4 names a setting that needs storage.

**Tech Stack:** React, TypeScript, plain CSS variables, Phosphor icons, Vitest (node env, no jsdom), Playwright e2e.

**Spec:** `mockups/operator-redesign/index.html` (visual source of truth), `DESIGN.md`, `.impeccable/surfaces/src-renderer-src-app-tsx.md` (brief), `PRODUCT.md`.

## Global Constraints

- One state colour: the accent. LIVE, FROZEN, BLACK and KV tags, the monitor ring, the live strip ring, pressed hold buttons, the current deck row and an on switch all use it. Red and amber are removed. `--tally`, `--tally-ink` and `--on-tally` stay as aliases of the accent so state rules keep their names.
- Fill = on air, outline = Next. NEXT is an outlined accent tag and a 45% accent ring (`--next-ring`). State is never colour alone: tag words and icons, On/Off beside switches, pressed tint with border, check on the chosen swatch.
- No dots beside status words. State tags for LIVE, FROZEN, BLACK and KV are icon-only (title and aria-label) only in the Program head and on strip thumbnails; deck rows and Home keep icon plus word; the event tab has no state tag; NEXT and STANDBY keep their word.
- Shape: radii 3 (`--r-sm`), 4 (`--r`), 6 (`--r-lg`) only; `--r-round` (999px) only for switches, sliders, progress bars and swatches. No pills for tabs or tags. No shadows except `--pop-shadow` (dialog, menus); resting rings use `--shadow-1` and `--shadow-0` (1px rings).
- One scale: control heights 32 / 40 / 52 (`--h-sm`, `--h-md`, `--h-lg`), panel inset 20 (`--pad`), gaps 4 / 8 / 12 / 16 / 24, type 12 / 14 / 16.
- Default theme follows the OS (`prefers-color-scheme`). The header has a Light/Dark switch (no Auto); Auto lives in Settings. An explicit choice is saved in localStorage.
- Accent presets, exactly five preset ids: `orange`, `violet`, `blue`, `rose`, `sand`, plus `custom` with a stored hex (`accent-custom`). Default `orange`. Saved per machine in localStorage key `accent`. Starting values are in the mockup `:root[data-theme][data-accent]` rules.
- WCAG 2.1 AA: text 4.5:1, control edges and rings 3:1, in both themes and every preset and any custom colour.
- Colours only from CSS variables in `tokens.css`; no literal hex in component rules (the demo slide art in the mockup is not part of the app).
- Keyboard map, clicker behaviour, copy, tally words, container queries on the Program column, and "never black, never desktop" are untouched. Output window and Prepare window chrome stay black. The Program monitor and letterboxes stay black.
- Windows ships; only Linux checks here. Do not add new lint errors (7 known). Prettier: no semicolons, single quotes, width 100.

## Review Focus

- OS theme changes while the app is open and no explicit choice is saved: the window follows it live. Test in Task 1.
- Corrupt or unknown `accent` or `theme` value in localStorage: falls back to `orange` and system. Test in Task 1.
- Every accent passes contrast in both themes, including the filled tag text (`--on-accent` on `--accent`) and the accent ink on the panel. Test in Task 1.
- Transport bar stays one row from 1180px window width (Program column about 540px): key caps hide under 560px, nothing wraps.
- A very long deck or event name with a LIVE, FROZEN, BLACK or KV tag: the name truncates, the tag never does.
- A collapsed right-panel section while a web deck goes to HOLD or Next changes: Up next lives in the Info tab and is never collapsible, so it never hides what Next will do.
- Freeze is disabled in STANDBY; Freeze, KV and Black pressed states match the output state after a reload of the renderer.

## File Structure

- Create `src/renderer/src/appearance.ts` (+ `appearance.test.ts`): theme preference, accent presets and token values, contrast math. Pure.
- Modify `src/renderer/src/theme.ts`: thin DOM and storage layer over `appearance.ts`.
- Modify `src/renderer/src/styles/tokens.css`: scale tokens, themes, accent variables from `[data-accent]`.
- Modify `src/renderer/src/styles/app.css`: component rules, in the tasks below.
- Create `components/StatusTag.tsx`: the one tag component (LIVE, FROZEN, BLACK, KV, NEXT, STANDBY) with icon.
- Create `components/SettingsDialog.tsx`, `components/AppearanceSection.tsx`.
- Create `components/TransportBar.tsx` (replaces the large control deck in `Controls.tsx`).
- Create `components/PanelSection.tsx`, `components/DeckSettings.tsx`, `components/OutputStatus.tsx`, `panel-sections.ts` (+ test).
- Modify `Header.tsx`, `Program.tsx`, `Controls.tsx`, `NextPanel.tsx`, `Library.tsx`, `Strip.tsx`, `OutputMenu.tsx`, `Home` view files, `App.tsx`.

---

### Task 1: Appearance logic (theme preference and accent presets)

**Files:**
- Create: `src/renderer/src/appearance.ts`
- Test: `src/renderer/src/appearance.test.ts`
- Modify: `src/renderer/src/theme.ts`

**Interfaces:**
- Produces:
  - `type ThemePref = 'system' | 'light' | 'dark'`, `type Theme = 'light' | 'dark'`
  - `type AccentId = 'orange' | 'violet' | 'blue' | 'rose' | 'sand' | 'custom'`
  - `ACCENT_IDS: readonly AccentId[]` (in that order)
  - `parseThemePref(v: unknown): ThemePref` (unknown becomes `'system'`)
  - `parseAccent(v: unknown): AccentId` (unknown becomes `'orange'`)
  - `resolveTheme(pref: ThemePref, systemDark: boolean): Theme`
  - `ACCENTS: Record<AccentId, Record<Theme, { accent: string; fill: string; ink: string; on: string }>>` : `accent` for rings and tints, `fill` the surface behind text or a knob (often equal to `accent`), `ink` accent as text, `on` text on `fill`
  - `contrast(fg: string, bg: string): number` (WCAG ratio from `#rrggbb`)
- `theme.ts` produces: `loadThemePref(): ThemePref`, `saveThemePref(p): void`, `loadAccent(): AccentId`, `saveAccent(a): void`, `applyAppearance(pref, accent): () => void` (sets `data-theme` and `data-accent` on `<html>`, subscribes to `matchMedia('(prefers-color-scheme: dark)')` while pref is `'system'`, returns the unsubscribe).

- [ ] **Step 1: Write the failing tests** in `appearance.test.ts`:
  - `parseThemePref('banana') === 'system'`, `parseThemePref('dark') === 'dark'`
  - `parseAccent(undefined) === 'orange'`, `parseAccent('rose') === 'rose'`
  - `resolveTheme('system', true) === 'dark'`, `resolveTheme('light', true) === 'light'`
  - `contrast('#000000', '#ffffff')` is 21 (toBeCloseTo)
  - for every id and both themes: `contrast(ink, panelOf(theme)) >= 4.5`, `contrast(on, fill) >= 4.5`, `contrast(accent, panelOf(theme)) >= 3` (exported `PANEL = { light: '#ffffff', dark: '#17181d' }`, equal to `--panel` in `tokens.css`)
- [ ] **Step 2: Run** `npx vitest run src/renderer/src/appearance.test.ts` and expect FAIL (module missing).
- [ ] **Step 3: Implement** `appearance.ts` as above, starting from the mockup values (orange `#f26f1c` in both themes, plus `--accent-fill` `#c84f0c` in light with white `on` text (white on `#f26f1c` is only 3.0:1), and dark `on` `#1a0a00`, ink `#a8480a`, on `#2b1303`; dark ink `#ff9d5e`, on `#2a1405`; the on-accent text is dark on orange). The test is the gate; adjust values until it passes and update the mockup if a value changes.
- [ ] **Step 4: Rewrite `theme.ts`** over `appearance.ts`. Keep `applyTheme` and `loadTheme` out; update the call sites (`App.tsx`, `main.tsx`) to the new functions. Storage access stays in try/catch. The first paint in `main.tsx` applies the saved preference before render.
- [ ] **Step 5: Run** `npm test` and `npm run typecheck`; expect PASS.
- [ ] **Step 6: Commit** `feat: appearance logic, system theme and five accent presets and a custom colour`.

### Task 2: Tokens and the shape scale

**Files:**
- Modify: `src/renderer/src/styles/tokens.css`, `src/renderer/src/styles/app.css`
- Modify: `src/renderer/src/appearance.ts` (the `PANEL` constants must equal the new `--panel` values)

**Interfaces:**
- Consumes: `ACCENTS` values from Task 1.
- Produces CSS variables used by every later task: `--accent`, `--accent-ink`, `--on-accent`, `--accent-soft`, `--accent-soft-hi`, `--next-ring`; aliases `--tally`, `--tally-ink`, `--on-tally`; radii `--r-sm: 3px`, `--r: 4px`, `--r-lg: 6px`, `--r-round: 999px`; heights `--h-sm: 32px`, `--h-md: 40px`, `--h-lg: 52px`; `--pad: 20px`; rings `--shadow-1`, `--shadow-0`; `--pop-shadow`; surface steps `--bg`, `--panel`, `--raised`, `--raised-hi`, `--line`, `--line-hi`, `--edge`, `--text`, `--text-2`, `--text-3`. Names kept so existing rules still work.

- [ ] **Step 1:** Copy the light and dark neutral values and the scale tokens from the mockup `:root` blocks into `tokens.css`.
- [ ] **Step 2:** Add `:root[data-theme='dark'][data-accent='rose']`-style blocks for all five presets; `custom` is derived at runtime by a pure `deriveAccent(hex, theme)` that returns `{ accent, fill, ink, on }` meeting the same ratios (test it with yellow, navy, teal, near-white and near-black) and both themes, plus the alias line (`--tally: var(--accent)` and the rest). Remove `--cue`, `--cue-ink`, `--cue-edge`, `--on-cue`, the red `--tally` values and `--black-tally-ink`.
- [ ] **Step 3:** Replace every `var(--cue*)` in `app.css` and the classes tied to amber with the accent names. Apply the scale: buttons, tabs, inputs and rows `--r`; key caps, thumbnails and tags `--r-sm`; Home cards, the search field and the dialog `--r-lg`. Remove panel shadows and card gaps in the shell.
- [ ] **Step 4:** `npm run typecheck && npm test`, then run the app (`npm run dev`) and confirm both themes render with no missing-variable fallbacks (`grep -rn "var(--cue" src` returns nothing).
- [ ] **Step 5: Commit** `feat: flat tokens, accent variables and the shape scale`.

### Task 3: Shell, header and status tags

**Files:**
- Modify: `Header.tsx`, `App.tsx`, `app.css`, the Home view files
- Create: `components/StatusTag.tsx`

**Interfaces:**
- Produces: `StatusTag({ kind, size }: { kind: 'live' | 'frozen' | 'black' | 'kv' | 'next' | 'standby'; size?: 'md' | 'sm' })`. `live`, `frozen` and the rest are accent-filled (frozen is an outline); add a `variant: 'icon' | 'word'` prop: `icon` (Program head, strip) shows only the icon (broadcast waves, snowflake, eye-slash, image) with `title` and `aria-label`, `word` (deck row, Home) shows icon plus word; `next` is outlined with an arrow and the word; `standby` is a neutral outline with the word.
- Header: `ThemeSwitch` props `{ theme: Theme; onSet(t: Theme): void }` with two segments (Light, Dark, each with icon and label) and a Settings gear button `{ onOpen(): void }`.

- [ ] **Step 1:** Rebuild the shell to the mockup: a 52px header bar with a bottom rule, then the main area as three columns with no gaps and 1px rules. Header: brand, Home, event tabs (32px, 4px radius, selected = Raised High), New; right side Light/Dark switch and the gear. Only the event tabs shrink.
- [ ] **Step 2:** `StatusTag` and its tests-by-eye in the Program head, the live deck row (replaces the count), the live event tab and the live event card on Home. Remove the dots and the red "LIVE, slide 3" status line; the deck sub line becomes `Slide 3 of 12`.
- [ ] **Step 3:** Restyle Home (chips, search, three actions, Recent/All/Archive, grid and list) to the mockup. The live event card shows the LIVE tag.
- [ ] **Step 4:** Check long names with tags at 1180px: the name truncates and the tag stays.
- [ ] **Step 5: Commit** `feat: flat shell, header and status tags`.

### Task 4: Settings dialog

**Files:**
- Create: `components/SettingsDialog.tsx`, `components/AppearanceSection.tsx`
- Modify: `App.tsx`, `OutputMenu.tsx`, `app.css`

**Interfaces:**
- Consumes: `ThemePref`, `AccentId`, `ACCENT_IDS`, `ACCENTS` (Task 1).
- Produces: `SettingsDialog({ open, onClose, themePref, onThemePref, accent, onAccent }: ...)`, a modal `role="dialog"` `aria-modal`, 560px, closing on the close button, a click on the scrim and Escape; focus moves to the close button on open and returns to the gear on close.
- `AppearanceSection`: Theme (Auto, Light, Dark; `aria-pressed`, with the note "Auto follows Windows."), Accent (a radio group of six swatches in a 3×2 grid, name as text, a check mark and ring on the checked one, arrow keys), Reduce motion switch.

- [ ] **Step 1:** Build the dialog with the Appearance section first; remove the accent picker from the output popover (it never shipped, so nothing to migrate). The header Light/Dark switch and the dialog's Theme control read and write the same state.
- [ ] **Step 2:** Add the other sections only for settings that exist or are backed by a stored value in this task: Default transition for new decks (if the library already has a default), This computer (default canvas: reuse the existing canvas dialog; source name: reuse the network setting), About (version from `app.getVersion`). Settings that have no feature yet (open the last event on start, ask before closing an on-air event, keyboard shortcuts off, data folder, update check) are listed in the brief as proposals; build each only after the user confirms it, with its own small plan. Do not ship a control that does nothing.
- [ ] **Step 3:** Reduce motion: a stored boolean that adds `data-reduce-motion` on `<html>` and turns off the decorative transitions (switch knob, chevron, card ring). It never affects the operator's Fade.
- [ ] **Step 4:** Verify by hand and with Playwright: open, change accent and theme, close with Escape, reload, the choice persists; Tab stays inside the dialog while it is open.
- [ ] **Step 5: Commit** `feat: settings dialog with appearance`.

### Task 5: Program column and transport bar

**Files:**
- Create: `components/TransportBar.tsx`
- Modify: `Controls.tsx`, `Program.tsx`, `app.css`

**Interfaces:**
- Consumes: tokens from Task 2, `StatusTag` (Task 3).
- Produces: `TransportBar` with the same actions that `Controls.tsx` dispatches today (prev, next, freeze, kv, black) and the position text `03 / 12`. Transition moves out (Task 6).

- [ ] **Step 1:** Program column rows: title row 56px, centred (`StatusTag`, deck name, grey "/ Program"), the monitor with the 4px radius and a 1px ring that becomes a 2px accent ring when anything is on air, a 40px meta line (canvas size, transition, one sentence), the transport bar (56px, panel, top rule), then the strip (Task 7).
- [ ] **Step 2:** `TransportBar`: Prev and Next as 32px icon buttons with the position between them, a seam, then Freeze, KV and Black as hold buttons with key caps, then a flexible gap and a sound icon button. Hold button states: default, hover, active, pressed (accent tint, accent border, accent ink, no dot), disabled (dashed border; Freeze is disabled in STANDBY). Next keeps its tooltip "Next (Space or →)" and an accessible name. Remove the 52px and 56px control deck rules and the amber Next.
- [ ] **Step 3:** The sound icon: decide with the user whether it mutes the output or opens Controls > Output. Until then it is hidden (the mockup shows it as a placeholder).
- [ ] **Step 4:** Container query on the Program column: key caps hide under 560px; the row never wraps at 1180px window width. Check all five states, disabled hold buttons and both themes with orange, violet and rose.
- [ ] **Step 5: Commit** `feat: transport bar under the monitor`.

### Task 6: Right panel tabs and sections

**Files:**
- Create: `components/PanelSection.tsx`, `components/DeckSettings.tsx`, `components/OutputStatus.tsx`, `panel-sections.ts`
- Modify: `NextPanel.tsx`, `Controls.tsx`, `Library.tsx`, `OutputMenu.tsx`, `App.tsx`, `app.css`
- Test: `src/renderer/src/panel-sections.test.ts`

**Interfaces:**
- Produces: `PanelSection({ id, title, defaultOpen, children })`; open state per `id` kept by `loadOpenSections(): Record<string, boolean>` and `saveOpenSection(id, open)` in `panel-sections.ts` (unknown storage becomes defaults).
- Tabs: `info` (Up next, Notes) and `controls` (sections `transition`, `deck-settings`, `output`, `network`).

- [ ] **Step 1: Failing test** for `panel-sections.ts`: defaults when storage is empty or corrupt; `saveOpenSection` round-trips. Run, see it fail, implement, see it pass.
- [ ] **Step 2:** Underlined tabs Info and Controls (48px, 2px accent bar under the selected one, ARIA tabs with arrow keys). The selected tab is saved.
- [ ] **Step 3:** Info tab: Up next card (16:9, 2px accent ring, 4px radius, outlined NEXT tag with arrow, title, position in accent-ink mono, one sentence on what Next does), "Preview" while frozen, then Notes (a collapsible `PanelSection`, 16px text). Up next is never collapsible.
- [ ] **Step 4:** Controls tab: move Transition and "Continue to next deck" out of `Controls.tsx` and `NextPanel.tsx` into the `transition` section with the existing `setTransition` and continue actions unchanged. `DeckSettings` shows Display mode (Fit, Fill, Stretch), Sound and the canvas override entry for the deck at the operator position, reusing the handlers the deck menu already uses (lift them to props, no duplicated logic; the deck menu keeps its entries). `OutputStatus`: HDMI display and on/off, sound route, master volume and mute in the `output` section; OMT, NDI, frame rate and source name in `network` (collapsed by default), reusing the existing controls and their restart warning.
- [ ] **Step 5:** Check: a web deck in HOLD still shows its copy in Up next; frozen shows "Preview"; an empty event shows sensible empty sections; the panel scrolls inside the window height.
- [ ] **Step 6:** `npm test && npm run typecheck`. Commit `feat: tabbed right panel`.

### Task 7: Decks panel and slide strip as timeline

**Files:**
- Modify: `Library.tsx`, `Strip.tsx`, `Slide.tsx`, `app.css`

- [ ] **Step 1:** Decks panel: 56px head (title, count, add), rows with a 40px tile, name at 550 and sub line, the current row in `--accent-soft`, the live row showing its `StatusTag` where the count was. Importing progress (4px round bar), error row, reorder target and rename editor keep their behaviour. The footer holds the Key visual block and Add files.
- [ ] **Step 2:** Strip: a thumbnail row on top (fixed 140px, 8px gap, 3px radius, 1px Line High overlay ring, the slide number inside the thumbnail bottom-left in a dark chip, the tag top-right) and a 48px bar below with deck name, slide count, legend (filled swatch "Live on Program", pale swatch "Next"). There is no zoom slider. LIVE and FROZEN get a 2px accent ring; NEXT a 2px `--next-ring`; the operator position (off air) a 1.5px Ink 2 ring. Overlay rings stay overlays so the slide box stays 16:9.
- [ ] **Step 3:** Check long names (80 characters), 100+ decks, 3-digit slide numbers, and video marks.
- [ ] **Step 4: Commit** `feat: soft decks list and timeline strip`.

### Task 8: Verification and documentation

**Files:**
- Modify: `.impeccable/design.json` (via the documenter), `docs/test-checklist.md`
- Create: `.impeccable/review/*.png` (not committed)

- [ ] **Step 1:** `npm run typecheck && npm test && npm run lint` (no more than the 7 known errors). Run `xvfb-run -a -s '-screen 0 2560x1440x24' npm run test:e2e:web` and `npm run test:e2e:network`; `test:e2e` may stay red only on "a hidden output window mutes its video". Update e2e selectors that point at the old control deck or the amber Next.
- [ ] **Step 2:** Capture the operator window in light and dark at 1280x800 and 1920x1080, with orange, violet and rose, in the states LIVE, FROZEN, BLACK, KV, STANDBY, web HOLD, importing and empty event, and the Settings dialog and Home. Compare each against the mockup and fix what the captures show in one batch.
- [ ] **Step 3:** Run the impeccable `detect --json src/renderer/src` once and fix mechanical findings. The `cramped-padding` rule is ignored for the mockup file only (user confirmed 2026-11-01); do not add a wider ignore.
- [ ] **Step 4:** Spawn the shipped `impeccable-finish-reviewer` with the brief, screenshots and detector output; apply its fixes in one batch.
- [ ] **Step 5:** Spawn `impeccable-documenter` to regenerate the sidecar `.impeccable/design.json` from the built result (DESIGN.md is already rewritten; the sidecar is still the old graphite system). Update `PRODUCT.md` panel and label names if section names changed (Info, Controls, Settings).
- [ ] **Step 6:** Add Windows-only checks (system theme follow, rendering at 125% and 150% scaling, transport bar at 1180px) to `docs/test-checklist.md`. Commit `docs: redesigned operator window, design system and checklist`.
