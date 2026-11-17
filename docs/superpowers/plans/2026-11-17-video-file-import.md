# Video file import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a video file (`.mp4`, `.m4v`, `.webm`) to the library from Add files, drag and drop, or the New event dialog; one file becomes one deck with one video slide.

**Architecture:** Renderer classifies the file as `video` and sends its path to main's import queue like a PPTX. Main reads it with `readVideoDeck` (new), which takes a poster PNG from the video with an injected frame-grab function (a hidden Electron window in production, a stub in tests) and returns the same `FolderDeck` shape as `readFolderDeck`. The deck is stored with `lib.addDeck(..., source: 'folder')`, so playback, volume, display mode and the strip play mark need no change.

**Tech Stack:** Electron (`BrowserWindow`), TypeScript, Vitest (node env), Playwright e2e, ffmpeg only inside the e2e to generate fixtures.

**Spec:** `docs/superpowers/specs/2026-11-17-video-file-import-design.md`

## Global Constraints

- Accepted extensions: `.mp4`, `.m4v`, `.webm` (case-insensitive). No ffmpeg in the app, no conversion.
- One video file = one deck = one slide; deck name = file name without extension; `source: 'folder'`.
- Stored files follow the existing contract: poster `001.png`, video `001.mp4` (`slideName(i, 'mp4')` in `library.ts`).
- A video Chromium cannot play is refused at import. Never black, never desktop: no deck is created on failure.
- Imports go through `ImportQueue` (one at a time). User-facing copy is English and says what to do.
- Vitest runs in node, no jsdom; the frame grab is injected so `readVideoDeck` is testable.
- Do not touch the dark palette. Do not add lint errors. Stage only your own files.
- Commits: `git -c user.name="Gerson Sebastian" -c user.email="sebastiangerson24@gmail.com" commit ...`

## Review Focus

- A file renamed `.mp4` that is not a video (text, truncated): refused with the "cannot be played" message, no deck left behind.
- A 0-byte file, and a file that disappears between drop and import: plain error row, queue continues with the next file.
- Several videos dropped together: each becomes its own deck, a bad one does not block the rest.
- A video whose first frame is black: the poster is taken a little into the clip, not at 0 s.
- A video with an odd size (portrait, 4:3, very large): poster has the video's own width and height; Fit/Fill/Stretch handle the rest.
- A video with no audio track: imports and plays normally.
- Upper-case extension (`CLIP.MP4`) and names with spaces or non-ASCII characters.

---

### Task 1: Renderer accepts video files

**Files:**
- Modify: `src/renderer/src/model.ts` (`FileKind`, `fileKind`, `UNSUPPORTED.file`, around lines 216-228)
- Modify: `src/renderer/src/new-event.ts:31-50` (`addDeckFiles`)
- Modify: `src/renderer/src/App.tsx` (`importFiles`, around lines 561-600)
- Modify: `src/renderer/src/components/Library.tsx:1493`, `src/renderer/src/components/NewEventDialog.tsx:362,387,427`, `src/renderer/src/components/Program.tsx:23` (accept lists and copy)
- Test: `src/renderer/src/model.test.ts`, `src/renderer/src/new-event.test.ts`

**Interfaces:**
- Produces: `FileKind = 'pptx' | 'pdf' | 'video' | 'unsupported'`; `fileKind(name)` returns `'video'` for `/\.(mp4|m4v|webm)$/i`; `export const VIDEO_EXTENSIONS_RE = /\.(mp4|m4v|webm)$/i` in `src/shared/video-file.ts` (new, no Node imports) so main and renderer share it.

- [ ] **Step 1: Write the failing tests**
  - `model.test.ts`: `fileKind('Clip.MP4') === 'video'`, `'a.m4v'`, `'b.webm'` are `'video'`; `'c.mov'`, `'d.avi'` and `'e.png'` are `'unsupported'`; existing pptx/pdf cases unchanged.
  - `new-event.test.ts`: `addDeckFiles([], [f('a.mp4'), f('b.webm'), f('c.pptx'), f('d.mov')])` keeps `a.mp4`, `b.webm`, `c.pptx` and reports `skipped === 1`.
