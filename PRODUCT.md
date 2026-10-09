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
- Controls: Space / Right / PageDown = Next, Left / PageUp = Prev, F = Freeze, B or "." = Black, K = KV. Keys work only while the operator window has focus (a speaker's clicker therefore only works when that window is active).
- Auto advance to the next deck is off by default so a clicker stops at the end of the live deck; it is a saved switch.
- Freeze holds the output while the operator moves a preview; unfreeze keeps the held slide live and returns the position to it (changed 2026-10-08 at the user's request; before, unfreeze took the preview live).
- HDMI can disappear mid-show: the output hides and returns when the same display reconnects.
- Environment: Windows 11, PowerPoint installed for PPT/PPTX import (COM), offline, NSIS installer. Field checklist: docs/test-checklist.md.

## Capabilities and Constraints

- Input: .pptx, .ppt, .pdf converted to static PNG slides (1920 px wide) with speaker notes. Animations, video and audio inside slides are not supported.
- One output (HDMI, second display) with the Program content. Removed or out of scope: NDI (removed 2026-10-08, SDK licensing), a second output with different content, transcript or speech-to-text, live PowerPoint animation mode, timer, nested playlists, remote control from other devices.
- Video slides (shipped 2026-10-09): an animated page imported as a folder of `page-NN.png` + `page-NN.mp4` (drop the folder on the app) plays once when it goes live and holds its last frame. Black or KV off shows the end frame again. Audio plays on the HDMI output, with an audio device choice and Mute. Video slides carry a play mark in the strip and in Up next. Canva import comes next. Spec: docs/superpowers/specs/2026-10-09-video-slides-design.md.
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
