# Video Slides Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Slides backed by an MP4 (with a PNG poster) that play once when they go live, hold the last frame, play audio on the HDMI output, and can be imported from a folder of `page-NN.png` + `page-NN.mp4`.

**Architecture:** The reducer gains a `take` counter and `ShownSlide.video`, so every window can tell "new take, play it" from "same take back from Black/KV, show the poster". `outputSource` returns a media description; `SlideLayers` renders image or video layers and keeps the no-black-frame rule (a layer is revealed only when its first frame is ready). Folder import runs in main through the existing `ImportQueue`; audio settings live in `settings.json` and reach the output window through a broadcast.

**Tech Stack:** Electron 39, electron-vite, React 19, TypeScript, Vitest, Playwright `_electron` smoke test (`e2e/smoke.mjs`).

**Spec:** `docs/superpowers/specs/2026-10-09-video-slides-design.md`

## Global Constraints

- UI copy is English; error messages say what happened and how to fix it (existing style, e.g. `'Deck not found. Reload the deck list, or import the deck again.'`).
- No new runtime dependencies. No ffmpeg (not installed); MP4 fixtures are produced with Chromium `MediaRecorder` in Electron.
- Slide file names: `NNN.png` and `NNN.mp4` (3+ digits, same number for one slide). Folder input names: `page-NN.png`, `page-NN.mp4` (1+ digits).
- Video is `muted` everywhere except the HDMI output window; there it follows `Settings.audio.muted` and `Settings.audio.deviceId` (`null` = Windows default device).
- The output must never go black because of a video problem: any load/play failure shows the PNG poster.
- Comments and naming follow the surrounding code (short JSDoc on exported functions, explains why).

## Review Focus

1. Next pressed again while a video layer is still `pending` (not yet `loadeddata`): the superseded layer must never become visible or audible. Test in Task 4.
2. Video slide to video slide with Fade: no black frame, the old clip may keep playing under the fade. Test in Task 4 (e2e).
3. Deck reordered or slides reordered while a video plays: `shown` follows, `take` unchanged, so no replay and no restart. Test in Task 1 (`followSlideOrder`/`reconcile` keep `take` and `video`).
4. Folder with `page-9` and `page-10`: numeric order, not string order. Test in Task 3.
5. Saved audio device unplugged before or during the show: output falls back to the default device and the HDMI section warns. Test in Task 5 (unit for the fallback decision; manual checklist for real hardware).

---

### Task 1: Program state: `take` and `ShownSlide.video`

**Files:**
- Modify: `src/shared/program.ts` (ShownSlide, ProgramState, initialState, moveTo)
- Modify: `src/main/state.ts:17-31` (`same()`)
- Test: `src/shared/program.test.ts`, `src/main/state.test.ts`

**Interfaces:**
- Produces: `ShownSlide { deckId; index; file; video?: string }`, `ProgramState.take: number` (initial `0`). `moveTo` (not frozen) sets `shown` from `deck.slides[index]` including `video` when present, and sets `take: state.take + 1`. Frozen `moveTo` changes neither `shown` nor `take`.
- Adds `video?: string` to `SlideMeta` in `src/shared/types.ts` (`DeckLike` is already `Pick<DeckMeta, 'id' | 'slides'>`, so `moveTo` sees it).

- [ ] **Step 1: Write failing tests** in `program.test.ts`:
  - `initialState` equals the existing object plus `take: 0`.
  - `'next/goto/selectDeck increment take; goto on the live slide replays'`: from `at('A',0)` next gives `take 1`; `goto 1` again (already live) gives `take 2` with the same `shown`.
  - `'freeze, black, kv, transition, autoAdvance, unfreeze keep take'`: each action from a state with `take: 5` returns `take: 5`.
  - `'take on STANDBY first Next increments take'`.
  - `'shown carries the slide video'`: decks `[{ id:'V', slides:[{file:'001.png',notes:'',video:'001.mp4'},{file:'002.png',notes:''}] }]`; `selectDeck V` gives `shown.video === '001.mp4'`; next gives `shown` without `video`.
  - `'reconcile and followSlideOrder keep take and video'` (Review Focus 3).
  - In `state.test.ts`: dispatching `goto` to the live slide broadcasts (listener called) because `take` changed.
