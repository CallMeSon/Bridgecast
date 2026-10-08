---
name: PPT Share
description: Operator console for live event slides; a broadcast program bus with one Program output.
colors:
  graphite-bg: "#141414"
  graphite-panel: "#1b1b1b"
  graphite-raised: "#252525"
  graphite-raised-hi: "#2e2e2e"
  rule-line: "#2f2f2f"
  rule-line-hi: "#454545"
  control-edge: "#777777"
  ink: "#e8e8e6"
  ink-2: "#b0b0ae"
  ink-3: "#8c8c8a"
  selection: "#3d3d3a"
  focus-ring: "#e8e8e6"
  tally-red: "#d32f29"
  tally-ink: "#ff6e66"
  on-tally: "#fafafa"
  cue-amber: "#d4a24a"
  cue-ink: "#d4a24a"
  cue-edge: "#d4a24a"
  on-cue: "#17130a"
  letterbox: "#000000"
  standby: "#0d0d0d"
  standby-ink: "#9a9a98"
  black-tally-ink: "#ff7a72"
  placeholder: "#0d0d0d"
  placeholder-ink: "#9a9a98"
  light-bg: "#dcdcda"
  light-panel: "#ecece9"
  light-raised: "#e0e0dd"
  light-raised-hi: "#d3d3d0"
  light-rule-line: "#c4c4c0"
  light-rule-line-hi: "#9c9c98"
  light-control-edge: "#727270"
  light-ink: "#1a1a19"
  light-ink-2: "#444442"
  light-ink-3: "#5c5c59"
  light-selection: "#bcbcb8"
  light-tally-red: "#c3231d"
  light-tally-ink: "#b01d17"
  light-cue-amber: "#c8922c"
  light-cue-ink: "#6f4b08"
  light-cue-edge: "#946512"
  light-placeholder: "#e0e0dd"
  light-placeholder-ink: "#444442"
typography:
  brand:
    fontFamily: "Geist, Segoe UI Variable Text, Segoe UI, system-ui, sans-serif"
    fontSize: "15px"
    fontWeight: 650
    letterSpacing: "-0.01em"
  title:
    fontFamily: "Geist, Segoe UI Variable Text, Segoe UI, system-ui, sans-serif"
    fontSize: "13px"
    fontWeight: 600
  body:
    fontFamily: "Geist, Segoe UI Variable Text, Segoe UI, system-ui, sans-serif"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.4
    fontFeature: "tnum"
  control:
    fontFamily: "Geist, Segoe UI Variable Text, Segoe UI, system-ui, sans-serif"
    fontSize: "15px"
    fontWeight: 600
  notes:
    fontFamily: "Geist, Segoe UI Variable Text, Segoe UI, system-ui, sans-serif"
    fontSize: "15px"
    fontWeight: 400
    lineHeight: 1.5
  numeral-lg:
    fontFamily: "Cascadia Mono, Consolas, monospace"
    fontSize: "20px"
    fontWeight: 600
  numeral:
    fontFamily: "Cascadia Mono, Consolas, monospace"
    fontSize: "13px"
    fontWeight: 400
  tally:
    fontFamily: "Cascadia Mono, Consolas, monospace"
    fontSize: "13px"
    fontWeight: 700
    lineHeight: 1
    letterSpacing: "0.06em"
  label-mono:
    fontFamily: "Cascadia Mono, Consolas, monospace"
    fontSize: "12px"
    fontWeight: 500
    lineHeight: 1
rounded:
  r: "3px"
spacing:
  xs: "4px"
  sm: "6px"
  md: "8px"
  lg: "10px"
  xl: "12px"
  gutter: "16px"
