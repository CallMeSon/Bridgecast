# Web source spike: results (2026-10-27)

Scope: Task 1 of `docs/superpowers/plans/2026-10-27-web-source.md`. Throwaway code lived in the session scratchpad and is not committed.

Environment: Linux x64, 4 vCPU Xeon @ 2.8 GHz, 16 GB RAM, Electron 45.0.0, run with `xvfb-run -a -s "-screen 0 3840x2160x24" npx electron --no-sandbox main.js`. There is no GPU (software rendering) and no audio device, so all CPU, RAM and latency numbers are pessimistic. Windows has not been tested (checklists below).

Docs check (Context7, Electron): `webContents.getMediaSourceId(requestWebContents)` returns an id valid for 10 seconds and only for the requesting WebContents. In Electron 45, `chromeMediaSource: 'desktop'` now rejects WebContents ids ("Invalid state"), so `'tab'` is the supported route. Alternative documented route: `ses.setDisplayMediaRequestHandler` returning `{ video: webFrameMain, audio: webFrameMain, enableLocalEcho }` (not needed, see below).

## Verdict

| Step | Result |
|---|---|
| 1 Tab capture of a hidden window | PASS |
| 2 Sound with `setAudioMuted(true)` | PASS (audio is in the stream muted or not) |
| 3 Input, local form page | PASS (with one caveat, see below) |
| 3 Canva and Google sign-in | NOT RUN (needs the user, checklist below) |
| 4 Latency, CPU, RAM | MEASURED (pessimistic, software GL) |
| 5 Windows occlusion | NOT RUN (checklist below) |
| 6 Gate | Steps 1 and 2 pass, so the gate is open |

## Working constraints (shape for `tabConstraints` in Task 5)

Main process: `const id = hiddenWin.webContents.getMediaSourceId(visibleWin.webContents)` (call it just before use, valid 10 s). Renderer of the visible window:

```js
navigator.mediaDevices.getUserMedia({
  video: { mandatory: {
    chromeMediaSource: 'tab', chromeMediaSourceId: id,
    maxWidth: 1920, maxHeight: 1080, maxFrameRate: 30
  } },
  audio: { mandatory: { chromeMediaSource: 'tab', chromeMediaSourceId: id } }
})
```

Notes on the shape:
- Both `video` and `audio` need `chromeMediaSource: 'tab'` and the same `chromeMediaSourceId`. Drop the `audio` key to get video only.
- The resulting track settings were exactly `width 1920, height 1080, frameRate 30` (and `frameRate 60`, delivered about 50 fps, with `maxFrameRate: 60`; 3840x1080 gave `width 3840, height 1080`). `resizeMode` is `crop-and-scale`.
- With audio requested the video track `deviceId` is `web-contents-media-stream://N:1?local_echo=false`, i.e. Chromium itself stops the tab from playing locally while it is captured (no echo).
- The visible window needs `nodeIntegration` or a preload to ask main for the id; the spike used `ipcRenderer.invoke` to main, which calls `getMediaSourceId` with the requesting webContents.
- Capture needs no user gesture and no permission handler in Electron 45.

## Step 1: tab capture of a hidden window (PASS)

Hidden `BrowserWindow` 1920x1080 (`show:false`, `paintWhenInitiallyHidden:true`, `webPreferences.backgroundThrottling:false`, `useContentSize:true`), `isVisible()` false throughout. The visible window received a 1920x1080 stream; 25 of 25 samples over 1.5 s had distinct frame contents (moving picture). Same at 3840x1080.

Surprising findings:
- A hidden window does not render at all until it is captured. 3 hidden 1080p pages with an animation and no capture used 0.9 percent CPU; with capture 39.8 percent (summed over all Electron processes). So capture is what drives painting, which is what we want.
- Window size is clamped to the X screen. With the default xvfb screen (1280x1024) a requested 1920x1080 hidden window became about 1280x1024 with scrollbars, and the capture was stretched or pillarboxed into 1920x1080. Task 5 should call `setContentSize` and verify `getContentSize()`, and Windows must be checked for the same clamp on a small display (checklist below).
- Hidden window without capture and `wheel`: scrolling was lazy or missing (see Step 3).

## Step 2: sound (PASS)

Page audio was tested two ways: WebAudio oscillator and an `<audio>` element playing a generated WAV (the media element path YouTube uses). The visible window measured RMS from the captured audio track with an `AnalyserNode`.

| Source | `setAudioMuted(true)` | Audio track present | RMS in captured stream |
|---|---|---|---|
| WebAudio | no | yes | 0.212 |
| WebAudio | yes | yes | 0.212 |
| `<audio>` element | no | yes | 0.194 |
| `<audio>` element | yes | yes | 0.194 |

So the captured stream carries the sound with and without `setAudioMuted(true)`: tab capture taps the audio before the mute. No alternative is needed for the stream. Not verified here (no audio device under xvfb): whether the sound is really silent on the local speakers with or without `setAudioMuted(true)`. Given `local_echo=false` it should be, so `setAudioMuted(true)` is a belt-and-braces call; the user should listen on Windows (checklist).

## Step 3: input