- [ ] **Step 2: Run** `npx vitest run src/renderer/src/model.test.ts src/renderer/src/new-event.test.ts`. Expected: new cases FAIL.
- [ ] **Step 3: Implement** `src/shared/video-file.ts` exporting `VIDEO_EXTENSIONS_RE`; use it in `fileKind` and `addDeckFiles`. Update `UNSUPPORTED.file` to "Only PPTX, PPT, PDF, MP4, M4V, or WebM files can be imported."
- [ ] **Step 4: Wire the UI.** In `App.tsx` `importFiles`, a `video` kind goes through `queueForMain` (same as PPTX; missing-path message: "Could not find the file location. Save the file to disk, then drag it in from File Explorer."). Extend both `accept` attributes to `.pptx,.ppt,.pdf,.mp4,.m4v,.webm` and update the three user-facing hints (drop text, "left out" text, empty hint) to name video files.
- [ ] **Step 5: Run** the two test files again plus `npm run typecheck`. Expected: PASS, no type errors.
- [ ] **Step 6: Commit** `feat(import): renderer accepts video files`.

### Task 2: `readVideoDeck` (main, injectable)

**Files:**
- Create: `src/main/import/video-file.ts`
- Test: `src/main/import/video-file.test.ts`

**Interfaces:**
- Consumes: `VIDEO_EXTENSIONS_RE` from `src/shared/video-file.ts` (Task 1); the `FolderDeck` shape of `src/main/import/folder.ts` (export that type from `folder.ts`: `export type FolderDeck`).
- Produces:
  - `export interface PosterGrab { png: Buffer; width: number; height: number }`
  - `export type GrabPoster = (file: string) => Promise<PosterGrab>`
  - `export async function readVideoDeck(file: string, outDir: string, grab: GrabPoster): Promise<FolderDeck>`: checks extension and non-empty file, calls `grab`, writes `png` to `<outDir>/poster.png`, returns `{ name, width, height, slides: [{ pngPath, notes: '', videoPath: file }] }`.
  - `export const VIDEO_CANNOT_PLAY = 'This video cannot be played by Bridgecast. Export it as H.264 MP4 or WebM, then add it again.'`

- [ ] **Step 1: Write the failing tests** (temp dir, stub `grab`):
  - `Intro Clip.MP4` with a stub returning 1280×720 gives `name === 'Intro Clip'`, `width 1280`, `height 720`, one slide whose `videoPath` is the input file and whose `pngPath` exists and holds the stub's bytes.
  - A stub that rejects makes `readVideoDeck` reject with exactly `VIDEO_CANNOT_PLAY` and writes no poster.
  - A 0-byte file rejects with "This video file is empty. Choose another file." and never calls `grab`.
  - A missing file rejects with "Could not read this video file. Check that it still exists, then add it again."
  - Stub returning width or height 0 rejects with `VIDEO_CANNOT_PLAY`.
- [ ] **Step 2: Run** `npx vitest run src/main/import/video-file.test.ts`. Expected: FAIL (module missing).
- [ ] **Step 3: Implement** as specified above.
- [ ] **Step 4: Run** the test file. Expected: PASS. Also `npx vitest run src/main/import/folder.test.ts` still passes.
- [ ] **Step 5: Commit** `feat(import): readVideoDeck builds a one-slide deck from a video file`.

### Task 3: Poster grab and import queue branch (main)

**Files:**
- Create: `src/main/import/grab-poster.ts`
- Modify: `src/main/index.ts` (import line ~44; queue handler ~lines 472-481; the "not supported" error)
- Test: `src/main/import/grab-poster.test.ts` only for the pure helper below; the window part is covered by the Task 4 e2e.

**Interfaces:**
- Consumes: `GrabPoster`, `readVideoDeck`, `VIDEO_CANNOT_PLAY` (Task 2); `VIDEO_EXTENSIONS_RE` (Task 1); `tempDir()` already in `index.ts`.
- Produces: `export const grabPoster: GrabPoster` (Electron); `export function posterTime(duration: number): number` returning `Math.min(0.1, duration * 0.1)` (0 for non-finite or non-positive durations).