components:
  button:
    backgroundColor: "{colors.graphite-raised}"
    textColor: "{colors.ink}"
    rounded: "{rounded.r}"
    padding: "0 14px"
    height: "34px"
  button-hover:
    backgroundColor: "{colors.graphite-raised-hi}"
  button-sm:
    padding: "0 10px"
    height: "28px"
  button-inverse:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.graphite-bg}"
    rounded: "{rounded.r}"
  control-button:
    backgroundColor: "{colors.graphite-raised}"
    textColor: "{colors.ink}"
    typography: "{typography.control}"
    rounded: "{rounded.r}"
    padding: "0 12px"
    height: "52px"
  control-next:
    backgroundColor: "{colors.cue-amber}"
    textColor: "{colors.on-cue}"
    typography: "{typography.control}"
    rounded: "{rounded.r}"
    height: "56px"
    width: "176px"
  control-hold-pressed:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.graphite-bg}"
  tally-live:
    backgroundColor: "{colors.tally-red}"
    textColor: "{colors.on-tally}"
    typography: "{typography.tally}"
    rounded: "{rounded.r}"
    padding: "0 10px"
    height: "24px"
  tally-frozen:
    textColor: "{colors.tally-ink}"
    typography: "{typography.tally}"
    rounded: "{rounded.r}"
    height: "24px"
  tally-black:
    backgroundColor: "{colors.letterbox}"
    textColor: "{colors.black-tally-ink}"
    typography: "{typography.tally}"
    rounded: "{rounded.r}"
    height: "24px"
  tally-standby:
    textColor: "{colors.ink-2}"
    typography: "{typography.tally}"
    rounded: "{rounded.r}"
    height: "24px"
  segmented:
    backgroundColor: "{colors.graphite-bg}"
    textColor: "{colors.ink-2}"
    rounded: "{rounded.r}"
    padding: "0 16px"
    height: "36px"
  segmented-checked:
    backgroundColor: "{colors.graphite-raised-hi}"
    textColor: "{colors.ink}"
  switch:
    backgroundColor: "{colors.graphite-raised-hi}"
    rounded: "{rounded.r}"
    width: "40px"
    height: "24px"
  switch-on:
    backgroundColor: "{colors.ink}"
  text-input:
    backgroundColor: "{colors.graphite-bg}"
    textColor: "{colors.ink}"
    rounded: "{rounded.r}"
    padding: "0 10px"
    height: "34px"
  kbd:
    backgroundColor: "{colors.graphite-bg}"
    textColor: "{colors.ink-2}"
    typography: "{typography.label-mono}"
    rounded: "{rounded.r}"
    padding: "3px 5px"
  deck-row:
    textColor: "{colors.ink}"
    padding: "10px 16px"
  deck-row-current:
    backgroundColor: "{colors.graphite-raised}"
  menu:
    backgroundColor: "{colors.graphite-panel}"
    rounded: "{rounded.r}"
    padding: "4px"
  menu-item:
    padding: "8px 10px"
  menu-item-hover:
    backgroundColor: "{colors.graphite-raised}"
  popover:
    backgroundColor: "{colors.graphite-panel}"
    rounded: "{rounded.r}"
    padding: "16px"
    width: "340px"
  save-note:
    backgroundColor: "{colors.graphite-panel}"
    textColor: "{colors.ink}"
    rounded: "{rounded.r}"
    padding: "6px 12px"
---

# Design System: PPT Share

## Overview

**Creative North Star: "The Broadcast Console"**

PPT Share looks like the program bus of a small vision mixer, not like a slide editor. The operator window is a dense, flat desk of graphite panels divided by 1px rules: a 44px header strip, three resizable columns (Decks, Program, Up next), a control deck under the Program monitor, and a 128px thumbnail strip across the bottom. Nothing floats except menus and popovers. Structure comes from hairlines and three tonal steps, never from cards or shadows.

Colour is signal, not decoration. The graphite neutrals carry no hue (they are pure greys with a faint warm cast in the light theme, never blue). Red appears only where something is on air: the tally, the Program monitor ring, the LIVE and FROZEN tags, and the live deck's status line. Amber appears only where something is next: the Next button, the Up next ring and position, the NEXT tag. Everything else (errors, pressed holds, destructive confirms, selection) is expressed with full-strength ink, inversion, weight and shape, so that a glance at the screen in a dark venue answers one question: what is the audience seeing, and what will Next do.