Local form page in a hidden window, `webContents.sendInputEvent`, events recorded in the page with `isTrusted` true (all trusted).
- Click (`mouseMove`, `mouseDown`, `mouseUp`, `clickCount:1`): the button received `click`. PASS.
- Typing: per character `keyDown`, `char`, `keyUp` with `keyCode` set to the character. The input field value came out right, including the capital H and punctuation ("Hello, 123"). The `keydown` `key` is lowercase for a capital letter (no shift modifier sent); the typed text is still correct because the `char` event carries it. PASS.
- Special keys: Electron key names are `Backspace`, `Enter`, `Left`, `Right`, `Down`, `PageDown` etc. (not `ArrowRight`); the page saw `ArrowRight`, `ArrowLeft`, `ArrowDown`, `PageDown`, `Enter`. Use the Electron names in Task 6's key map. PASS.
- Wheel: `{ type:'mouseWheel', x, y, deltaX:0, deltaY, wheelTicksY, canScroll:true }`. Negative `deltaY` scrolls down (300 px of delta moved the page about 300 px). Works when the hidden window is being captured (scrollY 501 to 801 and back as expected) and when the window is shown. Without an active capture the hidden window scrolled late or not at all (compositor is idle). Not an issue in production because the window is always captured, but do not test input on an uncaptured hidden window.
- `webContents.focus()` was called before keyboard input; keep that in the implementation.

### Canva and Google sign-in (user to run, unchecked)

- [ ] Open the Canva sign-in page in the hidden web source window with the Chrome user agent; sign in by email (type email and the code or password via the forwarded keyboard from the visible window). Record: does it sign in? any captcha?
- [ ] Open a Canva design and click Present (via forwarded mouse). Record: does the picture appear in the output window?
- [ ] In present mode press Right/Left arrow (forwarded). Record: do the slides advance and go back?
- [ ] Open `accounts.google.com` with the Chrome user agent in the same web source. Record: does the sign-in page load, or do you get "This browser or app may not be secure"?
- [ ] If Google sign-in is blocked, note the exact message and whether signing in through a Google button inside Canva works.
- [ ] Close and reopen the app: is the session still signed in (persistent partition)?

## Step 4: measurements (Linux, xvfb, software GL: pessimistic)

Test page: full-size canvas animated on `requestAnimationFrame`, a 100 px moving box, plus a 32-block binary timestamp of `Date.now()` drawn on every frame. The visible window decodes the timestamp from each video frame in `requestVideoFrameCallback` and subtracts it from `Date.now()`. Latency is page draw to frame shown in the capturing window (it includes capture, scaling and decode; it does not include the later OMT or HDMI output stage).

Single capture, hidden window, 30 fps cap:

| Size | n frames | min | median | p95 | max |
|---|---|---|---|---|---|
| 1920x1080 | 120 | 36 ms | 45 ms | 55 ms | 63 ms |
| 3840x1080 | 111 | 54 ms | 82 ms | 105 ms | 132 ms |
| 1920x1080, `maxFrameRate: 60` | 202 (about 50 fps delivered) | 38 ms | 49 ms | 67 ms | 82 ms |

Three hidden pages captured at once (CPU is the sum of all Electron processes in `app.getAppMetrics()`, in percent of one core; RAM is the summed working set; 4 vCPU machine; the visible window plays 3 videos at 320 px wide; 30 fps cap):

| Pages | No capture, idle | CPU captured | RAM captured | Latency of page 0 while 3 run (median / p95) |
|---|---|---|---|---|
| 3 x 1920x1080 | 0.9 percent, 836 MB | 39.8 percent | 1227 MB | 151 ms / 200 ms |
| 3 x 3840x1080 | 1.3 percent, 954 MB | 37.8 percent | 1626 MB | 292 ms / 328 ms |

Caveats: the figures are for a synthetic canvas, not real sites (video-heavy or WebGL pages cost more). The 3840x1080 case delivered 17 distinct frames per 24 samples in the motion check, so it is already near the limit of software rendering. Latency with 3 pages is a lot higher than with one, and the 3 x 3840 case is about 300 ms; expect a real GPU to be considerably better but this has to be confirmed on Windows.

## Step 5: Windows occlusion checklist (user, unchecked)

Run the same spike, once with default flags and once with `--disable-features=CalculateNativeWinOcclusion`. For each run record pass or fail and notes.

- [ ] Hidden window (`show:false`) captured into the visible window: moving picture, 1920x1080. Default flags: ___ . With the flag: ___ .
- [ ] Same with the hidden window shown but fully covered by another maximised window (occlusion): does the picture freeze? Default: ___ . With flag: ___ .
- [ ] Same with the hidden window minimised, then restored. Default: ___ . With flag: ___ .
- [ ] Same with the display locked or turned off for 1 minute, then unlocked (the presenter case). Default: ___ . With flag: ___ .
- [ ] A 3840x1080 hidden window on a display narrower than 3840: is the content size clamped (`getContentSize()` before capture)? Does capture still deliver 3840x1080?
- [ ] Audio: play a YouTube video in the hidden window with `setAudioMuted(true)`. Is it silent on the local speakers? Is the sound in the captured stream (check the output window or OBS)? Repeat without `setAudioMuted`.
- [ ] Moving picture test (the spike's animated page) for 5 minutes: any freeze, flicker or frame-rate drop? Note CPU and GPU use in Task Manager with 1 and 3 pages.
- [ ] Latency check with the timestamp page on the real machine: median and p95 for 1 page and 3 pages at 1920x1080 and 3840x1080.

## Anything else worth knowing

- Use the 10 second validity of the media source id: request it right before `getUserMedia`, and request a new one on every re-capture (after page crash or reload).
- The `desktop` source is not an alternative in Electron 45 for WebContents ids. Only `tab` (or `setDisplayMediaRequestHandler`) works.
- The Linux X screen size limits the hidden window size; the same may hold for a real monitor setup.