- [ ] **Step 2: Run** `npx vitest run src/shared/program.test.ts src/main/state.test.ts`. Expected: the new tests FAIL.
- [ ] **Step 3: Implement** the fields and `moveTo` change; add `a.take === b.take && a.shown?.video === b.shown?.video` to `same()`. Update existing tests that compare whole states with `toEqual` only where `take` legitimately changed.
- [ ] **Step 4: Run** `npx vitest run` and `npm run typecheck`. Expected: all PASS.
- [ ] **Step 5: Commit** `feat: program take counter and video on the shown slide`

### Task 2: Video files in the library and the `slide://` protocol

**Files:**
- Modify: `src/shared/types.ts` (`DeckMeta.source` adds `'folder'`)
- Modify: `src/main/library.ts` (`DeckInput.slides[].videoPath?`, `addDeck`, new `videoFilePath`)
- Modify: `src/main/slide-protocol.ts` (`parseSlideUrl` accepts `NNN.mp4`; new `parseRange`)
- Modify: `src/main/index.ts:37-39,63-88` (scheme privileges, handler)
- Test: `src/main/library.test.ts`, `src/main/slide-protocol.test.ts`

**Interfaces:**
- Consumes: `SlideMeta.video?` (Task 1).
- Produces:
  - `DeckInput.source: 'pptx' | 'pdf' | 'folder'`; `slides: { pngPath: string; notes: string; videoPath?: string }[]`. `addDeck` copies `videoPath` to `NNN.mp4` (same number as `NNN.png`) and writes `video: 'NNN.mp4'` into the slide.
  - `Library.videoFilePath(deckId: string, file: string): string`: throws `'Video not found. Choose a slide that exists in this deck.'` unless some slide has `video === file`.
  - `parseSlideUrl` returns `{ deckId, file }` for `slide://<uuid>/003.mp4` too (FILE_RE becomes `/^\/(\d{3,6}\.(?:png|mp4))$/`).
  - `parseRange(header: string | null, size: number): { start: number; end: number } | null | 'invalid'`: `null` = no/ignored header (send 200), `'invalid'` = 416, otherwise inclusive byte range. Supports `bytes=a-b`, `bytes=a-`, `bytes=-n`; multi-range is treated as `null`.
  - Scheme privileges add `stream: true`. Handler: `.mp4` goes through `videoFilePath`, content-type `video/mp4`, `accept-ranges: bytes`; with a range: status 206, `content-range: bytes start-end/size`, body is that slice; `'invalid'`: 416 with `content-range: bytes */size`.
- [ ] **Step 1: Write failing tests:**
  - library: `addDeck` with one `videoPath` slide and one image slide writes `001.mp4`, `deck.json` has `video: '001.mp4'` only on slide 1; `removeDeck` removes the folder; `videoFilePath` for an unknown file throws the message above.
  - protocol: `parseSlideUrl('slide://<uuid>/003.mp4')` ok; `'003.mov'`, `'../003.mp4'` null; `parseRange`: `('bytes=0-99',1000)` gives `{0,99}`, `('bytes=900-',1000)` gives `{900,999}`, `('bytes=-100',1000)` gives `{900,999}`, `('bytes=2000-',1000)` gives `'invalid'`, `('bytes=0-1,5-6',1000)` gives `null`, `(null,1000)` gives `null`, `('bytes=0-5000',1000)` gives `{0,999}`.
- [ ] **Step 2: Run** `npx vitest run src/main/library.test.ts src/main/slide-protocol.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** as specified above.
- [ ] **Step 4: Run** `npx vitest run` and `npm run typecheck`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: store slide videos and serve them with byte ranges`

### Task 3: Folder import and the video fixture

**Files:**
- Create: `src/main/import/folder.ts`, `src/main/import/folder.test.ts`
- Create: `scripts/make-video-fixture.cjs`, output committed in `fixtures/video-deck/` (`page-1.png`, `page-1.mp4`, `page-2.png`, `page-3.png`, `page-3.mp4`)
- Modify: `src/main/index.ts:118-174` (queue job: directory goes to the folder importer; `decksImport` accepts directories)
- Modify: `src/renderer/src/components/DropOverlay.tsx` (`DroppedItems.folders: File[]`), `src/renderer/src/App.tsx:198-250` (folders are imported through `api.importDecks`)
- Test: `src/main/import/folder.test.ts`