Type is Geist for words and the system monospace (Cascadia Mono, then Consolas) for every number, count, key cap and tally, with tabular figures on by default. The UI ships both themes; dark is the default and the one the world is tuned for.

**Key Characteristics:**
- Flat graphite panels, 1px rules, one 3px radius everywhere.
- Red = on air (LIVE, FROZEN, BLACK, KV tallies). Amber = next. No other chromatic colour in the chrome.
- Words in Geist, numbers and tallies in mono; tabular numerals globally.
- State is told by text and shape as well as colour (tally words, pressed inversion, check bar on the chosen segment, On/Off beside switches).
- The Program monitor and slide letterboxes stay black in both themes.
- Dense desktop layout with resizable columns and a container-query control deck.

## Colors

A hue-less graphite desk with exactly two signal colours: broadcast tally red and cue amber. Values are the dark theme (default) unless prefixed `light-`; both themes are set on `:root[data-theme]` in `tokens.css` and every rule reads the CSS variables, never literal values.

### Primary
- **Tally Red** (`--tally`, {colors.tally-red} / {colors.light-tally-red}): the on-air colour. Fills the LIVE tally and LIVE strip tag (with Paper White `--on-tally`), rings the Program monitor (2px) whenever the state is live, frozen, black or KV, outlines the on-air strip thumbnail (2px), and outlines the FROZEN, BLACK and KV tallies (1.5px).
- **Tally Ink** (`--tally-ink`): red as text on graphite, used for the FROZEN tally word, the FROZEN strip tag and the live or frozen deck's status line ("LIVE, slide 3"). Brighter than Tally Red in dark (6.3:1 on panel), darker in light (5.9:1).
- **Black-Tally Ink** (`--black-tally-ink`): the BLACK and KV tally text, always on the letterbox black, so it is one value in both themes (8.3:1).

### Secondary
- **Cue Amber** (`--cue`): the fill of the Next button, the NEXT strip tag and the strip legend's Next swatch. Text on it is Cue Black (`--on-cue`, 8.0:1 dark, 6.7:1 light).
- **Cue Edge** (`--cue-edge`): amber as a ring or outline; the Next button border, the 2px ring of the Up next card and the 2px outline of the next strip thumbnail. Darkened in light (4.3:1 on panel) so the ring stays at or above 3:1.
- **Cue Ink** (`--cue-ink`): amber as text; the Up next position ("3 / 3"). Same as Cue Amber in dark, deep brown-amber in light (6.6:1).

