---
version: 1
slug: "src-renderer-src-app-tsx"
primary_target: "src/renderer/src/App.tsx"
related_targets: []
---

# Operator window redesign (Operate mode, code-led)

Confirmed 2026-10-30. Direction pinned by user: Rimo video-editor references (soft light + dark editor, rounded soft-app, properties sidebar). No direction roll.

## Job
Operator keeps the right slide on air in a dim venue, under pressure; expert or first-time. One glance: what the audience sees, what Next does.

## Direction
- Themes: soft light and dark editor; default follows the OS; header toggle stays.
- Accent: 6 soft presets (violet, blue, mint, muted rose, sand, slate), chosen in the output/settings popover, saved per machine, tuned light and dark values, AA contrast. Rose and sand keep a clear hue gap from tally red.
- Shape: larger radius, gentle shadows, pill tags, section spacing over hairlines. Replaces the 3px / no-shadow rules.
- Structure: Decks = layers tree, Program + control deck = canvas + transport, right panel = properties, strip = timeline.
- Right panel, collapsible titled sections: Up next, Notes, Transition + Continue to next deck, Selected deck settings (Display mode, Sound, canvas override), Output status (HDMI, OMT, NDI, audio route).
- Signals: red = on air only. Amber removed; Next uses the accent (button, Up next ring, NEXT tag, position). Next stays the largest filled control with key caps and the word NEXT. State never by colour alone.

## Untouched
Keyboard map, clicker, terms and tally words, "never black, never desktop", output and Prepare windows (black chrome), features, copy. Operator controls keep current large sizes.

## States
LIVE/FROZEN/BLACK/KV/STANDBY; web chips Loading/Ready/Error/HOLD; importing; empty event; no HDMI; disabled; long deck names; both themes x six accents.

## Constraints
WCAG 2.1 AA, 3:1 control edges, container queries on Program column, CSS variables in tokens.css only, Windows ships (Linux check only).

## Open
None. DESIGN.md is rewritten at the end of the build.
