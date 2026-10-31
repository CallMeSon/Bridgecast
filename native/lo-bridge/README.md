# lo-bridge

`bridge.py` drives LibreOffice Impress for the native slide show and the PowerPoint import on
Linux (spec `docs/superpowers/specs/2026-10-27-libreoffice-linux-design.md`). Python 3 with
`python3-uno`; no other dependency (X11 calls use `ctypes`). It speaks the **same JSON-lines
protocol as `ppt-bridge`** (`native/ppt-bridge/README.md`, parser `src/main/slideshow/bridge-protocol.ts`),
so `SlideShowManager` is unchanged; the engine is `src/main/slideshow/libreoffice-engine.ts`.

```bash
python3 native/lo-bridge/bridge.py --profile <dir> [--pulse-sink pptshare_lo] [--soffice /usr/bin/soffice]
python3 -m unittest native/lo-bridge/test_steps.py     # unit tests of the click counter
```

## Differences from ppt-bridge

- `open` reply: `windowId` is the **X11 window id** (decimal) of the Impress window that shows the
  slide show; `audio` is always `device` (the sound goes to `PULSE_SINK`, handled by the app).
  `setVolume` replies `applied: ignored` (the level is applied in the output window).
- `import` (see `import-command` below): `{ path, outDir, format }`.
- `edit` opens `libreoffice --impress <file>` with the **user's normal profile** (their window).
- There is no `app` event; no kill of anything except the `soffice` of this bridge.

## How it works (see `docs/superpowers/notes/libreoffice-spike.md`)

- One `soffice` per bridge: `-env:UserInstallation=<profile> --norestore --nologo --nodefault
  --accept=pipe,name=pptshare-<bridge pid>;urp;` with `SAL_USE_VCLPLUGIN=gen` (the gtk3 plugin
  deadlocks when a video ends) and `GDK_BACKEND=x11`, plus `PULSE_SINK` when given. The user's own
  LibreOffice is never touched. The bridge kills only the soffice found by its unique pipe name, and
  a stale soffice of an earlier run that still holds the **same app profile** (after a crash of the
  bridge).
- A hidden document cannot present: the deck is opened read-only and visible, its toolbars and menu
  are hidden, the window is sized to the Canvas and asked (`_NET_WM_STATE`) to stay out of the taskbar
  and below other windows. `IsFullScreen=false` presents inside that window, whose X id is read with
  `XSystemDependentWindowPeer` and captured by the app like the PowerPoint window.
- Navigation: `gotoNextEffect`, `gotoPreviousEffect`, `gotoSlideIndex`. Impress has no click index:
  `steps.py` counts the effects the bridge sends and is corrected by the slide the show reports (a
  poll every 100 ms; auto advance, After Previous and clicks in the window are seen the same way). The
  engine position wins in the app. A `next` past the last click of the last shown slide is a no-op
  (it would end the show). A show that ended unexpectedly sends `error`.
- `ping` is answered by the reader thread unless a UNO call has been stuck for more than 1 s
  (`open`/`edit` 30 s, `import` 300 s). The app falls back to still images after 3 s without answer.
- Closing stdin closes the shows, terminates the soffice (then kills it) and exits within 8 s.