**Interfaces:**
- Produces:
  - `readFolderDeck(dir: string): FolderDeck` with `FolderDeck = { name: string; width: number; height: number; slides: { pngPath: string; notes: ''; videoPath?: string }[] }`. Name = `path.basename(dir)`. Size from the first PNG's IHDR (`pngSize(file: string): { width: number; height: number }`, bytes 16-23 big-endian; throws `'<file> is not a readable PNG image. Export the page again, then import the folder again.'`).
  - Matching is case-insensitive `^page-(\d+)\.(png|mp4)$`; pages sorted numerically; other files ignored.
  - Errors: no PNG at all gives `'This folder has no page-NN.png files. Choose a folder exported from Canva (page-01.png, page-01.mp4, ...).'`; an MP4 without its PNG gives `'Page NN has a video but no page-NN.png. Export that page again, then import the folder again.'` (NN as in the file name).
  - Main: in the queue job, `fs.statSync(job.path).isDirectory()` leads to `readFolderDeck`, then `lib.addDeck(eventId, { ...deck, source: 'folder' })`, `state.refresh()`. Progress: 10 after reading, 90 before `addDeck`.
  - Renderer: `readDrop` pushes the folder's `File` (from `it.getAsFile()`) into `folders`; `importFiles` turns each folder into an `ImportRequest` via `api.pathForFile`, with a busy row named after the folder. The old `UNSUPPORTED.folder` row is removed.
  - `scripts/make-video-fixture.cjs` (run with `npx electron scripts/make-video-fixture.cjs`): draws a 640x360 canvas: dark background, a yellow square that moves left to right over 1 s, then holds 1 s; records with `MediaRecorder` `video/mp4;codecs=avc1` (fails loudly if unsupported); writes `page-1.mp4` and `page-1.png` (final frame); `page-2.png` static blue; `page-3` like page 1 with a red square. Each MP4 should be about 50 KB or less.
- [ ] **Step 1: Write failing tests** in `folder.test.ts` (temp dirs with tiny PNGs from a hard-coded 1x1 PNG buffer with patched IHDR size, or from `fixtures/video-deck`):
  - `'orders pages numerically'`: `page-10.png`, `page-9.png`, `page-1.png` give order 1, 9, 10 (Review Focus 4).
  - `'pairs videos with pages; pages without video are images'`.
  - `'ignores other files and is case-insensitive'` (`PAGE-2.PNG`, `report.json`).
  - `'reads the size from the first PNG'` gives `{ width: 640, height: 360 }` for the fixture.
  - Both error messages above, exactly.
- [ ] **Step 2: Generate the fixture**: `npx electron scripts/make-video-fixture.cjs`. Expected: five files in `fixtures/video-deck/`.
- [ ] **Step 3: Run** `npx vitest run src/main/import/folder.test.ts`. Expected: FAIL (module missing).
- [ ] **Step 4: Implement** `folder.ts`, the main wiring, and the renderer drop path.
- [ ] **Step 5: Run** `npx vitest run`, `npm run typecheck`, `npm run lint`. Expected: PASS.
- [ ] **Step 6: Commit** `feat: import a folder of page PNGs and MP4s as a deck`

### Task 4: Playback in the output and the Program monitor

**Files:**
- Modify: `src/renderer/src/model.ts:205-215` (`outputSource` returns `OutputMedia | null`)
- Modify: `src/renderer/src/components/SlideLayers.tsx` (image and video layers)
- Modify: `src/renderer/src/OutputView.tsx`, `src/renderer/src/components/Program.tsx`
- Test: `src/renderer/src/model.test.ts`, `src/renderer/src/layers.test.ts` (new, pure helper), `e2e/smoke.mjs` (new video section)

