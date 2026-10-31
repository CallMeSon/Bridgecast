# Operator Window Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. UI tasks load the `impeccable` skill, read `PRODUCT.md`, and follow the surface brief.

**Goal:** Restyle the operator window after the Rimo references: soft light and dark editor themes, rounded soft-app shapes, six selectable accent presets, and a Properties-style right panel.

**Architecture:** Visual change plus one regrouping of the right panel. Tokens move to accent-based names (`--accent*` replaces `--cue*`) in `tokens.css`; a pure module `appearance.ts` holds theme and accent logic so it is testable in the node-only Vitest. Panels get their rounded look in `app.css`. The right panel becomes five collapsible `PanelSection`s that reuse existing components and actions. No reducer, IPC or main-process change.

**Tech Stack:** React, TypeScript, plain CSS variables, Phosphor icons, Vitest (node env, no jsdom), Playwright e2e.

**Spec:** `.impeccable/surfaces/src-renderer-src-app-tsx.md` (the confirmed brief), `PRODUCT.md`, current `DESIGN.md` (replaced at the end, Task 8).

## Global Constraints

- Red means on air only (LIVE, FROZEN, BLACK, KV, on-air strip, monitor ring). Never accent, never error.
- Amber is removed. Next uses the accent: Next button, Up next ring, NEXT tag, Up next position. Next stays the largest filled control, keeps its key caps and the word "Next".
- State is never colour alone: tally words, On/Off beside switches, pressed inversion, check bar on the checked segment stay.
- Default theme follows the OS (`prefers-color-scheme`); the header toggle stays; an explicit choice is saved in localStorage like today.
- Accent presets, exactly six ids: `violet`, `blue`, `mint`, `rose`, `sand`, `slate`. Default `violet`. `rose` is a muted pink-mauve and `sand` a tan; both keep at least 40 degrees of hue distance from tally red (OKLCH hue). Saved per machine in localStorage key `accent`.
- WCAG 2.1 AA: text 4.5:1, control edges and rings 3:1, in both themes and all six accents.
- Colours only from CSS variables in `tokens.css`; no literal hex in component rules.
- Keyboard map, clicker behaviour, copy, tally words, container queries on the Program column, and "never black, never desktop" are untouched. Output window and Prepare window chrome stay black.
- Operator controls keep current large sizes (control deck 52px, Next 56px, inputs 34px).
- Windows ships; only Linux checks here. Do not add new lint errors (7 known). Prettier: no semicolons, single quotes, width 100.

## Review Focus

- OS theme changes while the app is open and no explicit choice is saved: the window follows it live. Test in Task 1.
- Corrupt or unknown `accent` or `theme` value in localStorage: falls back to `violet` and system. Test in Task 1.
- Accent chosen but theme switched: every accent passes contrast in both themes. Test in Task 1.
- Very long deck name, 100+ decks, 3-digit slide counts in the narrower rounded rows: text truncates, nothing overlaps. Check in Task 6 and 7.
- A collapsed right-panel section while a web deck goes to HOLD or Next changes: the Up next section never hides what Next will do (it is not collapsible). Check in Task 5.

## File Structure

- Create `src/renderer/src/appearance.ts` (+ `appearance.test.ts`): theme preference, accent presets and their token values, contrast math. Pure.
- Modify `src/renderer/src/theme.ts`: thin DOM and storage layer over `appearance.ts`.
- Modify `src/renderer/src/styles/tokens.css`: radii, shadows, themes, accent variables set from `[data-accent]`.
- Modify `src/renderer/src/styles/app.css`: all component rules, in tasks below.
- Create `src/renderer/src/components/PanelSection.tsx`: collapsible titled section.
- Create `src/renderer/src/components/DeckSettings.tsx`, `OutputStatus.tsx`: new right-panel sections reusing existing pieces.
- Create `src/renderer/src/components/AppearanceSection.tsx`: accent picker inside the output popover.
- Modify `Header.tsx`, `OutputMenu.tsx`, `Controls.tsx`, `NextPanel.tsx`, `Library.tsx`, `Strip.tsx`, `App.tsx`.

---

### Task 1: Appearance logic (theme preference and accent presets)

**Files:**
- Create: `src/renderer/src/appearance.ts`
- Test: `src/renderer/src/appearance.test.ts`
- Modify: `src/renderer/src/theme.ts`

