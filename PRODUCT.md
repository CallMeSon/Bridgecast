# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

(Electron desktop app for Windows; the UI is a web renderer. One operator window plus a borderless fullscreen output window on a second display.)

## Users

- Event operators who run the slides at a live event: both professional AV technicians or event vendors (multimedia/LED crews handling many events and clients) and non-specialist client staff or committee members running their own internal events. The UI must be safe for the less experienced operator without slowing down the expert.
- Their job: keep the right slide on the projector or LED screen for every speaker in an event, often under time pressure, in a dark venue, while speakers may drive slides themselves with a presentation clicker.
- Without this product they switch between PowerPoint windows so the screen capture or projector shows the right deck (spec: docs/superpowers/specs/2026-10-06-ppt-share-design.md).

## Product Purpose

- Keep every deck of an event in one library and show the live slide ("Program") fullscreen on a second display over HDMI (Windows Extend mode), controlled from one operator window.
- Success: the audience never sees desktop, wrong slides, black flashes, or the next speaker's deck by accident; the operator always knows what is on air and what comes next.

## Positioning

- Not "PowerPoint on a second screen": PowerPoint (or pdf.js) is used only at import time to convert slides to images; during the show the app renders Program itself and behaves like a broadcast program bus: LIVE / FROZEN / BLACK / KV / STANDBY tally, Cut or Fade, Freeze that holds the output while the operator previews other slides, a key visual hold image, and no separate Preview bus (Next/Prev change Program directly).
- Runs fully offline; the output never moves onto the operator's own display.

## Operating Context

