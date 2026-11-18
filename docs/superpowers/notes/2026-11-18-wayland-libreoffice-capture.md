# Wayland: LibreOffice slide show capture (2026-11-18)

Question: on a Linux Wayland session native decks play as still images (`platform.ts` returns
`canCapture: false` + `WAYLAND_STILLS`). Hypothesis tested: the Impress slide show window is a
Wayland-native window, and launching `soffice` through Xwayland would make it capturable.

**Result: the hypothesis does not hold as stated.** The LibreOffice side is already X11; what blocks
capture is the Electron side (its window capturer picks PipeWire on a Wayland session even when
Electron itself runs on X11). **Implemented the same day** (see "Implemented" at the end): the app
says `XDG_SESSION_TYPE=x11` to its own capture and native decks play under Wayland.

Environment: Zorin OS 18.1, GNOME, real Wayland session (`XDG_SESSION_TYPE=wayland`,
`WAYLAND_DISPLAY=wayland-0`, `DISPLAY=:0`, `/usr/bin/Xwayland`), LibreOffice 26.8.2.2,
`python3-uno`, Electron 45.2.3. Probe: a throwaway Electron script (not committed) that starts
`native/lo-bridge/bridge.py` unchanged, opens `fixtures/sample-anim.pptx`, calls
`desktopCapturer.getSources({ types: ['window'] })` and grabs frames from the matching source with
`getUserMedia({ chromeMediaSource: 'desktop' })` + `ImageCapture.grabFrame()`. Electron always ran
with `--ozone-platform=x11`, as the app does after its X11 relaunch. Sound went to a temporary null
sink.

## Facts

1. **`soffice` from the bridge is already an X11 (Xwayland) window.** `bridge.py`
   (`Office.ensure`) sets `SAL_USE_VCLPLUGIN=gen` and `GDK_BACKEND=x11` for its soffice only (since
   the 2026-10-31 spike, finding 4). The bridge returned `windowId 33554455`; `xwininfo -id` shows
   it mapped (`IsViewable`, 1920x1016), `xprop` shows `WM_CLASS "libreoffice", "libreoffice-impress"`
   and `_NET_WM_STATE_BELOW/SKIP_TASKBAR/SKIP_PAGER` set by the bridge.
2. **Without that env the window is Wayland-native.** `soffice --view sample-anim.pptx` with the
   default VCL plugin (gtk3): no `LibreOffice Impress` window in `xwininfo -root -tree`. With
   `SAL_USE_VCLPLUGIN=gen GDK_BACKEND=x11`: the client window (`libreoffice`) and its
   `mutter-x11-frames` parent are listed. So "launch soffice through Xwayland" is what the bridge
   already does.
3. **The app's current env (`XDG_SESSION_TYPE=wayland`, Electron on ozone x11):
   `desktopCapturer.getSources({ types: ['window'] })` did not return within 20 s** (PipeWire /
   ScreenCast portal path; a GNOME share dialog may appear). No `window:<xid>:` source, so the
   output could only show stills. Today the app never gets there: with `canCapture: false` the
   manager opens no slide show.
4. **With `XDG_SESSION_TYPE=x11` in the Electron process (`WAYLAND_DISPLAY` kept as is), capture
   works on this Wayland session.** `getSources` answered in about 20 ms with
   `window:33554455:0 "sample-anim.pptx (read-only) — LibreOffice Impress"` (only X11 windows are
   listed; Wayland-native apps are not). Frames were 1920x1016 with the real slide; a `next` showed
   "Bullet 1" appear (on-click animation captured). The window sat below other windows
   (`_NET_WM_STATE_BELOW`) and was still captured. It worked both when the variable was set in the
   environment Electron was started with and when the main script set
   `process.env.XDG_SESSION_TYPE = 'x11'` at its top, before `app` was ready.
   Reason: WebRTC's `DesktopCapturer::IsRunningUnderWayland()` reads `XDG_SESSION_TYPE` (and
   `WAYLAND_DISPLAY`) from the environment and then picks the PipeWire capturer; `--ozone-platform`
   does not change that. The 2026-10-31 spike (finding 5) saw the same with
   `XDG_SESSION_TYPE=x11 WAYLAND_DISPLAY=`; `WAYLAND_DISPLAY` does not have to be cleared.
5. **Video picture still missing** (same as spike finding 7, so also on X11 sessions): on the video
   slide the capture shows the slide with an empty white area where the video is, and four frames
   400 ms apart are identical. GStreamer draws the video in a child X window that the capture does
   not include.
6. The first frame grabbed right after `open` still showed the editing view (Navigator, status bar)
   with a black 1280x720 block at the top left; later frames were the slide show. The pointer was
   visible in the probe frames (the probe did not ask for `cursor: 'never'`). Both apply to X11
   sessions as well; not looked into further.

## What would make it work (the proposal; implemented as described in "Implemented")