**Interfaces:**
- Consumes: `ProgramState.take`, `ShownSlide.video` (Task 1); `slide://…/NNN.mp4` (Task 2); `fixtures/video-deck` (Task 3).
- Produces:
  - `type OutputMedia = { kind: 'image'; url: string } | { kind: 'video'; url: string; poster: string; take: number }` exported from `model.ts`. `outputSource(s)`: black gives `null`; KV gives image; `shown` with `video` gives video (`url = slideUrl(deckId, video)`, `poster = slideUrl(deckId, file)`, `take = s.take`); `shown` without video gives image; STANDBY gives KV image or `null`.
  - `layerFor(media: OutputMedia | null, played: ReadonlySet<number>, topId: string | null): LayerSpec | null` in `src/renderer/src/components/layers.ts`, with `LayerSpec = { id: string; kind: 'image' | 'video'; url: string; poster?: string; take?: number }`. Video id = `` `v:${url}#${take}` ``; image id = url. A video whose `take` is in `played` and whose id is not `topId` becomes `{ kind: 'image', id: poster, url: poster }`.
  - `SlideLayers` props: `media: OutputMedia | null` (replaces `src`), `muted: boolean`, `sinkId?: string | null` (Task 5 passes it; ignore here), `onShown?(key, media)`. It keeps a `played` set (add `take` when a video layer is revealed) and compares `layerFor(...).id` instead of `src`. A video layer renders `<video src muted={muted} playsInline preload="auto">` and is revealed on `loadeddata` (or on `error`, then it shows the poster `<img>`); `play()` is called on reveal; a rejected `play()` falls back to the poster. `imgAttrs` still applies to image layers.
  - `OutputView`: `muted` from audio settings (Task 5; `false` until then). `Program` monitor: `muted` always `true`.
- [ ] **Step 1: Write failing unit tests:**
  - `model.test.ts`: `outputSource` for video slide, image slide, KV over video, black over video.
  - `layers.test.ts`: new take gives a video spec; same take already played and not on top (back from black) gives the poster image; same take on top stays a video (no swap after `ended`); next take (`take + 1`) on the same slide gives a video again; `null` media gives `null`.
- [ ] **Step 2: Run** `npx vitest run src/renderer/src`. Expected: FAIL.
- [ ] **Step 3: Implement** `layers.ts`, `outputSource`, `SlideLayers`, both callers. Superseded pending video layers are dropped by the existing `reveal` logic and must be paused and removed (Review Focus 1).
- [ ] **Step 4: Add the e2e section** in `e2e/smoke.mjs` after the existing deck tests: import `fixtures/video-deck` with `window.api.importDecks(eventId, [{ id, path }])` (or `win.evaluate`), select the deck, then:
  - `'video slide: first frame differs from the last, then it holds'`: sample the output frame (existing `dumpFrame`) right after reveal and after 2.5 s; the square's position changed; a sample at 3.5 s equals the one at 2.5 s.
  - `'Black then Black off shows the last frame at once'`: within 300 ms of Black off the frame equals the held frame.
  - `'Prev then Next replays the animation'`.
  - `'fade video to video never shows black'`: with Fade, Next from page 1 to page 3 (via page 2), sampling every frame for 400 ms finds no all-black frame (Review Focus 2).
  - `'rapid Next over a video slide never shows it'` (Review Focus 1): Next twice within 50 ms from the slide before a video; the output reaches the slide after it and no sampled frame shows the video's first frame.
  - `'missing MP4 shows the poster'`: delete `003.mp4` (slide 3) from the imported deck's folder under the app's data dir, go to slide 3, and the frame equals its PNG.
- [ ] **Step 5: Run** `npx vitest run`, `npm run typecheck`, `npm run test:e2e`. Expected: PASS, `SMOKE PASSED`.
- [ ] **Step 6: Commit** `feat: play video slides once on Program and the HDMI output`

### Task 5: Audio on the HDMI output

**Files:**
- Modify: `src/shared/settings.ts` (`AudioSettings`, `DEFAULT_AUDIO`, `sanitizeAudio`, `Settings.audio`)
- Modify: `src/main/settings.ts` (`DEFAULT_SETTINGS.audio`), `src/main/index.ts` (`SettingsStore.saveAudio`, `audio:set`, broadcast, permission handlers)
- Modify: `src/shared/ipc.ts` (`Invoke.audioSet = 'audio:set'`, `Broadcast.audioSettings = 'audio:settings'`, `Api.setAudio(a: AudioSettings): Promise<Settings>`, `Api.onAudioSettings(cb): () => void`), `src/preload/index.ts`
- Modify: `src/renderer/src/OutputView.tsx` (applies `muted`, `sinkId`), `src/renderer/src/components/HdmiSection.tsx` (device select, Mute, warning)
- Create: `src/renderer/src/audio.ts` (`pickSink`)
- Test: `src/main/settings.test.ts` (sanitize cases), `src/renderer/src/audio.test.ts`, `e2e/smoke.mjs`

