# Video file import (design)

Date: 2026-11-17. Size: small change. Status: waiting for approval.

## Intent

The operator wants to add a video file (`.mp4` and similar) to the library directly, with "Add
files" or drag and drop. Today only a Canva-style folder (`page-NN.png` + `page-NN.mp4`) brings in
video. The video slide itself (plays once when live, holds the last frame, deck volume and mute,
play mark in the strip) already exists; only the entry point is missing.

## Goals

- `.mp4`, `.m4v` and `.webm` files are accepted in the Add files dialog, drag and drop, and the New
  event dialog.
- One video file becomes one deck with one video slide (the user chose this over one deck for
  several videos). Several files dropped together become several decks, through the same import
  queue as every other file.
- The deck has the same shape as a folder deck, so playback, volume, Fit/Fill/Stretch, KV/Black
  behaviour and the strip play mark need no change.

## Non-goals

- Adding a video to an existing deck, or one deck from several videos.
- Converting formats (`.mov`, `.avi`, `.mkv`, ProRes, HEVC the machine cannot decode). No ffmpeg.
- Trimming, thumbnails choice, looping, autoplay settings.

## Anti-goals

- A video the output cannot play must never be accepted and then fail while live ("never black,
  never desktop"). It is refused at import with a plain message.

## Constraints

- Slides need a PNG (strip, thumbnails, fallback): the poster is a required part of the deck.
- Imports run one at a time in `ImportQueue` (`src/main/index.ts`, around line 472).
- Windows is the shipping platform; nothing extra may be required there (no bundled ffmpeg).
- `slide-protocol.ts` serves `*.mp4` as `video/mp4`; stored files keep the name `NNN.mp4`.

## Approaches

1. **Poster from a hidden Electron window with `<video>` and canvas (chosen).** Main opens the file,
   waits for `loadedmetadata`/`seeked`, draws a frame to a canvas and writes a PNG; width/height
   come from the video. A file Chromium cannot decode fails here, at import. No new dependency.
2. ffmpeg: one command, can transcode. Rejected: not bundled, adds installer size and licensing
   work, and can accept a file Chromium cannot play.
3. No poster: rejected, breaks the "every slide has a PNG" contract.

## Design

- `src/main/import/video-file.ts` (new): `VIDEO_RE = /\.(mp4|m4v|webm)$/i` and
  `readVideoDeck(file, outDir)` returning the same `FolderDeck` shape
  (`{ name, width, height, slides: [{ pngPath, notes: '', videoPath }] }`). The deck name is the
  file name without extension. The frame grab is injected (a function) so the module is testable
  in the node-only Vitest environment.
- Frame grab (`grabPoster`, in main, hidden `BrowserWindow` with `offscreen`/`show: false`): load the
  file, seek to a frame near the start (about 0.1 s or 10% of the duration, whichever is smaller,
  to skip a black first frame), draw to canvas, return PNG bytes plus width and height. A timeout
  (about 10 s) and a decode error both reject.
- Errors, English, say what to do: "This video cannot be played by Bridgecast. Export it as H.264
  MP4 or WebM, then add it again."; an empty or unreadable file; a zero-size video.
- `src/main/index.ts`: in the queue handler, a file matching `VIDEO_RE` goes to `readVideoDeck`,
  then `lib.addDeck(eventId, { ...deck, source: 'folder' })` (reuse the existing source value so
  `DeckMeta['source']` and its consumers do not change), then `state.refresh()`. The "not
  supported" message lists video types.
- Renderer: add `.mp4,.m4v,.webm` to `accept` in `Library.tsx` and `NewEventDialog.tsx`; the drop
  filters and Add files dialog extensions in main/renderer follow (find every place that lists
  `pptx/ppt/pdf`).
- Docs: PRODUCT.md (Video slides paragraph), CHANGELOG.md, `docs/test-checklist.md` (a Windows
  check: add an MP4, take it live, sound).

## Tests

- Vitest: `readVideoDeck` with an injected grab (name from the file, slide shape, rejection of a
  failing grab, extension matching); the queue routing if it is extracted into a testable
  function.
- E2E (`e2e/`, xvfb): generate a 2-second H.264 MP4 and a WebM with ffmpeg in the test, add them,
  check one deck with one slide with a play mark, take it live, check the video plays and holds the
  last frame; add a text file renamed `.mp4` and check the refusal message.

## Left to the builder

- Exact seek time and timeout values, the hidden-window mechanics, and file names of helper
  modules.
- Whether `.webm` stored as `NNN.mp4` plays through the `video/mp4` protocol response (Chromium
  sniffs the content). If it does not, either serve the stored extension or drop `.webm` from the
  accepted list. Verify in the e2e and decide.