**Interfaces:**
- Produces:
  - `type ThemePref = 'system' | 'light' | 'dark'`, `type Theme = 'light' | 'dark'`
  - `type AccentId = 'violet' | 'blue' | 'mint' | 'rose' | 'sand' | 'slate'`
  - `ACCENT_IDS: readonly AccentId[]` (in that order)
  - `parseThemePref(v: unknown): ThemePref` (unknown becomes `'system'`)
  - `parseAccent(v: unknown): AccentId` (unknown becomes `'violet'`)
  - `resolveTheme(pref: ThemePref, systemDark: boolean): Theme`
  - `ACCENTS: Record<AccentId, Record<Theme, { accent: string; ink: string; on: string; soft: string }>>` : `accent` fill, `ink` accent as text, `on` text on the fill, `soft` tinted selection fill
  - `contrast(fg: string, bg: string): number` (WCAG ratio from `#rrggbb`)
- `theme.ts` produces: `loadThemePref(): ThemePref`, `saveThemePref(p): void`, `loadAccent(): AccentId`, `saveAccent(a): void`, `applyAppearance(pref, accent): () => void` (sets `data-theme` and `data-accent` on `<html>`, subscribes to `matchMedia('(prefers-color-scheme: dark)')` while pref is `'system'`, returns the unsubscribe).

- [ ] **Step 1: Write the failing tests** in `appearance.test.ts`:
  - `parseThemePref('banana') === 'system'`, `parseThemePref('dark') === 'dark'`
  - `parseAccent(undefined) === 'violet'`, `parseAccent('rose') === 'rose'`
  - `resolveTheme('system', true) === 'dark'`, `resolveTheme('light', true) === 'light'`
  - `contrast('#000000', '#ffffff')` is 21 (toBeCloseTo)
  - for every id and both themes: `contrast(ink, panelOf(theme)) >= 4.5`, `contrast(on, accent) >= 4.5`, `contrast(accent, panelOf(theme)) >= 3` (the panel colours are exported constants `PANEL = { light: ..., dark: ... }` taken from `tokens.css` in Task 2)
  - `rose` and `sand` hue distance from tally red: export `hueOf(hex): number` (OKLCH degrees) and assert `>= 40` against both tally reds
- [ ] **Step 2: Run** `npx vitest run src/renderer/src/appearance.test.ts` and expect FAIL (module missing).
- [ ] **Step 3: Implement** `appearance.ts` as above. Pick the six presets soft but passing the contrast tests; the test is the gate, adjust values until it passes. Violet light fill about `#6d5ce8`, dark about `#9d8cff` (starting points, not binding).
- [ ] **Step 4: Rewrite `theme.ts`** over `appearance.ts`. Keep `applyTheme` and `loadTheme` out; update the three call sites (`App.tsx:51,68,614`, `main.tsx:10,22`) to the new functions. Storage access stays in try/catch. The first paint in `main.tsx` applies the saved preference before render.
- [ ] **Step 5: Run** `npm test` and `npm run typecheck`; expect PASS.
- [ ] **Step 6: Commit** `feat: appearance logic, system theme and six accent presets`.

### Task 2: Tokens and the shape language

**Files:**
- Modify: `src/renderer/src/styles/tokens.css`, `src/renderer/src/styles/app.css`
- Modify: `src/renderer/src/appearance.ts` (the `PANEL` constants must equal the new `--panel` values)

**Interfaces:**
- Consumes: `ACCENTS` values from Task 1.
- Produces CSS variables used by every later task: `--accent`, `--accent-ink`, `--accent-edge`, `--on-accent`, `--accent-soft`; radii `--r-sm: 6px`, `--r: 10px`, `--r-lg: 14px`, `--r-pill: 999px`; shadows `--shadow-1` (resting panel) and `--pop-shadow` (floating); surface steps `--bg`, `--panel`, `--raised`, `--raised-hi`, `--line`, `--line-hi`, `--edge`, `--text`, `--text-2`, `--text-3`. Names kept so existing rules still work.

