# Changelog

Versions restart at 0.x because the app is in development.

## [Unreleased]

## [0.1.2] - 2026-11-17

### Added

- New event takes decks at once: drop PPTX, PPT or PDF files or a whole folder into the dialog, or pick them with "Choose files" / "Choose folder". They are imported into the event as soon as it is created.

### Changed

- Bridgecast always starts on Home with no event tab open, and the Home button only opens Home.
- Development runs keep their library in a separate `bridgecast-dev` folder, so test decks no longer appear in an installed Bridgecast on the same PC.

## [0.1.1] - 2026-11-17

### Changed

- Updates no longer wait for a click: a newer version downloads by itself while nothing is on air and installs when Bridgecast is closed. Nothing downloads by itself or installs during a show, "Restart and install" still installs at once, and "Skip this version" also works after the download.
- The update chip in the header reopens the update popover after "Later".

### Fixed

- "Restart and install" is refused while the key visual is on air, not only while a slide is shown.
- Holding Space, or Space with Ctrl/Alt, on a focused update button no longer moves the Program.
- "Check for updates" reports a failed check instead of "You're up to date."
- Release notes from GitHub show as plain text instead of HTML tags.
- A background check no longer hides "Try again" after a failed download.
- `npm run release` works on Windows (npm and npx are run through a shell there).

## [0.1.0] - 2026-11-16

### Added

- Bridgecast keeps every deck of an event in one library and shows the live slide ("Program") fullscreen on a second display over HDMI, with LIVE / FROZEN / BLACK / KV / STANDBY states, Cut and Fade, Freeze, key visuals and a clicker-friendly keyboard map.
- Imports .pptx, .ppt and .pdf decks as native PowerPoint slides, vector PDF pages or still images, with speaker notes and a PNG fallback so the audience never sees the desktop or a black frame.
- Adds sections, video slides, web decks, a per-machine canvas size, OMT and NDI network output, per-deck sound, light and dark themes and a first-run tour.
- Auto-update checks for a newer stable release at startup and every six hours, announces it with a header chip, a popover and a Settings > About block, downloads and installs only when the operator asks, refuses to install while something is on air, and can skip a version.
