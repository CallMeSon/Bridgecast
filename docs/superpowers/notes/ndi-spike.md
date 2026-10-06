# NDI spike (Task 8): how PPT Share sends NDI

**Decision:** use **[grandi](https://github.com/tux-tn/grandi) 2.0.2**. It is an N-API binding for the NDI 6 SDK and is used in-process in Electron's main process.

The prebuilt package `@grandi/win32-x64` ships two things side by side: `grandi.node` and the NDI runtime itself (`Processing.NDI.Lib.x64.dll`, **NDI 6.3.2.0**).

- Nothing is compiled, so it needs no MSVC, .NET SDK or electron-rebuild.
- Because it is N-API, the addon loads in Electron 39 without a rebuild.
- The app works even when NDI Tools is not installed.

Only `src/main/ndi/grandi-sender.ts` imports grandi. Everything else goes through the `NdiSender` interface in `src/main/ndi/sender.ts`.

## What this machine has (2026-10-06)

The task said NDI Tools was installed. **On this PC it is not:**

- No `C:\Program Files\NDI`.
- No `NDI_RUNTIME_DIR_V5`/`V6` or `NDILIB_REDIST_FOLDER` environment variables.
- No `HKLM\SOFTWARE\NDI` registry key.
- A full scan of C:\ found only two `Processing.NDI.Lib.x64.dll` files: Skype's private copy, and grandi's.
- NDI Studio Monitor is therefore not available either.

Toolchains:

- **No MSVC / Windows SDK.** `Program Files\Microsoft Visual Studio\18` holds no VC tools, and vswhere is missing.
- **No .NET SDK.** Only the runtimes are installed: 6.0.36, 8.0.17 and 9.0.7.
- **MinGW gcc 6.3.0 is 32-bit only** (`mingw32`, i586).
- Node 22.15.0; Electron 39.8.10 (whose Node is 22.22.1).

So neither a source build of a native binding nor a C/C#/C++ sidecar could be built here without installing system software.

## Candidates considered

| Option                                                            | Result                                                                                                                                                                                                                     |
| ----------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `grandiose` 0.0.4 (Streampunk)                                    | Last published 2018; `node-gyp` build only. **Rejected:** needs MSVC, and it is unmaintained.                                                                                                                              |
| `@stagetimerio/grandiose` 0.2.0                                   | Install script downloads the SDK and then runs `node-gyp rebuild`. **Rejected:** needs MSVC.                                                                                                                               |
| `@vygr-labs/ndi-node` 1.0.0                                       | `node-gyp rebuild`, GPL-3.0. **Rejected:** needs MSVC, and the licence does not fit.                                                                                                                                       |
| `koffi` 3.3.2 (FFI with prebuilds) + `Processing.NDI.Lib.x64.dll` | Would work, but it needs an NDI runtime DLL (none is installed here) and hand-written struct layouts. Kept as the fallback plan.                                                                                           |
| Sidecar exe reading BGRA from stdin                               | No compiler on this PC. It would also cost an extra 8–33 MB copy per frame through a pipe (up to about 2 GB/s at 4K60). **Rejected.**                                                                                      |
| **`grandi` 2.0.2** (tux-tn)                                       | Apache-2.0, TypeScript types. Released 2026-07-30 (2.0.0 was 2026-07-23). It has CI, Electron docs and an Electron test. It uses `node-gyp-build` and falls back to the `@grandi/<platform>` prebuilt package. **Chosen.** |

## Evidence (spike scripts run with `ELECTRON_RUN_AS_NODE=1 npx electron …`, i.e. Electron 39's Node)

- `grandi.version()` gives `NDI SDK WIN64 16:38:09 Apr 14 2026 6.3.2.0`, and `isSupportedCPU()` returns true.
- A sender named "PPT Share Spike" appeared as **`GERSON-LAPTOP (PPT Share Spike)`** (`10.8.121.146:5961`). A receiver in the same process got a 1920×1080 frame, FourCC BGRA, 30/1, stride 7680, with the exact colour sent ([32,128,224,255]). `connections()` was 2.
- The same test passed under plain Node 22.15.
- The LAN also showed `DESKTOP-F0GSRI5 (Arena - Composition)` (Resolume) and `ROG002-DOH (vMix - Output 4)`. Real consumers can see sources from this PC.
- Send cost (`sender.video()`, worker thread):

  | Resolution | Median       | Worst                           |
  | ---------- | ------------ | ------------------------------- |
  | 1920×1080  | 2.9–3.2 ms   | 4.5 ms p95, about 30 ms outlier |
  | 3840×2160  | about 5.3 ms | about 21 ms                     |

  In the app it measured 3.6 ms average at 1080p and 5.5 ms average at 4K/60.

- **Name collisions:**
  - NDI does _not_ add a suffix to a duplicate name on the same host. `NDIlib_send_create` simply fails ("Failed to create NDI sender."), both inside one process and across two processes.
  - The app reports this as `Nama source "X" sudah dipakai di komputer ini …`. The e2e test checks it with a real second sender.
  - Within one process, a sender that is being destroyed can block its own name for a moment, so creation is retried 5× every 200 ms.
- **Missing runtime:**
  - With the bundled DLL renamed, the app shows `Runtime NDI tidak ditemukan. Pasang NDI Tools dari ndi.video lalu mulai ulang aplikasi.` with a red header dot.
  - With `NDI_RUNTIME_DIR_V6` pointing at a folder with the DLL (which is what NDI Tools sets), the app finds it through `PATH` and runs (green).
- `scripts/ndi-verify.mjs` (`npm run verify:ndi`) repeats all of this end to end. See the Task 8 report for its output.

## Main-thread cost at 3840×2160 (final gate, 2026-10-06, display scale 1.12)

- Per **painted** frame (offscreen `paint` → `toBitmap()` → `cropOrPad` to 3840×2160): **23–35 ms avg, up to ~54 ms max** (window 3429×1929 DIP, painted 3842×2162, mode `cropPad`). At 1080p the same path costs ~7.4 ms.
- Paints only happen when the picture changes (slide change, Fade, Black/Freeze). A static slide is re-sent by the FrameRepeater with **no** per-frame main-thread copy, and the NDI send itself runs on a worker thread (5.6–8.2 ms avg round trip).
- Consequence: at **4K/60 during a Fade** the main thread cannot paint every frame (budget 16.7 ms), so the transition is shown at a lower effective rate; the NDI source still runs at 60 fps by repeating the last frame. 1080p/30 (the default) is well within budget.
- The very first send after a sender is created can take ~2 s (NDI warm-up on the worker); frames during it are dropped and counted, not queued.

## How grandi sends, and the decisions built on it

Read from `lib/grandi_send.cc` at v2.0.2:

- `sender.video(frame)` runs the synchronous `NDIlib_send_send_video_v2` on a libuv worker thread (napi async work). It holds a napi reference to the `data` Buffer until the send completes, then resolves.
  - **Effect:** the main thread never blocks on NDI encoding.
  - The Buffer stays alive for the duration of the send.
  - We keep **one send in flight**. Frames that arrive meanwhile are dropped and counted, never queued, so two sends never race on one sender instance.
  - Buffers are never mutated after creation. Each paint makes a fresh Buffer, and the repeater only re-sends it.
  - The async NDI API (`send_video_async_v2`, where the buffer must stay untouched until the next call) is not used.
- `sender.destroy()` is safe while a send is in flight. grandi reference-counts the handle and calls `NDIlib_send_destroy` after the last send finishes.
- **Timecode:** left out, so grandi passes `NDIlib_send_timecode_synthesize`.

## Frame settings

- **FourCC BGRX.** Chromium's offscreen paint is BGRA with an opaque alpha. BGRX tells NDI there is no alpha: there is no alpha plane to encode, and vMix/Resolume do not treat the source as keyable.
- **Frame rate 30/1 and 60/1, exactly** (not 30000/1001):
  - The FrameRepeater produces exactly 30 or 60 frames per second on average.
  - Advertising 29.97 while delivering 30 would make every receiver drop a frame every ~33 s.
  - vMix and Resolume both frame-sync NDI inputs to their own clock, so an integer rate is the honest one.
- **Progressive, `picture_aspect_ratio` = width/height** (16:9), and `line_stride` = width×4.
- **`clock_video: false`:**
  - The FrameRepeater already paces frames.
  - With NDI clocking on as well, each send would block for up to a frame period. Combined with the single in-flight slot, that would drop frames: double pacing.
  - The repeater's Windows timer jitter (≤15 ms) is absorbed by the receivers' frame sync and the synthesized timecode.
- **One sender per app instance:**
  - A **resolution or fps change keeps the same NDI sender**, because receivers follow format changes. The NdiPipeline builds the new offscreen window beside the old one and only switches when the new one sends its first frame (3 s timeout). The source never goes dark: in the e2e test, 4K arrived 720 ms after Terapkan with no gap longer than 80 ms.
  - A **name change** destroys the old sender and creates a new one.
- **Quit:** `before-quit` calls `pipeline.shutdown()`, which stops the output windows and destroys the sender. `grandi.destroy()` (`NDIlib_destroy`) is not called, because process exit releases it and calling it while a deferred sender destroy is pending would race.

## How the source appears to users

NDI always shows `COMPUTERNAME (source name)`, for example **`GERSON-LAPTOP (PPT Share)`**. The popover prints the real name once it is running ("Mengirim sebagai …").

The name must be unique on the PC. A second PPT Share on the same PC needs a different source name.

## Packaging requirements (for Task 10)

- Keep `grandi` in `dependencies` (it is), and do not use `--no-optional`. `@grandi/win32-x64` is an optionalDependency that carries the addon and the DLL.
- electron-vite already keeps `import("grandi")` external in `out/main/index.js`. Do not bundle it.
- In `electron-builder.yml`, unpack the whole packages, not only `grandi.node`, because the DLL must sit beside the addon:
  ```yaml
  asarUnpack:
    - resources/**
    - node_modules/grandi/**
    - node_modules/@grandi/**
  ```
  `node-gyp-build` (pure JS) can stay in the asar.
- `npmRebuild: false` is already set. N-API needs no rebuild, but the build must run on/for **win32-x64**, so the x64 optional package gets installed.
- The installer grows by about 30 MB (the NDI DLL is 29.9 MB).
- **NDI licence:**
  - Ship `node_modules/@grandi/win32-x64/libndi_licenses.txt` (it says it "should be included with all distribution of the binary files"). `LICENSE.pdf` is the NDI SDK licence, at https://ndi.link/ndisdk_license.
  - The NDI SDK licence also asks for NDI® trademark attribution and a link to https://ndi.video in the about box or docs. The popover already shows "NDI® adalah merek dagang terdaftar milik Vizrt NDI AB."
  - Task 10 should add the link and the licence file to the about/README, and confirm the remaining SDK licence terms (for example the EULA terms).
- Test the **packaged** app on a PC **without** NDI Tools. The NDI status must turn green, and the source must be visible in vMix/Resolume.