- [ ] **Step 1:** Rewrite the light theme after Rimo images 3 and 4 (white panels on a cool-neutral soft grey ground, hairlines only where needed) and the dark theme after image 2 (near-black ground, slightly lifted panels). The "No Blue Rule" ends: neutrals may carry a faint cool tint. Keep `--tally*`, `--letterbox`, `--standby*`, `--black-tally-ink` meanings and values unless contrast fails.
- [ ] **Step 2:** Add `[data-accent='violet']` etc. blocks with `--accent*` per theme (selector `:root[data-theme='dark'][data-accent='rose']`), values generated from `ACCENTS`. Remove `--cue`, `--cue-ink`, `--cue-edge`, `--on-cue`.
- [ ] **Step 3:** Replace every `var(--cue*)` in `app.css` (8 places, see `grep -n "var(--cue" app.css`) and the class names tied to amber with the accent names. Replace literal `3px` radii and the `var(--r)` users sensibly: buttons and inputs `--r`, tags and key caps `--r-sm`, panels and popovers `--r-lg`, tallies and tags `--r-pill`. Square full-bleed header cells stay square.
- [ ] **Step 4:** `npm run typecheck && npm test`, then run the app (`npm run dev`) and confirm the window renders in both themes with no missing-variable fallbacks (`grep -n "var(--cue" src` returns nothing).
- [ ] **Step 5: Commit** `feat: soft tokens, accent variables and rounded shapes`.

### Task 3: Header, theme toggle and accent picker

**Files:**
- Modify: `Header.tsx`, `OutputMenu.tsx`, `App.tsx`, `app.css`
- Create: `components/AppearanceSection.tsx`

**Interfaces:**
- Consumes: `ThemePref`, `AccentId`, `ACCENT_IDS`, `ACCENTS` (Task 1).
- Produces: `AppearanceSection({ accent, onAccent }: { accent: AccentId; onAccent(a: AccentId): void })`.
- Header `ThemeToggle` props become `{ pref: ThemePref; onSet(p: ThemePref): void }`, three segments Auto, Light, Dark with `aria-pressed`, each with a text label or tooltip, not icon alone.

- [ ] **Step 1:** Header: rounded cells, soft grey ground, event name stays the only shrinking part. Theme toggle gets the third segment.
- [ ] **Step 2:** `AppearanceSection`: a radio group of six swatches, each with its name as text, checked one shown with a check mark and ring (not colour alone), arrow-key navigation via the existing `Segmented` or `menuNav` pattern. Placed as a new "Appearance" section in `OutputMenu`.
- [ ] **Step 3:** `App.tsx` holds `themePref` and `accent` state, calls `applyAppearance` in an effect, saves on change.
- [ ] **Step 4:** Verify: with Playwright or by hand on Linux, switch accent and theme, reload, and the choice persists; with pref Auto, emulating `prefers-color-scheme` flips the window.
- [ ] **Step 5: Commit** `feat: header redesign, auto theme and accent picker`.

### Task 4: Program monitor and control deck

**Files:**
- Modify: `Controls.tsx`, `Program.tsx`, `app.css`

**Interfaces:**
- Consumes: tokens from Task 2. Produces: nothing new; Transition remains in `Controls.tsx` until Task 5 moves it.

- [ ] **Step 1:** Program column: rounded monitor frame (`--r-lg`), `--shadow-1`, on-air ring stays 2px `--tally`; tally becomes a pill with the same words and icons.
- [ ] **Step 2:** Control deck: rounded raised buttons at the same heights; Next is the accent fill (`--accent`, `--on-accent`) at 56px, min width 176px, key caps and the word "Next" kept; hold buttons keep pressed inversion. Disabled Next loses its accent fill and keeps the dashed treatment. Keep the container-query breakpoints (880px, 700px).
- [ ] **Step 3:** Check all five tally states, disabled controls and the two-row layout under 700px at 1280 and 1920 wide.
- [ ] **Step 4: Commit** `feat: soft program monitor and control deck`.

### Task 5: Right panel as titled sections

**Files:**
- Create: `components/PanelSection.tsx`, `components/DeckSettings.tsx`, `components/OutputStatus.tsx`
- Modify: `NextPanel.tsx`, `Controls.tsx`, `Library.tsx`, `HdmiSection.tsx` and its siblings, `App.tsx`, `app.css`
- Test: `src/renderer/src/components/panel-sections.test.ts` (pure state helper)

**Interfaces:**
- Produces: `PanelSection({ id, title, defaultOpen, collapsible, children })`; open state per `id` kept by `loadOpenSections(): Record<string, boolean>` and `saveOpenSection(id, open)` in a new pure-plus-storage module `panel-sections.ts` (unknown storage becomes defaults).
- Section ids and order: `up-next` (not collapsible), `notes`, `transition`, `deck-settings`, `output`.

