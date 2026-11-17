# Changelog

Versions restart at 0.x because the app is in development.

## [Unreleased]

## [0.1.7] - 2026-11-17

### Fixed

- "Sign in with Google" in a web deck: the WebView2 page no longer replaces itself with the sign-in target. While the deck is off air the helper opens a real popup in the same profile, so popup-based sign-in can finish and hand the result back to the page; while the deck is on air the page cannot open a window or navigate itself away.
- If the WebView2 browser process exits, the helper now leaves, so the app restarts it and reopens the pages at their last address instead of leaving dead windows behind (Resume web used to resume a black window).
- A web page stuck in JavaScript raises HOLD after about five seconds instead of leaving the output silently frozen.
- A helper that cannot start at all (missing file or DLL, blocked exe) falls back to the built-in browser for the session and shows one notice, instead of leaving every web deck in Error until a restart.
- Stop in the Prepare toolbar works for web pages; a mouse release and the arrow keys from Prepare are sent to the page correctly.
- The helper end-to-end suite runs on Linux and macOS too (fake helper), and the release script always rebuilds the helper so an old exe cannot be shipped under a new version.

### Known

- The page on air also plays on the PC's default device at the Windows volume; muting it there would silence it for the outputs too (measured), so deck level and Mute apply to the output path only.

## [0.1.6] - 2026-11-17

### Added

- Web decks on Windows run in a real WebView2 (Microsoft Edge) page hosted by a small helper, so sites that reject embedded browsers work, including "Sign in with Google" on Canva. Sign-ins live in a profile folder under the app's data folder and survive a restart.
- A web page can have its own sign-in profile (one deck signed in to one account, another deck to another), and "Sign out of all websites" clears the profiles of the open pages.
- If the helper hangs or is killed, the output holds the last good frame (never black), the helper restarts by itself and reopens every page at the address it was on. After three failed restarts the session switches to the built-in browser instead of leaving the output without a page.
- Web page sound keeps the same deck-volume and master rules, now fed from the helper's audio pipe through the outputs' gain.

### Fixed

- A web page that failed to load loads again after Reload (the error state is cleared when the new document starts), in both the built-in browser and the WebView2 helper.

## [0.1.5] - 2026-11-17

### Added

- Video files (MP4, M4V, WebM) can be added to the library directly, from Add files, drag and drop or the New event dialog: one file becomes one deck with one video slide, named after the file.
- A Bridgecast installed from the `.deb` updates itself: Settings > About > "Check for updates" finds a newer version, downloads it in the background and installs it on "Restart and install" or when Bridgecast is closed. The install asks for the administrator password. A `.deb` of 0.1.4 or older has no updater: install this version by hand once.
- Web decks block ads and trackers (Ghostery filter lists, cached in the data folder, best effort: with no network on the first run the pages load unblocked). It only applies to the web deck profile. `PPT_ADBLOCK=0` turns it off.

### Fixed

- A file added as a video is imported as one slide deck with a poster taken from the video; a file Chromium cannot play is refused with a message and leaves no deck behind.
- The app builds again: the Dark-theme About logo uses its tracked SVG instead of a PNG that was never committed.

## [0.1.4] - 2026-11-17

### Added

- New event sets the event's Canvas (the default, a preset, the HDMI display's size or a custom size) and its Outputs (HDMI, OMT, NDI), so the event is ready when it is used. The outputs are switched when the event takes the output, and a switch changed in the Output panel is remembered by that event.

## [0.1.3] - 2026-11-17

### Added

- A middle click on an event tab closes it. The on-air tab still cannot be closed.

### Changed

- The key visual (KV) box is an upload area: drag and drop an image onto it or click to browse, with a preview, Replace and Remove once an image is set.
- Off air moved from the Controls tab to the top bar, left of the Light / Dark switch. It still asks before it takes the show off air.
- Labels, tabs and buttons can no longer be selected by dragging or double-clicking. Text fields, speaker notes and the OMT source name can still be selected.

### Fixed

- After a click on Cut / Fade (or another switch of that kind) the arrow keys take the next or previous slide again, instead of moving inside the switch.

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
