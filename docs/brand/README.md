# Bridgecast brand

Tagline: From slide to screen, live.

## Idea

- **Bridge**: slides, PDFs, video and web pages become one reliable output.
- **Cast**: the output travels to a screen or over the LAN.

## Logo: Arches

Two concentric arches and one orange dot (`#f26f1c`, token `--brand-signal`). The dot never follows the accent preset.

- Clear space: the dot diameter (10 of 64 units) on every side.
- Minimum width: 16px. Below 24px use the app icon.
- Known open issue: at 16px the arches merge in `build/icon.ico`.
- Never recolour, stretch or rotate the mark. Never add shadows or glows. Never move the dot. Never place it on a busy background. Never outline the arches or replace the dot with another shape.

Which file, where:

- **Mark** (`bridgecast-mark.svg`): on the light ground, panels, white and light photography. **Reverse mark** (`bridgecast-mark-reverse.svg`): on the dark theme, ink and dark photography.
- **Horizontal lockup** is the default signature: the mark plus "Bridgecast" set as live text in Geist 600 with tracking -0.035em. The mark is 1.4 times the wordmark size and the gap between them equals the dot's diameter. The name is one word, capital B only.
- **Mark alone** where space is tight: app icon, favicon, avatar, taskbar, a corner watermark.
- **One colour** (`-black`, `-white`): print, stamps, engraving. White on the orange, or on photographs where the dot would be lost. The dot takes the same single colour.
- **App icon** (`bridgecast-app-icon.svg`): the reverse mark on a dark tile with 22% corners. Do not put it inside another rounded frame.
- Photography behind the logo is darkened so the reverse mark keeps 4.5:1.

## Colour

Ink on a cool neutral. One orange signal, for live and current only.

- Neutrals carry about 95% of any surface. If orange appears twice on one screen for unrelated reasons, remove one.
- `--brand-signal` is the logo dot and the brand's orange. Inside the product the state colour is the user's accent (see `DESIGN.md`); the dot never follows it.
- Small text in the orange on the light ground fails contrast (2.7:1). Orange text uses the accent ink tokens, not `--brand-signal`.
- The four deck colours label deck types inside the product. They are not marketing colours or a second accent.
- Pure black appears only around Program output (`--letterbox`).
- Neutral values live in `tokens.css` and `DESIGN.md`. The brand guide's neutrals are older; do not copy them.

## Type

Geist for text, Geist Mono for status tags and values.

- Numbers that must line up (slide counts, timers, bitrates) use Geist Mono or tabular figures.
- Headlines are weight 600 with negative tracking, one idea per line, sentence case, no full stop.
- Status words and eyebrows are mono, uppercase, tracked, 12px: ON AIR, NEXT, HOLD, FROZEN.
- No italics for emphasis in product UI, and no third family.

## Imagery and icons

- Real events: stages, screens, control tables, hands on a keyboard. Grounded and low-saturation, so the dot is the warmest thing in the picture. No stock audiences, no fake charts.
- Show the real console with real slide content.
- Product icons are Phosphor regular (see `DESIGN.md`). No emoji as icons or decoration.

## Files

In `resources/brand/`:

- `bridgecast-mark.svg`, `bridgecast-mark-reverse.svg`, `bridgecast-mark-black.svg`, `bridgecast-mark-white.svg`
- `bridgecast-app-icon.svg`

Regenerate icons with `npm run build:icons`. It needs the env var `PW_CHROMIUM` pointing at a `chrome.exe`.

Full brand guide (private to the owner): https://claude.ai/artifact/NoaEi2ArQ1usYkJXz566Vc

Voice: see [voice.md](voice.md).