- [ ] **Step 1: Failing test** for `panel-sections.ts`: defaults when storage is empty or corrupt; `saveOpenSection` round-trips; `up-next` is always open. Run and see it fail, implement, see it pass.
- [ ] **Step 2:** `PanelSection`: a heading button with `aria-expanded`, a chevron, a `+`-style row feel after Rimo image 4; keyboard operable; the panel scrolls inside the window height.
- [ ] **Step 3:** Move the Transition control from `Controls.tsx` into the `transition` section together with the existing "Continue to next deck" switch from `NextPanel.tsx`; the control deck keeps Prev/Next, Freeze, KV and Black. Keep the `setTransition` and continue actions and the Cut/Fade behaviour exactly. Update the container-query deck grid, which loses a cell.
- [ ] **Step 4:** `DeckSettings`: for the deck at the operator position, show Display mode (Fit, Fill, Stretch), a Sound entry opening the existing `DeckSound` dialog, and the canvas override entry that opens `EventCanvasDialog`. Reuse the actions already wired from the deck menu in `Library.tsx` and `App.tsx:442`; do not duplicate logic, lift the handlers to props. The deck menu keeps its entries.
- [ ] **Step 5:** `OutputStatus`: one-line status rows for HDMI (display, on/off), OMT, NDI and the audio route, with the existing words and a button opening the output popover. Do not move the popover's controls.
- [ ] **Step 6:** Check: Up next never collapses; a web deck in HOLD still shows its copy in Up next; frozen state shows "Preview"; empty event shows sensible empty sections.
- [ ] **Step 7:** `npm test && npm run typecheck`. Commit `feat: properties-style right panel`.

### Task 6: Up next, Notes and the Decks panel

**Files:**
- Modify: `NextPanel.tsx`, `Library.tsx`, `Slide.tsx`, `app.css`

- [ ] **Step 1:** Up next card: rounded, accent ring 2px, NEXT tag pill in the accent, position in `--accent-ink` mono. EndCard and placeholder cards follow the theme.
- [ ] **Step 2:** Decks panel: rows become rounded list items with a soft selected fill (`--accent-soft` for the operator deck, raised for hover); the live deck keeps its "LIVE, slide 3" line in `--tally-ink`; importing progress, error row, reorder dashed target and rename editor keep their behaviour.
- [ ] **Step 3:** Long names (80 characters) truncate with an ellipsis; 100 decks scroll smoothly.
- [ ] **Step 4: Commit** `feat: soft up next card and decks list`.

### Task 7: Slide strip as timeline

**Files:**
- Modify: `Strip.tsx`, `Slide.tsx`, `app.css`

- [ ] **Step 1:** Strip: panel with a soft top edge, rounded 118px thumbnails, tags as pills. LIVE tag red filled; FROZEN red outlined; NEXT tag accent filled with `--on-accent`; operator position keeps its dashed outline. Overlay rings stay overlays so the slide box stays 16:9.
- [ ] **Step 2:** Legend swatches updated (Live red, Next accent).
- [ ] **Step 3:** Check a deck with 3-digit slide numbers and video marks.
- [ ] **Step 4: Commit** `feat: timeline-style slide strip`.

### Task 8: Verification and DESIGN.md

**Files:**
- Modify: `DESIGN.md`, `.impeccable/design.json` (via the documenter)
- Create: `.impeccable/review/*.png` (not committed)

- [ ] **Step 1:** `npm run typecheck && npm test && npm run lint` (no more than the 7 known errors). Run `xvfb-run -a -s '-screen 0 2560x1440x24' npm run test:e2e:web` and `npm run test:e2e:network`; `test:e2e` may stay red only on "a hidden output window mutes its video".
- [ ] **Step 2:** Capture the operator window in light and dark at 1280x800 and 1920x1080, with violet, mint and rose, in the states LIVE, FROZEN, BLACK, KV, STANDBY, web HOLD, importing, and empty event. Fix what the captures show in one batch.
- [ ] **Step 3:** Run `"/home/econ/.claude/plugins/cache/impeccable/impeccable/4.8.0/skills/impeccable/scripts/impeccable" detect --json src/renderer/src` once and fix mechanical findings.
- [ ] **Step 4:** Spawn the shipped `impeccable-finish-reviewer` with the brief, screenshots and detector output; apply its fixes in one batch.
- [ ] **Step 5:** Spawn `impeccable-documenter` to rewrite `DESIGN.md` from the built result (drops the 3px, no-shadow, no-blue and amber rules; adds accent presets, system theme, rounded shapes). Update `PRODUCT.md` "Panel and label names" if section names changed.
- [ ] **Step 6:** Add Windows-only checks (system theme follow, rendering at 125% and 150% scaling) to `docs/test-checklist.md`. Commit `docs: redesigned operator window, DESIGN.md and checklist`.