### Neutral
- **Graphite Ground** (`--bg`): the Program column, inputs, segmented-control rest fill, key caps, and the Decks panel footers (KV block, Add files).
- **Graphite Panel** (`--panel`): header, side columns, control deck, strip, menus and popovers.
- **Raised** / **Raised High** (`--raised`, `--raised-hi`): button rest and hover fills; hover and current-row fills in lists and menus; the pressed theme button and checked segment; the action error notice.
- **Rule** / **Rule High** (`--line`, `--line-hi`): 1px structure. Rule divides siblings (header cells, column heads, deck rows, control deck cells); Rule High marks a heavier seam (top of the control deck, strip and Decks footers), frames popovers, menus and slide thumbnails, and is the dashed border of disabled controls.
- **Control Edge** (`--edge`): the boundary of every interactive control and input (buttons, segmented control, switch track, text inputs, key caps). Set for WCAG 1.4.11: 4.1:1 on ground, 3.9:1 on panel, 3.0:1 on raised-hi in dark; 3.5 / 4.1 / 3.2:1 in light.
- **Ink 1-3** (`--text`, `--text-2`, `--text-3`): primary text (15.0:1 on ground), secondary text (7.9:1 on panel), and tertiary labels, counts and hints (5.1:1 on panel, 4.5:1 on raised; light 5.7 / 5.1:1).
- **Focus** (`--focus`): equals Ink; the 2px focus outline.
- **Selection** (`--sel`): text selection only.
- **Letterbox** (`--letterbox`, #000 in both themes): behind every slide image and the Program monitor, and the BLACK/KV tally fill. The output window (`output.css`) is literal black.
- **Standby** / **Standby Ink** (`--standby`, `--standby-ink`): the empty Program monitor card, dark in both themes (6.9:1).
- **Placeholder** / **Placeholder Ink**: empty-state cards in the side panels (Up next "End of deck", empty KV thumb); they follow the theme.

### Named Rules
**The On-Air Red Rule.** Red means the audience is seeing it: LIVE, FROZEN, BLACK, KV and the marks that point at the on-air slide. It is never used for errors, destructive actions, hover, or emphasis.

**The Amber Means Next Rule.** Amber marks only what Next will take to air (the Next button, the Up next card and position, the NEXT tag). A disabled Next loses its amber.

**The Ink Not Colour Rule.** Problems and warnings are marked by full-strength Ink, weight (550-600) and an icon, never by a hue. The destructive confirm button is inverted Ink, not red.

**The No Blue Rule.** Neutrals are true greys. Do not tint graphite toward blue or slate.

## Typography

**Body Font:** Geist (variable 100-900, bundled woff2), falling back to Segoe UI Variable Text, Segoe UI, system-ui.
**Label/Mono Font:** Cascadia Mono, then Consolas (Windows system monospace).

**Character:** A neutral grotesk for every sentence and label, set against a plain system mono that makes every number, key and tally read as instrumentation. Tabular numerals are on for the whole body so counts never shift.

### Hierarchy
- **Brand** (650, 15px, -0.01em): the "PPT Share" word mark in the header only.
- **Control** (600, 15px): the large control-deck buttons (Prev, Next, Freeze, KV, Black). Program title line uses 15px regular in Ink 2.
- **Title** (600, 13px): column heads (Decks, Program, Up next, Notes) and menu or popover titles.
- **Body** (400, 13px, line-height 1.4): everything else; labels in forms at 550. Notes are larger for reading at a distance (400, 15px, 1.5).
- **Numeral Large** (mono 600, 20px): the Program position ("3 / 3"); Up next position is mono 600 15px in Cue Ink.
- **Numeral** (mono 400, 13px): counts and meta ("3 slides", "2 decks", display resolution).
- **Tally** (mono 700, 13px, line-height 1, 0.06em, uppercase words): LIVE, FROZEN, BLACK, KV, STANDBY.
- **Label Mono** (mono 500-700, 12px): key caps, strip slide numbers and tags, the PGM tag.
- **Empty-state card** (sans, clamp(12px, 2.5cqw, 20px); title 600 clamp(13px, 3.4cqw, 26px)): sized from the card's own width so it reads in a 118px thumb and a full monitor.

Weights in use: 400, 500, 550, 600, 650, 700. Sizes in use: 12, 13, 15, 18 (drop overlay), 20px. There is no display size; the slide is the display.

### Named Rules
**The Numbers Are Mono Rule.** Every count, position, resolution, key cap and tally is set in the mono stack; every sentence is set in Geist. Captions that are prose stay sans even when they contain a number.

## Layout

A fixed desktop console. The app is a three-row grid: a 44px header, the main area, and the slide strip (`--strip-h`, default 128px). The main area is three columns: Decks (`--left-w`, default 256px), Program (fluid, minimum 0) and Up next (`--right-w`, default 320px); below 1400px the defaults drop to 232px and 288px. The strip repeats the left column width so its deck label sits under Decks.

All three dimensions are operator-resizable with splitters: a 12px hit area laid over the existing 1px panel rule, showing a 2px mark on hover (Ink 3), focus (Focus) and drag (Ink 2). Each hit area reaches into the neighbour that has no scrollbar on that edge.

Column heads are 40px with 16px side padding and a bottom rule. The panel gutter is 16px throughout; inner rhythm steps are 4, 6, 8, 10, 12 and 14px. Controls are large: control-deck buttons 52px (Next 56px, minimum width 176px), standard buttons 34px (small 28px), segmented control 36px, switch 40x24px.

The Program monitor is sized from its container's free height: its width is `min(100cqw, (100cqh - 40px) * 16/9)`, so the 16:9 frame and its 30px meta line always fit without scrolling.

The control deck under Program is a five-cell grid (Prev/Next, Transition, spacer, Freeze, KV/Black) at 84px tall. Its responsive behaviour is driven by the Program column's width (container `stage`), not the window: under 880px the optional key hints hide; under 700px the deck becomes two rows, Prev/Next spanning the top, Transition, Freeze and KV/Black below, so Black never scrolls out of reach.

The header is a row of cells divided by 1px rules; only the event name shrinks (with an ellipsis), so HDMI and theme controls never leave the window.

## Elevation & Depth

The desk is flat. Depth comes from three tonal steps (ground, panel, raised) and 1px rules, not shadows. Exactly one shadow exists, and it belongs to things that float above the desk: menus, the context menu and the HDMI popover. The drop overlay is the only translucent surface (ground at 85% with a 2px blur).

### Shadow Vocabulary
- **Pop** (`--pop-shadow`: `0 8px 24px rgba(0,0,0,0.45)` dark, `0 8px 24px rgba(0,0,0,0.18)` light): menus and popovers only, together with a Rule High border.

### Named Rules
**The Rules Not Cards Rule.** Group with 1px rules and tonal steps. Do not wrap panels, rows or controls in shadowed cards.

## Shapes

One radius, `--r: 3px`, on every button, input, tag, tally, thumbnail, monitor, menu and popover. Full-bleed header buttons and list rows are square (0) because they touch a rule or the window edge. Inside the segmented control the outer segment corners are 2px (the 3px radius minus its 1px border). No pills, no circles: the switch track and knob are 3px rectangles too.

Borders are 1px for structure and control edges, 1.5px for outlined tallies, 2px for state rings (on-air red, next amber) and focus. Rings on slides are drawn as overlays (`::after`) so the image box stays exactly 16:9 with no black slivers.

Line style carries meaning: solid is a present thing; dashed currently marks disabled controls, drop targets and the operator position thumbnail while it is off air (see Do's and Don'ts).

## Components

### Buttons
Quiet, edged, solid; they look pressable and nothing more.
- **Shape:** 3px radius, 1px Control Edge border.
- **Default:** Raised fill, Ink text, 550 weight, 34px tall, 14px padding; small variant 28px, 10px padding. Icons are Phosphor at 16px with an 8px gap.
- **Hover:** Raised High fill.
- **Focus:** 2px Focus outline, 1px offset (inset -2 to -3px where a container clips or the button is full-bleed).
- **Inverse (named `danger` in code):** Ink fill and Ink border, Ground text; hover goes to Ink 2. Used for the delete confirmation; deliberately not red.
- **Disabled:** transparent fill, 1px dashed Rule High border, Ink 3 text, not-allowed cursor.

### Control deck
The hardware row under the monitor: big targets, key caps printed on the buttons.
- **Control button:** 52px, 12px padding, 600 15px, Raised fill, Control Edge border, 16px icon, 10px gap.
- **Next:** 56px, minimum 176px, Cue Amber fill, Cue Edge border, Cue Black text; its key caps (Space, →) go transparent with a Cue Black edge. Hover brightens the amber (`filter: brightness(1.08)`).
- **Hold buttons (Freeze, KV, Black):** toggles with `aria-pressed`. Pressed inverts to Ink fill and Ground text, key caps outlined in Ground. Pressed is never red; the tally carries the on-air colour.
- **Disabled:** same dashed treatment as buttons; Next loses its amber; key caps go transparent with Rule High edges.
- **Cells:** separated by 1px Rule; 8px padding; optional key caps (`kbd.opt`) hide when space runs short.

### Segmented control (Transition: Cut / Fade)
- **Style:** 36px, 1px Control Edge border, segments divided by an Edge rule, Ground fill, Ink 2 text at 550.
- **Checked:** Raised High fill, Ink text and a 2px Ink bar along the bottom (inset shadow), so the choice does not rest on fill alone.
- **Behaviour:** a radio group with one tab stop; arrow keys move and choose. Labelled "Transition" above in Ink 3.

### Switch
- **Style:** 40x24px track, 3px radius, Control Edge border, Raised High fill; 16px square knob in Ink 2.
- **On:** track Ink fill and border, knob in Ground, moved 16px (0.15s).
- **State text:** the word On or Off always sits beside the track (Ink 2, minimum 56px).
- **Disabled:** `aria-disabled`, 50% opacity, stays focusable so its reason can be read.

### Tally
The on-air lamp in the Program column head; mono 700 13px, 0.06em tracking, 24px tall, 10px padding, 3px radius, optional 14px Phosphor icon.
- **LIVE:** Tally Red fill, Paper White text.
- **FROZEN:** 1.5px Tally Red outline, Tally Ink text, snowflake icon.
- **BLACK / KV:** 1.5px Tally Red outline on Letterbox black, Black-Tally Ink text, eye-slash or image icon.
- **STANDBY:** 1px Rule High outline, Ink 2 text, no red.
- The monitor's 1px Rule High ring becomes a 2px Tally Red ring for LIVE, FROZEN, BLACK and KV.

### Deck rows (Decks panel)
- **Style:** full-width rows, 10px 16px padding, bottom 1px Rule, square corners; a 20px file icon (Phosphor 20px, Ink 3), name at 500, sub line and mono count in Ink 3 / Ink 2.
- **Hover / current:** Raised fill.
- **Live or frozen deck:** Raised fill, icon in Ink, sub line in Tally Ink at 600 spelling the state ("LIVE, slide 3", "FROZEN, slide 2").
- **Importing:** a 4px progress track (Raised High) with an Ink 2 fill that scales from the left (transform only, 0.2s linear).
- **Error:** status text in Ink at 600 and a warning icon; no red.
- **Rename / confirm:** the row becomes the editor (text input) or a confirmation (Raised High fill, message, inline buttons).
- **Reorder:** dragging row at 40% opacity; target row marked with a 2px dashed Ink 2 outline.

### Strip thumbnails
- **Style:** 118px wide 16:9 slides with a 1px Rule High overlay ring and 3px radius; 10px gap; number and tag below in mono 12px.
- **LIVE:** 2px Tally Red outline, tag filled red with Paper White text.
- **FROZEN:** 2px Tally Red outline, tag outlined 1.5px red with Tally Ink text.
- **NEXT:** 2px Cue Edge outline, tag filled Cue Amber with Cue Black text.
- **Operator position (when it is not on air: during Freeze, Black or KV):** 2px dashed Ink 2 outline, no tag.
- **Hover:** ring goes to Ink 3. Focus ring sits 4px out so it clears the 2px role outline.
- **Legend:** small swatches (12x8px) for "Live on Program" and "Next" under the deck name.

### Menus and popovers
- **Menu:** Panel fill, 1px Rule High border, 3px radius, Pop shadow, 4px padding, minimum 230px (context menu 180px). Items 8px 10px, 16px icon slot, Raised on hover, 1px Rule separators, key caps right-aligned.
- **Popover (HDMI output):** 340px, 16px padding, 14px section gap, same frame as the menu, scrolls within the window height. Status lines sit on Raised with 8px 10px padding; a problem status switches to Ink at 550, never a colour.
- **Header triggers:** full-bleed cells with square corners; Raised on hover and while expanded.

### Inputs
- **Style:** Ground fill, 1px Control Edge border, 3px radius, 10px padding; 34px (28px for the inline event name). Placeholder in Ink 3. Disabled selects drop to Ink 3.
- **Focus:** the global 2px Focus outline.

### Empty states
Slide-shaped cards rather than illustrations: a 16:9 box with a short title (600) and one sentence, sized with container units. In side panels they follow the theme (Placeholder); on the Program monitor they stay dark (Standby). Plain-text empties ("No slides yet.") use Ink 3 at the panel gutter.

### Action error notice
A persistent notice above Program when an action fails: Raised High fill, 1px Rule High border, 3px radius, 10px 12px padding, a 20px warning icon, a bold first line ("Action failed. Program did not change.") and the cause in Ink 2, with a small Dismiss button. Red is not used.

### Save note
A small non-blocking status at the bottom right (16px inset): Panel fill, 1px Rule High border, 3px radius, 6px 12px padding, 12px Ink text. Hidden while empty; not interactive.

### Drop overlay
While files are dragged in: a fixed panel 12px in from the window edge, 2px dashed Ink 2 border, translucent ground with 2px blur, 18px 600 text with a 22px upload icon. Pointer-transparent.

### Motion
- **Slide change (SlideLayers):** a new slide layer stays hidden (`pending`) until its image has decoded, then cuts in or fades in over the previous one, which is removed afterwards (Cut: 50ms later; Fade: 250ms linear opacity plus 50ms). No black frame is ever shown between slides. The same 250ms fade drives the output window.
- **Black:** the monitor shade fades over 0.25s only when Fade is chosen; with Cut it is instant.
- **Decorative:** switch knob 0.15s, progress fill 0.2s linear.
- **Reduced motion:** `prefers-reduced-motion` removes only decorative transitions (switch knob, progress fill). The operator's Fade is the content change itself and keeps running.

### Icons
Phosphor (regular weight) throughout, at 14px (tallies, dismiss), 16px (buttons, menus, header) and 20-22px (list and notice leading icons). Icons sit beside a word; the theme toggle is the only icon-only control and carries an aria-label.

## Do's and Don'ts

### Do:
- **Do** keep red for on-air marks only: tally fills and outlines, the 2px monitor ring, LIVE/FROZEN tags and outlines, the live deck's status line.
- **Do** keep amber for what Next will take to air, and drop it whenever Next is disabled.
- **Do** read every colour from the `tokens.css` variables so both themes stay correct; never hard-code a hex in a component rule.
- **Do** put a Control Edge (`--edge`) border on every control and input so its boundary meets 3:1 in both themes.
- **Do** say state in words and shape as well as colour: the tally word, On/Off beside switches, the bottom bar on a checked segment, pressed inversion on holds.
- **Do** set numbers, counts, key caps and tallies in the mono stack, and sentences in Geist.
- **Do** use the single 3px radius, square corners only where an element touches a rule or the window edge.
- **Do** draw slide rings as overlays so the slide box stays exactly 16:9.
- **Do** keep the Program monitor, letterboxes and standby card black in both themes.
- **Do** respond to the Program column's width (container queries) rather than the window when rearranging the control deck.

### Don't:
- **Don't** use red for errors, warnings, destructive buttons, hover or emphasis; use Ink, weight and an icon.
- **Don't** add a third chromatic accent or tint the greys blue.
- **Don't** wrap panels or rows in shadowed cards; the Pop shadow is for floating menus and popovers only.
- **Don't** introduce a second radius, pills or circular controls.
- **Don't** put the operator's Fade under `prefers-reduced-motion`; only decorative transitions are removed there.
- **Don't** show a slide before its image is decoded; a black frame between slides is a failure.
- **Don't** give dashed lines a new meaning. Dashed already marks disabled controls, drop targets and the off-air operator position thumbnail; consolidating these is an open issue, not a pattern to extend.
