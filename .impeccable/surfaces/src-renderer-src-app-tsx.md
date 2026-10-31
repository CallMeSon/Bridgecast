---
version: 2
slug: "src-renderer-src-app-tsx"
primary_target: "src/renderer/src/App.tsx"
related_targets: ["mockups/operator-redesign/index.html"]
---

# Operator window redesign (Operate mode, code-led)

Confirmed 2026-10-30, iterated with the user on 2026-10-31 through the mockup `mockups/operator-redesign/index.html` (the mockup is the visual source of truth; this brief and DESIGN.md are written from it). Direction pinned by user: Rimo video-editor references (soft light and dark editor, flat docked layout, properties sidebar). The first "rounded soft-app" reading was rejected: the user wants small radii and no floating cards. No direction roll.

## Job
Operator keeps the right slide on air in a dim venue, under pressure; expert or first-time. One glance: what the audience sees, what Next does.

## Direction
- **Layout:** flat and docked, no gaps between panels, 1px rules. Header bar 52px. Three columns: Decks 288px, Program fluid, right panel 352px. Everything the operator presses sits under the monitor in the Program column.
- **Decks sidebar:** one list per event holds slide decks and web pages together. The head `+` opens an add menu (Add files, Add web page, Add section); the footer has Add files and Web page buttons; Home has the same Add web page action. Decks show a preview of their first slide; web pages and importing decks keep an icon. Add web page reuses the real `AddWebDialog` (Web address, Name optional).
- **Program column, top to bottom:** title row centred (state tag, deck name, grey "/ Program"), the monitor, one meta line, ONE slim transport bar (Prev, position `03 / 12`, Next, then Freeze, KV and Black as real buttons with key caps, sound icon at the right), the slide strip as a timeline. The old two-row large control deck and the amber Next button are gone.
- **Strip (after Canva):** thumbnails on top with the slide number inside each thumbnail, tags on its top-right corner, a bar below with deck name, slide count and legend. No zoom slider (removed 2026-11-01 as useless).
- **Right panel:** underlined tabs Info and Controls. Info = Up next (Preview while frozen, not collapsible) and Notes. Controls = collapsible sections Transition (+ Continue to next deck), Deck settings (Display mode, Sound, canvas), Output (HDMI, sound route, master volume, mute), Network (OMT, NDI, frame rate, source name).
- **Header:** brand, Home, open-event tabs, New. Right side: a Light/Dark switch and a Settings gear. No Auto button in the header.
- **Settings dialog** (gear, centred 560px): Appearance (Theme Auto/Light/Dark, five accent presets plus a custom colour picker, Reduce motion), General (open last event, confirm closing an on-air event, keyboard shortcuts, default transition), This computer (default canvas, source name, data folder), About (version, updates). The accent picker leaves the right panel and the output popover.
- **Home** keeps the redesigned event browser (filters, search, actions, grid or list).
- **Scale audit (2026-11-01):** radii are only 3, 4, 6 (and round); control heights 32/40/52; gaps and padding on 4/8/12/16/20/24; weights 400/500/600/700; line heights 1.5 reading, 1.3 rows, 1 tags; light-theme text contrast is checked on every state and accent.
- **Shape:** three radii only (3, 4, 6px); round only for switches, sliders, progress and swatches; no pills for tabs or tags; no shadows except the dialog and menus.
- **Scale:** control heights 32 / 40 / 52, panel inset 20, gaps 4 / 8 / 12 / 16 / 24, type 12 / 14 / 16.
- **Themes:** default follows the OS; the header switch overrides with Light or Dark; Auto lives in Settings.
- **Accent, the only state colour:** five presets (soft orange default, violet, blue, rose, sand) plus Custom (native colour picker; the app derives ring, ink and fill colours so contrast stays AA in both themes), saved per machine. LIVE, FROZEN, BLACK, KV, the monitor ring, the live strip ring, pressed hold buttons, the current deck and the switch that is on all use it.
- **Signals:** red and amber are removed. Filled accent tag or solid ring = on air. Outlined tag or a 45% ring = Next. Pressed hold button = accent-tinted fill with accent border and ink. STANDBY = neutral outline. No dots beside status words. LIVE, FROZEN, BLACK and KV tags are icon-only (broadcast, snowflake, eye-slash, image, with title and aria-label) only in the Program head and on strip thumbnails; deck rows and Home keep icon plus word, the event tab has no state tag; NEXT and STANDBY always keep their word. State is never colour alone.

## Untouched
Keyboard map (Space and arrows for Next/Prev, F, K, B), clicker, terms and tally words, "never black, never desktop", output and Prepare windows (black chrome), features, English copy. The Program monitor and letterboxes stay black.

## States
LIVE, FROZEN, BLACK, KV, STANDBY (Freeze disabled in STANDBY); web chips Loading, Ready, Error, HOLD; importing; empty event; no HDMI; disabled; long deck names and event names (truncated, the tag stays visible); both themes x six accents; Home with and without something on air.

## Constraints
WCAG 2.1 AA (text 4.5:1, control edges and rings 3:1) in both themes and every accent and any custom colour. Container queries on the Program column (key caps hide under 560px). CSS variables in `tokens.css` only. Windows ships (Linux check only).

## Open
- Icon-only state tags (Program head and strip only, chosen 2026-11-01 by the user): check that the four icons are told apart at 20px on thumbnails.
- The sound icon in the transport bar is a placeholder (mute is in Controls > Output).
- The settings in General, This computer and About are proposals from the mockup; confirm each against real features before building (Open last event, confirm closing, default transition, data folder and update check do not exist in the app yet).
- DESIGN.md is rewritten (2026-11-01). The sidecar `.impeccable/design.json` is still the old graphite system and must be regenerated by the documenter after the build.