**Interfaces:**
- Produces:
  - `AudioSettings = { deviceId: string | null; muted: boolean }`, `DEFAULT_AUDIO = { deviceId: null, muted: false }`; `sanitizeAudio(raw)`: `deviceId` is a non-empty string up to 512 chars, else `null`; `muted` boolean else `false`.
  - `'audio:set': { args: [audio: AudioSettings]; result: Settings }`: sanitizes, saves, broadcasts `audio:settings` with the saved `AudioSettings`.
  - `pickSink(saved: string | null, devices: { deviceId: string }[]): { sinkId: string; missing: boolean }`: `null` gives `{ sinkId: '', missing: false }` ('' = default for `setSinkId`); saved and present gives it; saved but absent gives `{ sinkId: '', missing: true }` (Review Focus 5).
  - `SlideLayers` applies `sinkId` to video layers with `setSinkId` (errors are logged, playback continues on the default device).
  - Main: `session.defaultSession.setPermissionCheckHandler` and `setPermissionRequestHandler` allow `'media'` and `'speaker-selection'` for the app's own origins only (dev server URL or `file:`), so `enumerateDevices()` returns `audiooutput` labels.
  - HdmiSection: `<select data-testid="audio-device">` with "Default (Windows)" plus each `audiooutput` device (label, or `Audio device N` when the label is empty); `Switch` "Mute audio" (`data-testid="audio-mute"`); when the saved device is missing: `'The saved audio device is not connected. Sound plays on the Windows default device.'`. It listens to `navigator.mediaDevices.ondevicechange`.
- [ ] **Step 1: Write failing tests:** `sanitizeAudio` cases (missing, wrong types, too long id); `sanitizeSettings` keeps `audio`; `pickSink` three cases.
- [ ] **Step 2: Run** `npx vitest run`. Expected: FAIL.
- [ ] **Step 3: Implement** shared, main, preload, OutputView, HdmiSection, `pickSink`.
- [ ] **Step 4: Add e2e checks:** toggling Mute in the HDMI section sets `muted` on the output window's `<video>` (`hdmiWin.evaluate`); the device list has at least the Default option; after an app restart (`electron.launch` again, as the smoke test already does for settings) Mute is still on.
- [ ] **Step 5: Run** `npx vitest run`, `npm run typecheck`, `npm run test:e2e`. Expected: PASS.
- [ ] **Step 6: Commit** `feat: video audio on the HDMI output with device choice and mute`

### Task 6: Video mark in the strip and Up next, docs

**Files:**
- Modify: `src/renderer/src/components/Strip.tsx:~97`, `src/renderer/src/components/NextPanel.tsx`, `src/renderer/src/model.ts` (`nextView` slide adds `video?: true`), `src/renderer/src/styles/app.css`
- Modify: `docs/test-checklist.md`, `PRODUCT.md` (video slides from "planned" to shipped)
- Test: `src/renderer/src/model.test.ts`, `e2e/smoke.mjs`

**Interfaces:**
- Produces: thumbnails of video slides carry `data-video="true"` and a small `PlayIcon` (Phosphor, `size={12}`, `weight="fill"`) in the bottom-left corner with `aria-label="Video slide"`; the Up next card shows the same mark. Style follows DESIGN.md (existing corner-badge tokens; no new colors).
- [ ] **Step 1: Failing test:** `nextView` for a next slide with video returns `video: true`.
- [ ] **Step 2: Implement** the mark and styles; e2e: the video deck's thumbnails 1 and 3 have `data-video`, 2 does not.
- [ ] **Step 3: Checklist:** add to `docs/test-checklist.md`: import a Canva export folder; animation plays once on the HDMI screen and holds; Black/KV off shows the end frame; sound comes out of the chosen HDMI/audio device; Mute works; unplugging the device falls back to default with the warning.
- [ ] **Step 4: Run** `npx vitest run`, `npm run typecheck`, `npm run lint`, `npm run test:e2e`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: mark video slides in the strip and Up next`