- Workflow: create an event (starts empty), import .pptx/.ppt/.pdf by button or drag and drop (per-file progress), reorder and rename decks, set an optional KV (key visual) image per event, connect HDMI and choose the target display, then run the show with keys or clicker.
- Controls: Space / Right / PageDown = Next, Left / PageUp = Prev, F = Freeze, B or "." = Black, K = KV, N = Next section, Shift+N = Prev section. Keys work only while the operator window has focus (a speaker's clicker therefore only works when that window is active).
- Auto advance to the next deck is off by default so a clicker stops at the end of the live deck; it is a saved switch.
- Freeze holds the output while the operator moves a preview; unfreeze keeps the held slide live and returns the position to it (changed 2026-10-08 at the user's request; before, unfreeze took the preview live).
- HDMI can disappear mid-show: the output hides and returns when the same display reconnects.
- Environment: Windows 11, PowerPoint installed for PPT/PPTX import (COM), offline, NSIS installer. Field checklist: docs/test-checklist.md.

## Capabilities and Constraints

- Input: .pptx, .ppt, .pdf converted to static PNG slides (1920 px wide) with speaker notes. Animations, video and audio inside slides are not supported.
- One output (HDMI, second display) with the Program content. Network output: OMT and NDI (see below). Removed or out of scope: a second output with different content, transcript or speech-to-text, live PowerPoint animation mode, timer, nested sections, remote control from other devices.
- Sections (2026-10-12): optional dividers in the deck list (Add section, rename, move, remove; the deck menu has Add section above). A section is a boundary for auto advance: the clicker stops at its last slide and Up next shows "End of section". N / Shift+N jump to the next / previous section and go live at once (while frozen they only move the preview). Spec: docs/superpowers/specs/2026-10-12-sections-design.md.
  - Events with sections should not be edited in a build older than 2026-10-12: it does not shift section positions when decks move or are removed, so section boundaries drift (no deck is lost).
- Video slides (shipped 2026-10-09): an animated page imported as a folder of `page-NN.png` + `page-NN.mp4` (drop the folder on the app) plays once when it goes live and holds its last frame. Black or KV off shows the end frame again. Audio plays on the HDMI output, with an audio device choice and Mute all. Video slides carry a play mark in the strip and in Up next. Canva import comes next. Spec: docs/superpowers/specs/2026-10-09-video-slides-design.md.
- Canvas (2026-10-27): the output has a canvas size, default 1920×1080 per machine (output popover, Canvas section) with an optional override per event (Event menu, "Canvas for this event…"). Presets 1920×1080, 3840×2160 and 1280×720, Match HDMI display, or Custom; each side is 320–7680 px and rounded down to an even number, at most 3840×2160 pixels in total (so 7680×1080 is allowed). Changing it while a slide is on air asks for confirmation. Slides are drawn into the canvas and the canvas is scaled to the HDMI window. Spec: docs/superpowers/specs/2026-10-27-canvas-audio-levels-design.md.
- Fit, Fill, Stretch (2026-10-27): each deck chooses (deck menu, "Display mode") how its slides fill the canvas: Fit (whole slide, black bars), Fill (crops to cover) or Stretch (distorted). Default Fit. The KV is always Fit and strip thumbnails stay Fit. Changing it for the live deck updates the output at once and never replays a video slide.
- Deck and master volume (2026-10-27): every deck has a volume (0–100) and a mute (deck menu, "Sound…"), and the Audio section of the output popover has a master volume next to Mute all. Sound is the deck volume times the master volume, 0 when either is muted; a change is smooth and does not replay the live video. The output's sound goes through the Web Audio API; if that is unavailable it falls back to the video's own volume. Spec: docs/superpowers/specs/2026-10-27-canvas-audio-levels-design.md.
  - Settings, events and decks saved with these fields should not be edited in a build older than 2026-10-27: it does not know the canvas, Fit, deck volume or master volume, so it drops them the next time it saves and everything returns to 1920×1080, Fit and full volume (no deck or slide is lost).
- OMT output (2026-10-27): Program, with its sound, can also be sent over the LAN with Open Media Transport so vMix 29+ and OBS 31+ (with the OMT plugin) can take it as a source (Resolume: best effort, unverified). The libraries libomt and libvmx are MIT-licensed and ship in the installer. The picture size is the canvas size; frame rate 30 (default) or 60; the source name is shown to receivers as "HOSTNAME (NAME)". OMT works with or without HDMI: it has its own offscreen renderer. Changing the canvas, frame rate or name restarts the sender, so receivers may lose the picture for a moment (the real gap is still to be measured). Sound route (Audio section of the output popover): Local device, OMT or Both. Rule: exactly one window plays the sound on this PC (the HDMI window while it shows, otherwise the OMT window while OMT runs); route OMT silences this PC, Local keeps it off the network. Windows asks to allow PPT Share through the firewall the first time OMT is switched on. Spec: docs/superpowers/specs/2026-10-27-omt-output-design.md; spike numbers: docs/superpowers/notes/omt-spike.md.
- NDI output (removed 2026-10-08 for SDK licensing; re-added 2026-10-27): the same Program, with its sound, can also be sent as an NDI source, alone or together with OMT, so vMix, OBS (DistroAV) and NDI Monitor can take it. The NDI Runtime is never bundled with PPT Share: the Windows installer downloads it from ndi.video when it is missing (signature checked; if the download fails the install continues without NDI and the app says the runtime is not installed). OMT and NDI share one offscreen renderer and one frame clock. The frame rate setting (30 or 60, stored as omt.fps) applies to every network protocol, so changing it restarts both senders and receivers may lose the picture for a moment. The sound route labels are Local device, Network and Both; Network and Both send the sound to every network protocol that is on, and the rule of exactly one window playing on this PC is unchanged. Spec: docs/superpowers/specs/2026-10-27-omt-output-design.md; plan: docs/superpowers/plans/2026-10-27-ndi-output.md.
- Canva import (planned 2026-10-09): paste a Canva design link, sign in once (token exchange through a Cloudflare Worker that holds the client secret), pages export as PNG + MP4 with progress and Resume; static pages become image slides. Spec: docs/superpowers/specs/2026-10-09-canva-import-design.md.
- Terminology: event, deck, slide, Program (PGM), Next, Prev, Freeze, Black, KV, Cut, Fade, tally states LIVE, FROZEN, BLACK, KV, STANDBY.
- UI language: English (done 2026-10-08; the user decided the UI should be English "to be more universal", since the app is shared for free with other operators). Broadcast terms stay as they are. Panel and label names: Event (header), Decks (library panel, with the Key visual (KV) block), Up next (right panel; "Preview" while frozen), Notes, Transition, Continue to next deck.
- Every user-facing error names the problem and the recovery action.
- Light and dark themes (dark default), resizable panels, settings and library stored locally per machine.

## Brand Commitments

- Name: PPT Share (appId com.pptshare.app).
- No logo yet; the app icon is still the stock Electron icon (build/icon.png). Do not invent a logo or mascot.

## Evidence on Hand

- Test fixtures: fixtures/sample.pdf, fixtures/sample-4x3.pdf, fixtures/sample-4x3.pptx, fixtures/sample-12.pptx.
- Screenshots of the app in .superpowers/sdd/2026-10-06-ppt-share/ and the repo root (dark.png, light.png, menu.png, newevent.png).
- No users, customers, testimonials, metrics or press exist yet; the field test on a real event PC is still pending. Do not fabricate any of these.
- Distribution: to be shared for free with other operators (not sold).

## Product Principles

1. What is on air is never ambiguous: the operator can always tell what the audience sees and what Next will do.
2. Mistakes must not reach the screen: guard rails over speed (auto advance off by default, freeze as preview, no black frames, output never on the operator's display).
3. Keyboard and clicker first, mouse second; nothing during a show requires precise mouse work.
4. Works in a dark room under pressure for both an expert technician and a first-time committee member.
5. Offline and self-contained: a show never depends on the network.

## Accessibility & Inclusion

- Used in dark venues: dark theme default, high-contrast text, state shown by text and shape, not colour alone (red is reserved for on-air tallies, amber for "next").
- Fully operable by keyboard and presentation clicker; target WCAG 2.1 AA for the operator window.

NDI® is a registered trademark of Vizrt NDI AB.
