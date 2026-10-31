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
- Never recolour, stretch or rotate the mark. Never add shadows or glows. Never move the dot. Never place it on a busy background.

## Colour

Ink on a cool neutral. One orange signal, for live and current only.

## Type

Geist for text, Geist Mono for status tags and values.

## Files

In `resources/brand/`:

- `bridgecast-mark.svg`, `bridgecast-mark-reverse.svg`, `bridgecast-mark-black.svg`, `bridgecast-mark-white.svg`
- `bridgecast-app-icon.svg`

Regenerate icons with `npm run build:icons`. It needs the env var `PW_CHROMIUM` pointing at a `chrome.exe`.

Full brand guide (private to the owner): https://claude.ai/artifact/NoaEi2ArQ1usYkJXz566Vc

Voice: see [voice.md](voice.md).
