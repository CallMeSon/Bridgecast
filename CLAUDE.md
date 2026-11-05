# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Bridgecast is an Electron + React + TypeScript operator console for live events. One operator window controls a "Program" output: fullscreen on a second display (HDMI), and optionally sent over the LAN (OMT, NDI). Read `PRODUCT.md` (behavior, terminology, constraints) and `DESIGN.md` (UI tokens) before touching product behavior or UI. User-facing copy is English; many notes, specs and plans under `docs/superpowers/` are Indonesian.

## Commands

- `npm run dev`: electron-vite dev (Windows is the shipping platform, development is on Linux).
- `npm run typecheck`: runs `typecheck:node` and `typecheck:web` (two tsconfigs). `npm run build` typechecks first.
- `npm test`: Vitest, `src/**/*.test.ts(x)`, **node environment, no jsdom**. Single file: `npx vitest run src/shared/program.test.ts`. Single test: add `-t "name"`. Component logic that needs testing is extracted into plain `.ts` modules (see `components/pdf-page.ts`).
- `npm run lint` (ESLint, cached) / `npm run format` (Prettier: no semicolons, single quotes, width 100). Lint has known errors outside `e2e/` (`scripts/*`, `program.test.ts`, ...); do not add new ones.
- E2E (Playwright driving Electron, scripts in `e2e/`): `npm run test:e2e` (`smoke.mjs`; fails on purpose while the known app bug "event tab covered by the sticky on-air tab" is open, printed as `KNOWN FAILURE`), `test:e2e:network` (OMT/NDI with fake bindings), `test:e2e:web` (web decks), `test:e2e:settings`, `test:e2e:layout`, `test:e2e:all` (all suites in turn), `test:e2e:native` (native slideshow with FakeEngine via `PPT_ENGINE_FAKE=1`; PowerPoint bridge, window capture and sound pipe are Windows-only and untested). Every `electron.launch` spreads `linuxArgs` from `e2e/launch-args.mjs` (`--ozone-platform=x11` on Linux; required on Wayland sessions, or the self-relaunch drops Playwright's connection). Headless Linux: `xvfb-run -a -s '-screen 0 2560x1440x24' npm run test:e2e:web`.
- `npm run build:bridge`: compiles `native/ppt-bridge` (C# net48, builds on Linux with `dotnet build`, runs only on Windows). `build:win|mac|linux|unpack` package with electron-builder.
- OMT needs native libraries that are not committed (`README.md` explains how to build and where to put them). NDI is never bundled; it is loaded at run time through koffi.
- Test env flags: `PPT_OUTPUT_DUMP` (e2e state dump), `PPT_OMT_FAKE=1`, `PPT_NDI_FAKE=1|missing`, `PPT_ENGINE_FAKE=1` (FakeEngine instead of PowerPoint), `PPT_SHARE_USER_DATA` (data dir), `PPT_LIBOMT_DIR`.

## Architecture

Three Electron layers plus a shared core, all in `src/`:

- `src/shared/`: pure, tested logic shared by both processes. `program.ts` is the heart: a reducer over `ProgramState` (`deckId/index`, `shown` = what is on the output, `frozen/black/kv`, `take`, `webHold`, canvas, ...) with an `Action` union. `types.ts` (DeckMeta, SlideMeta, `Playback`), `canvas.ts`, `audio-levels.ts`, `web.ts`, `omt.ts`, `playback.ts`, and `ipc.ts`.
- `src/shared/ipc.ts` is the single typed IPC contract: `Invoke` / `Send` / `Broadcast` channel maps, consumed by `src/preload/index.ts` (contextBridge `Api`) and registered in `src/main/index.ts` (about 1200 lines, the composition root). Add a channel in `ipc.ts` first, then main, then preload.
- `src/main/`: owns all state and side effects. `state.ts` (`AppState`) wraps the reducer and layers cross-cutting gates around it (web ready gate, K/B-off gate, `resumeWeb`, engine ready gate, key forwarding to a live web page); it returns the same object when an action is refused. `library.ts` stores events/decks/slides on disk (`events.json`, one folder per deck with `deck.json`, `NNN.png`, `original.<ext>`, `source.<ext>`, `source.pdf`); every `deckId` goes through a UUID check. `slide-protocol.ts` serves deck files to the renderer as `slide://<deckId>/<file>` and only whitelisted names. `import/` converts pptx/ppt (PowerPoint COM via `scripts/export-pptx.ps1`), pdf and video-folder decks; `import-queue.ts` serializes them.
- `src/renderer/`: one React bundle, three window roles chosen by hash/query in `main.tsx`: operator (`App.tsx`), output (`OutputView.tsx`, role `hdmi` or offscreen `omt`), and the web-deck Prepare window (`PrepareView.tsx`). `AppWindowRole` (`hdmi | omt | operator | prepare`) is how main validates IPC senders; reuse `appHandle` / `frameSenderAllowed` for new channels.
- Output rendering: `model.ts` `outputSource(...)` decides what the output shows from `ProgramState` (precedence: Black, KV, web stream, native desktop stream, vector PDF, video, image). `SlideLayers.tsx` + `layers.ts` render layers with a shared reveal/fade contract; image, `PdfLayer`, and `StreamLayer` (captured MediaStream) all follow it. Rule everywhere: **never black, never desktop**. Any failure (page lost, engine down, capture down, unrenderable PDF page) falls back to the PNG of the same slide or holds the last good frame.

### Subsystems that span several files

- **Network output (OMT + NDI)**: one offscreen renderer and one frame clock feed both senders (`src/main/omt/`, `ndi/`, `net/`, `net-output.ts`). Native libraries are loaded with koffi bindings; `fake-binding.ts` stands in for tests. The Canvas size is the picture size; fps is shared.
- **Canvas and audio**: output has a Canvas size (per machine, optional per-event override) and slides are drawn into it and scaled to the window. Sound = deck volume x master volume through `OutputAudio` (Web Audio gain node). Exactly one window plays sound on this PC.
- **Web decks** (`src/main/web/`, `renderer/.../stream*.ts`, `web-pages.ts`): each web deck is one hidden page whose frames and sound are captured into every output and the monitor. Ready gate before take; HOLD (keeps last good frame) on failure; Reload/Back/Forward/Edit URL go to HOLD first, then navigate.
- **Native slideshow** (`src/main/slideshow/`): `SlideShowManager` drives a `SlideShowEngine` (`PowerPointEngine` spawning `native/ppt-bridge` on Windows, `FakeEngine` elsewhere) from committed reducer state, dispatches `enginePosition` after every navigation (engine position wins over reducer state), and heartbeats (1000 ms ping, 3000 ms = hung -> `nativeFallback` and background restart). `manager.ready()` feeds `AppState`'s `engineReady`, and must be false whenever the engine is down or has fallen back. The window is captured with `desktopCapturer` (`capture.ts`) into `StreamLayer`; PowerPoint sound comes through a named pipe (`audio-pipe.ts`) into an AudioWorklet. `DeckMeta.playback` is `native | vector | images` (missing = images; PDF is never native). `editor.ts` handles Edit in PowerPoint / Revert (`original.*` is never modified; edits to a live deck stay pending until it leaves air).
- The bridge never kills a `POWERPNT.EXE` it did not start (the operator may have their own files open), and it does not auto-kill a hung one it started either.

## Working in this repo

- Specs live in `docs/superpowers/specs/`, plans in `docs/superpowers/plans/`, and status/handoff notes in `docs/superpowers/notes/` (start with `2026-10-27-roadmap-handoff.md`). `docs/test-checklist.md` holds the field checks the user runs on Windows; Windows-only behavior is often implemented but unverified, and the docs say so.
- Plans are executed by subagents: model `sonnet`, effort `medium`; escalate to `opus` when stuck or after a failed review. UI tasks load the `impeccable` skill and follow `DESIGN.md` / `PRODUCT.md`. Check Context7 docs before using Electron, koffi, pdf.js, Web Audio, `desktopCapturer`, Vitest or Playwright APIs.
- If a task fails more than 3 times (including after escalating to Opus), stop and report the task, file, command and error instead of retrying.
- Commits use `git -c user.name="Gerson Sebastian" -c user.email="sebastiangerson24@gmail.com" commit ...` (no git identity is configured on this machine). Stage only your own files. Do not commit native build output, OMT binaries, or `.superpowers/` (a gitignored scratch workspace for subagent-driven plan runs).