- Early in `src/main/index.ts` (before the first `desktopCapturer` call, best at the top level next
  to the X11 relaunch), on Linux when Electron runs with `--ozone-platform=x11` in a Wayland session
  with `DISPLAY` set: remember that the session is Wayland, then set
  `process.env.XDG_SESSION_TYPE = 'x11'`. Running `npm run dev` passes the flag itself (no
  relaunch), so this cannot live only in the relaunch path.
- `detectEngine` would then need an explicit "Electron captures through X11" input instead of
  reading `XDG_SESSION_TYPE` (after the switch it reads `x11`): Wayland + X11 capture means
  `canCapture: true`; Wayland without Xwayland (`DISPLAY` unset) keeps `WAYLAND_STILLS`. At run time
  `slideshowSourceId` already rejects with `SOURCE_NOT_FOUND` when the window is not listed, and the
  output then shows the PNG (never black, never the desktop).
- Side effect to weigh: child processes inherit `XDG_SESSION_TYPE=x11` (lo-bridge, `pactl`,
  `xdg-open`, Edit in LibreOffice). GTK apps still choose Wayland from `WAYLAND_DISPLAY`, so the
  effect should be small; the original value could be passed back to those children.
- Still unverified: the app itself (`npm run dev`, packaged AppImage/.deb) on a Wayland session,
  two displays (HDMI), and a long show.

## Video codecs (GStreamer)

LibreOffice plays deck videos through GStreamer (`libavmediagst.so`). PowerPoint saves videos as
H.264/AAC MP4 (the fixture's `media1.mp4` is H.264 High + AAC LC). `libreoffice-core` only
*suggests* `gstreamer1.0-plugins-base/good/ugly/bad` and `gstreamer1.0-libav`, so
`apt install libreoffice-impress` does not bring a decoder. With the libav decoders taken out
(`GST_PLUGIN_FEATURE_RANK=avdec_h264:NONE,avdec_aac:NONE`) `gst-discoverer-1.0` reports
`Missing plugins` for both `H.264 (High Profile) decoder` and `MPEG-4 AAC decoder`, and `playbin`
plays nothing; with them it plays. Not tried inside LibreOffice itself.
`qtdemux` comes from `gstreamer1.0-plugins-good`. README now lists
`gstreamer1.0-plugins-good gstreamer1.0-libav`, and `deb.recommends` in `electron-builder.yml` lists
both.

## Implemented (2026-11-18)

- `platform.ts`: `x11CaptureEnv(platform, env, argv)` gives `{ XDG_SESSION_TYPE: 'x11',
  BRIDGECAST_SESSION_TYPE: 'wayland' }` on Linux when the session says `wayland`, `DISPLAY` is set and
  argv has `--ozone-platform=x11` (the relaunched process and `npm run dev` both have it).
  `index.ts` reads the session type first, then applies it at the top level, before `ready`.
  `detectEngine` takes the session's own `sessionType` plus `x11Capture`: Wayland + `x11Capture` is
  `canCapture: true`; Wayland without it keeps `WAYLAND_STILLS` (copy now says X11 through Xwayland
  or an X11 session). `childEnv(env)` gives children the session's own `XDG_SESSION_TYPE` back; the
  lo-bridge spawn uses it (soffice still forces `gen` + `GDK_BACKEND=x11` itself; Edit opens the
  user's LibreOffice with `wayland`). `shell.openExternal` (`xdg-open`) cannot take an env and sees
  `x11`; GTK apps still pick Wayland from `WAYLAND_DISPLAY`.
- `bridge.py`: `open` waits `SHOW_SETTLE_SECONDS` (1.0 s) after the show starts. Measured without
  it: frames showed the editing view with a black block for about 0.3 to 0.4 s after `open`
  answered; with it, the first frame is the slide (twice, with the app's `source.odp`).
- Real app on this Wayland session (built `out/`, Playwright, `--ozone-platform=x11`, real
  LibreOffice, fake HDMI display): main env `XDG_SESSION_TYPE=x11`, `BRIDGECAST_SESSION_TYPE=wayland`;
  `slideshowSourceId` -> `window:37748964:0`; `getSources` listed `Bridgecast` and
  `source.odp (read-only) — LibreOffice Impress`; the lo-bridge process has
  `XDG_SESSION_TYPE=wayland`; the HDMI output layer is the stream (1920x1080) from 300 ms after
  ready, animations (click bullets, After Previous) visible; Next walked `1:0,1:1,2:0,4:0` (hidden
  slide skipped) after the take-before-ready resume to `0:3`.
- Pointer: the standalone probe's frames showed the pointer although `cursor: 'never'` was asked
  (the X11 capturer draws the Xwayland pointer when its last position is over the slide show window
  and no other X11 window is on top there). In the real-app run the Bridgecast window (X11) covered
  that spot and no pointer showed. Not fixed; field check in docs/test-checklist.md.
- Under Xvfb without a window manager `getSources` lists no windows at all, so the output stays on
  the PNG poster there (seen in a pure-X11 Xvfb run): capture cannot be checked headless.