- [ ] **Step 1: Write the failing test** for `posterTime`: `(10) -> 0.1`, `(0.5) -> 0.05`, `(0) -> 0`, `(NaN) -> 0`, `(Infinity) -> 0`.
- [ ] **Step 2: Run** `npx vitest run src/main/import/grab-poster.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement `grabPoster`**: a hidden `BrowserWindow` (`show: false`, `sandbox: true`, `contextIsolation: true`, no preload, no node integration) that plays the file in a `<video muted preload="metadata">`, waits for `loadedmetadata`, seeks to `posterTime(video.duration)`, waits for `seeked`, draws to a canvas at `videoWidth` x `videoHeight` and returns the PNG bytes plus size through `executeJavaScript`. A `file://` video taints the canvas: either load a tiny HTML file from the temp dir with `webSecurity: false` (this window never loads remote content), or take `capturePage()` of a window sized to the video; pick one and note why in a comment. Reject on `video.error`, a 10 s timeout, or size 0. Always `destroy()` the window in `finally`. Check the Electron `BrowserWindow`/`webContents` API in Context7 before writing it.
- [ ] **Step 4: Branch the queue** in `index.ts`: before the `PPTX_RE` check, `if (VIDEO_EXTENSIONS_RE.test(job.path))` create `tempDir()`, `readVideoDeck(job.path, out, grabPoster)`, `progress(... percent: 90 ...)`, `lib.addDeck(eventId, { ...deck, source: 'folder' })`, `state.refresh()`, and remove the temp dir in `finally` (same shape as the PPTX branch). Change the unsupported error to "This file type is not supported. Choose a PPTX, PPT, PDF, MP4, M4V, or WebM file."
- [ ] **Step 5: Run** `npx vitest run`, `npm run typecheck`, `npm run lint` (no new errors beyond the 8 known). Expected: PASS.
- [ ] **Step 6: Commit** `feat(import): import a video file as a one-slide deck`.

### Task 4: E2E, docs, checklist

**Files:**
- Modify: `e2e/smoke.mjs` (new section after "Video slides (fixtures/video-deck)", ~line 1483, reusing its helpers `hdmiJs`, `near`, the import-by-path pattern used at lines ~366-372)
- Modify: `PRODUCT.md` (Video slides paragraph), `CHANGELOG.md` (Unreleased), `README.md` if it lists accepted types, `docs/test-checklist.md`

**Interfaces:**
- Consumes: everything from Tasks 1-3.

- [ ] **Step 1: Write the e2e section.** Generate with ffmpeg into a temp dir: `clip.mp4` (H.264, 2 s, 640x360, one moving square), `clip.webm` (VP9), `fake.mp4` (text bytes), `empty.mp4` (0 bytes). Import them by path through the same API the folder import uses. Assert: `clip` and `clip` (webm, named `clip-webm.webm`) each become a deck with 1 slide and a play mark; `fake.mp4` and `empty.mp4` show an error row with the expected message and create no deck; take `clip.mp4` live, the HDMI output plays and ends on the last frame (sample the square position like the existing video slides test); the deck's `001.png` has the video's size. Skip the section with a clear log line when `ffmpeg` is not installed.
- [ ] **Step 2: Run** `xvfb-run -a -s '-screen 0 2560x1440x24' npm run test:e2e`. Expected: PASS. If `.webm` stored as `001.mp4` does not play, serve the stored extension in `src/main/slide-protocol.ts` (and its test) or drop `.webm` from `VIDEO_EXTENSIONS_RE`, the UI copy and the docs; state which in the commit message.
- [ ] **Step 3: Docs.** PRODUCT.md "Video slides": add that a single MP4, M4V or WebM file can be added directly (one deck per file, H.264 MP4 or WebM only, poster from a frame near the start). CHANGELOG Unreleased: "Adds video files (MP4, M4V, WebM) as decks." `docs/test-checklist.md`: a Windows check (add an MP4 and a WebM, take live, sound on HDMI, a `.mov` is refused with the message).
- [ ] **Step 4: Run** `npm test`, `npm run typecheck`, `npm run lint`. Expected: PASS, no new lint errors.
- [ ] **Step 5: Commit** `feat(import): e2e and docs for video file import`.

## Execution notes (repo rules)

Run tasks with subagents on `sonnet`, effort `medium`; escalate to `opus` when stuck or after a failed review. If a task fails more than 3 times, stop and report the task, file, command and error.
