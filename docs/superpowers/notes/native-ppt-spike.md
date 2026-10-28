# Native PowerPoint spike: results (template, fill in on Windows)

**Status: prepared but NOT run. The user skipped the Windows spike on 2026-10-28 (no Windows PC at hand).**

Scope: Task 1 of `docs/superpowers/plans/2026-10-27-native-slideshow.md`, checklist from `docs/superpowers/specs/2026-10-27-native-slideshow-design.md` section 6. Spike code lives in `~/ppt-spike/` (outside the repo, never committed): `bridge/` (C#, `spike-bridge.exe`) and `capture/` (Electron script).

Environment (fill in): Windows version ___, PowerPoint version/build ___, display(s) and scaling ___, GPU ___, Electron version ___.

Status: NOT RUN YET.

## 0. Before you start

### Make the fixture (once)

Create `fixtures/sample-anim.pptx` in PowerPoint (16:9) with these slides, in this order:

| # | Slide | How to make it |
|---|---|---|
| 1 | On Click bullets x3 | Title + 3 bullets. Animations tab: Appear (or Fade) on the text box, Effect Options "By paragraph", Start "On Click". Result: 3 clicks. |
| 2 | After Previous | One shape with Fade, Start "On Click"; a second shape with Fade, Start "After Previous". Result: 1 click, then the second shape appears alone. |
| 3 | Trigger animation | A button shape and a picture. Select the picture, add Fade, in Animation Pane click "Trigger" > "On Click of" > the button shape. Result: 0 counted clicks; the picture only shows after clicking the button with the mouse. |
| 4 | Morph | Slide 4 is a duplicate of slide 3 or 5 with the shapes moved/resized. Transitions tab > Morph on slide 4. |
| 5 | Hidden slide | Any content. Right click the slide > Hide Slide. |
| 6 | Video with sound | Insert > Video > a short clip with audible sound. Playback tab: Start "Automatically". |
| 7 | Plain slide | Title and text only, no animation, no transition. |

Save it, then copy it into the repo as `fixtures/sample-anim.pptx` (do not commit; the agent commits after the gate).

### Build the helper (once)

Use a Windows PowerShell. The helper was already built on Linux; if you copy `~/ppt-spike/` to Windows, delete `bridge/bin` and `bridge/obj` first and rebuild.

```powershell
# Option A: .NET SDK installed
cd ppt-spike\bridge
dotnet build -c Release
# result: bin\Release\net48\spike-bridge.exe

# Option B: no SDK, use the .NET Framework compiler that ships with Windows
cd ppt-spike\bridge
& "$env:WINDIR\Microsoft.NET\Framework64\v4.0.30319\csc.exe" /out:spike-bridge.exe /reference:Microsoft.CSharp.dll Program.cs
# (Option B needs a C# 5 compiler; if it complains about syntax, use Option A.)

cd ..\capture
npm install
```

### Run the helper

```powershell
# file, width px, height px, then options:
#   --dpi 96   screen scaling in DPI (125% = 120, 150% = 144)
#   --x N --y N   window position in pixels (use a large x, e.g. 5000, for off screen)
#   --tool   tool-window style (no taskbar, no Alt+Tab, no focus steal)
.\bin\Release\net48\spike-bridge.exe ..\..\fixtures\sample-anim.pptx 1920 1080 --dpi 96 --tool
```

It prints lines like `1234ms hwnd=1049870 ...` and `capture-id-contains window:1049870:`. Type commands then press Enter:

| Command | What it does |
|---|---|
| `next` | one click forward (same as clicker) |
| `prev` | one step back |
| `goto 4` | jump to slide 4 |
| `pos` | print `slide`, `clickIndex`, `clickCount` now |
| `quit` | close the show and the file |

Lines starting `evt` are position changes found by polling (After Previous, auto-advance, triggers). Lines starting `pos` are the check after each command, with `settleFromCmd` time. Note: PowerPoint events (`SlideShowNextClick`/`SlideShowNextSlide`) are not hooked in the spike, because late-bound COM events need the type library DispIds. The spike polls every 50 ms and verifies with `View.CurrentShowPosition`, `GetClickIndex()`, `GetClickCount()` instead. Record whether polling was enough or whether events are needed.

### Run the capture

In a second PowerShell, use the number after `hwnd=` (decimal):

```powershell
cd ppt-spike\capture
npx electron . 1049870 1920 1080 30     # HWND  width  height  fps
npx electron .                          # only list window sources
```

It lists every window source (`window:<hwnd>:...`), plays the one that matches, and logs track settings, video size and frames per second once a second.

## 1. Checklist (spec section 6)

Run in order. Item 1 is the gate. Write PASS / FAIL / PARTIAL plus the numbers in the Result column.

| # | What to check | Steps (plain English) | Result |
|---|---|---|---|
| **1 (GATE)** | The slide show window is captured completely at Canvas size, also bigger than the screen; it does not steal focus; it is not on the taskbar; Presenter View does not appear on the HDMI screen | a) Start the helper with `--tool` at 1920 1080, then the capture script with its HWND. Check the Electron window shows the whole slide, sharp, not black, and `video size` is 1920x1080. b) Click in another app (Notepad). Press `next` in the helper. Notepad must keep focus and typing must go to Notepad. c) Look at the taskbar and press Alt+Tab: the show window must not be there. d) With a second (HDMI) screen connected and extended, check Presenter View did not open on it. e) Try three window places: on the main screen behind your Notepad window; partly off screen (`--x 1500`); fully off screen (`--x 5000`). In each, does the capture still show the full slide, and does it keep updating after `next`? f) Canvas bigger than your screen: run `3840 1080` and `3840 2160` (screen smaller). Does the capture size equal the requested size, and no cropping? Note which window place works. If every place gives a black, frozen or cropped capture, item 1 FAILS. | |
| 2 | Click steps, position and `GetClickIndex` are accurate | Run `goto N`, then `pos`, then `next` one at a time on each fixture slide and write down `slide / clickIndex / clickCount` after each. Expected: slide 1 has 3 clicks (index 0,1,2,3, then next goes to slide 2); slide 2 count 1 and the After Previous shape appears by itself (`evt` line); slide 3 trigger does not count as a click, and a click on `next` leaves the picture hidden; slide 4 Morph plays and moves to slide 5 or skips; slide 6 video starts by itself; `prev` from a slide start goes back. Fill in a small table: slide, action, expected, got. Also state: does the hidden slide get skipped by `next`? Is `clickCount` correct for slides 2 and 3 (spec expects them to differ from what the engine assumes)? | |
| 3 | Audio through process loopback while the real sound is muted | This item needs the real bridge (WASAPI process loopback), which the spike does not contain. For the spike, only check the basics: play slide 6 and confirm the video sound is heard on the default device, and that you can set the PowerPoint app volume to 0 in Volume Mixer while the picture keeps playing. Write down your Windows build (process loopback needs 10 version 2004 or later, `winver`). Failing here only selects the audio fallback (`ISimpleAudioVolume`), it does not stop the project. | |
| 4 | Latency from click to output | Put the capture window next to a phone camera or screen recorder at 60 fps, or compare the `evt`/`pos` timestamps with a screen recording: press `next` on slide 1 and measure the time until the new bullet shows in the Electron window. Do it 5 times. Write min / typical / max in ms. Also write the capture `fps~` value while a video plays. | |
| 5 | Two sessions open at the same time, and switching | Start two helpers at the same time on two terminals (use `sample-anim.pptx` and `fixtures/sample-4x3.pptx`), each at 1920 1080. Do both open? Does each capture show its own deck? Which window title does each get? Is PowerPoint stable and is the CPU/RAM acceptable (note Task Manager values for POWERPNT.EXE)? Then close one and check the other keeps running. If PowerPoint refuses two show windows, write the exact error. | |
| 6 | Protected View does not appear | Download the fixture from the internet or e-mail (or copy it so it has a Mark of the Web: right click > Properties shows "Unblock"), then run the helper on it. The helper removes the `Zone.Identifier` stream. Expected: no yellow Protected View bar, the show runs. Write what happened. | |
| 7 | The operator's own PowerPoint is open at the same time | Open another pptx yourself in PowerPoint and keep it open (also try the same file `sample-anim.pptx`). Start the helper. Expected: your file is not closed or changed, your PowerPoint window does not jump to the front, `quit` in the helper closes only the helper's file and PowerPoint keeps running with your file. Then end the helper with Ctrl+C and check whether anything is left over (hidden POWERPNT.EXE, locked file). Do not use Task Manager to kill POWERPNT.EXE while it holds your own file. | |
| 8 | Static detection and PDF export | In PowerPoint, with the fixture open, check by hand: which slides count as animated (1, 2, 3), transition other than None (4), media (6), and slide 7 as static. Then export PDF with File > Export > PDF (or `ExportAsFixedFormat`) with the option to include hidden slides on, and open the PDF. Expected: 7 pages (hidden slide included, so page number = slide number), fonts look the same. Also test `fixtures/sample-4x3.pptx`: it should be detected as static. Note any slide where the checks disagree with what you see. | |

## 2. Decision

- Gate (item 1): ___ (PASS / FAIL). FAIL = stop, go back to brainstorming, do not write more plan tasks.
- Window place that works (behind, off screen, other): ___
- Item 3 outcome: process loopback / fallback `ISimpleAudioVolume`: ___
- Polling enough for positions, or events needed: ___
- Surprises and constraints for Task 5 (write the exact numbers and flags that worked): ___
