# Media player (video files as decks)

Date: 2026-11-26. Status: approved in chat (stage 1). Stage 2 (ffmpeg conversion of formats
Chromium cannot play) is not part of this spec.

## Intent

The operator drops a video file (`.mp4`, `.m4v`, `.mov`, `.webm`, `.mkv`, `.ogv`) into the app
and plays it on Program like a playout. Controls (play, pause, restart, seek, loop) exist only in
the operator window. HDMI, OMT and NDI show the bare picture: no layout, no controls.

## Approaches

1. **Chromium `<video>` in the existing layer pipeline (picked).** The output windows already
   render video layers for every output; volume, routing, Black/KV and fallback all apply as is.
   Cross-platform, testable on Linux.
2. libmpv (mpv.js / electron-mpv-video): more formats without conversion, but a native addon
   (Windows x64 only, tested with an older Electron), a separate render path outside the
   offscreen OMT/NDI renderer, and nothing that runs on Linux CI.
3. Player UI libraries (Plyr, video.js, Vidstack): only controls for a local `<video>`; our
   controls drive another window, and they add no codecs.

## Design

- **Import.** A video file is a new deck kind, `source: 'media'`, with one slide: `001.png`
  (poster frame) and `001.<ext>` (the file, copied asynchronously so main never blocks), plus
  `duration` in seconds. The renderer probes the file with a `<video>` (blob URL): duration,
  size and a poster frame. A file Chromium cannot decode fails the import with
  "This video cannot play here. Convert it to MP4 (H.264), then import it again."
- **Clock.** `ProgramState.media` (absent = no media on air) is
  `{ playing, at, since, loop, seek, duration }`: position = `at` (+ elapsed since `since` while
  playing), wrapped by `duration` when looping, clamped to it otherwise. Main stamps `now`
  (`reduce(..., now)`), never the renderer. A new take of a media slide starts playing from 0.
  Actions: `mediaPlay`, `mediaPause`, `mediaSeek {at}`, `mediaRestart`, `mediaLoop {on}`.
  Play at the end restarts from 0.
- **Outputs.** The video `OutputMedia` carries the clock. Every window (HDMI, offscreen OMT/NDI,
  operator monitor) syncs its `<video>` to it: play/pause, `loop`, and a seek when the drift is
  over 0.5 s or the operator sought. A media video is never replaced by its poster after
  Black/KV: it comes back at the clock's position (the clock runs on behind Black, like playout).
- **Operator.** A media bar above the transport while a media deck is on air: Play/Pause,
  Restart, elapsed / total, a seek slider, Loop.

## Left to the builder

Copy, icons and styling follow DESIGN.md and the existing transport bar.
