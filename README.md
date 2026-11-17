<img src="resources/brand/bridgecast-mark.svg" alt="Bridgecast" width="64">

# Bridgecast

From slide to screen, live.

An Electron application with React and TypeScript

## Recommended IDE Setup

- [VSCode](https://code.visualstudio.com/) + [ESLint](https://marketplace.visualstudio.com/items?itemName=dbaeumer.vscode-eslint) + [Prettier](https://marketplace.visualstudio.com/items?itemName=esbenp.prettier-vscode)

## Project Setup

### Install

```bash
$ npm install
```

### Development

```bash
$ npm run dev
```

### Build

```bash
# For windows
$ npm run build:win

# For macOS
$ npm run build:mac

# For Linux
$ npm run build:linux
```

### Linux: PowerPoint files (LibreOffice)

On Linux, `.pptx` / `.ppt` import and the native slide show use LibreOffice Impress instead of
PowerPoint. Install it with the Python bridge dependency and the fonts that PowerPoint decks use:

```bash
sudo apt install libreoffice-impress python3-uno fonts-crosextra-carlito fonts-crosextra-caladea fonts-liberation
```

Use an **X11** session (Ubuntu / Zorin: pick "Ubuntu on Xorg" at the login screen). Wayland is not
supported yet and the app says so. The `.deb` lists LibreOffice and `python3-uno` as recommended
packages; the AppImage needs them installed on the PC. Integration tests with a real LibreOffice:
`xvfb-run -a npx vitest run test/integration` (skipped when `soffice` is missing).

## OMT native libraries

OMT output (video and sound to vMix / OBS over the LAN) loads two native libraries at run time:
`libomt` and `libvmx`, from the openmediatransport project (MIT; the license files are in
`resources/omt/win` and `resources/omt/linux`). The binaries are NOT committed. Put them in
place before building; the build copies them to `resources/omt/` of the packaged app (see
`extraResources` in `electron-builder.yml`). Without them the build still works (the folder then holds only
the README and licenses; if the folder itself is missing, electron-builder only prints
"file source doesn't exist"); the app then shows "OMT could not start: its library is
missing. Reinstall Bridgecast." when OMT is switched on, and HDMI keeps working.

### Windows

Download the prebuilt NATIVE `libomt.dll` and `libvmx.dll` from the openmediatransport/libomtnet
release (https://github.com/openmediatransport/libomtnet/releases) and copy both into
`resources/omt/win/`, then `npm run build:win`. Not the .NET `libomtnet.dll`: the app calls the
native C API (`libomt.h`) through koffi.

### Linux

Build from source (needs `dotnet-sdk-8.0` and clang; the commits used for the spike are in
`docs/superpowers/notes/omt-spike.md`). From a folder holding the three repos side by side:

```bash
git clone https://github.com/openmediatransport/libvmx    ~/omt-src/libvmx
git clone https://github.com/openmediatransport/libomtnet ~/omt-src/libomtnet
git clone https://github.com/openmediatransport/libomt    ~/omt-src/libomt
(cd ~/omt-src/libvmx/build    && ./buildlinuxx64.sh)   # -> libvmx/build/libvmx.so
(cd ~/omt-src/libomtnet/build && ./buildall.sh)        # must run before libomt
(cd ~/omt-src/libomt/build    && ./buildlinuxx64.sh)   # -> libomt/bin/Release/net8.0/linux-x64/native/libomt.so
cp ~/omt-src/libomt/bin/Release/net8.0/linux-x64/native/libomt.so \
   ~/omt-src/libvmx/build/libvmx.so  resources/omt/linux/
npm run build:unpack   # dist/linux-unpacked/resources/omt now holds both libraries
```

Keep `libomt.so` and `libvmx.so` side by side. For `npm run dev` (unpackaged) point
`PPT_LIBOMT_DIR` at the folder holding them.

### NDI Runtime

NDI output (video and sound to vMix / OBS / NDI Monitor over the LAN; not yet verified on Windows or with a real receiver, see `docs/test-checklist.md`) was removed on 2026-10-08
because of SDK licensing and re-added on 2026-10-27 without bundling anything from NewTek / Vizrt.
Bridgecast never ships the NDI Runtime. The Windows installer (`build/installer.nsh`,
`build/install-ndi-runtime.ps1`) downloads it from https://ndi.video when it is not installed yet (signature check and fallback not yet verified on Windows, see `docs/test-checklist.md`);
if that fails the install continues and the app shows "NDI could not start: the NDI Runtime is not
installed" when NDI is switched on (HDMI and OMT keep working). The installer is per-user, so the NDI Runtime installer needs admin and Windows shows a UAC prompt
even for a silent (`/S`) install. electron-builder runs the custom step after the app files are
copied, so answering No to the "continue without NDI" prompt ends the installer on a failed page
instead of cleanly cancelling (the files may stay installed). On a development machine install
the NDI Runtime yourself from ndi.video; the app looks for it at run time through koffi.

NDI® is a registered trademark of Vizrt NDI AB.

### Tests

`npm run test:e2e:network` runs the OMT and NDI end-to-end checks with recording fakes in place of
the native libraries (`PPT_OMT_FAKE=1`, `PPT_NDI_FAKE=1`; `PPT_NDI_FAKE=missing` simulates an absent
NDI Runtime), so it needs no native library. It covers both protocols on together, NDI switched
off and on, 60 fps, a 3840×1080 canvas and the missing-runtime case.

`npm run test:e2e:native` runs the native slideshow end-to-end checks with the in-memory FakeEngine
(`PPT_ENGINE_FAKE=1`) instead of PowerPoint: click steps, engine crash and fallback to the slide
PNG, Edit in PowerPoint while live, vector PDF decks and a broken PDF. The PowerPoint bridge, the
window capture and the sound pipe only run on Windows and are not covered; see the "Putar PPT asli"
section of `docs/test-checklist.md`.

## Releases

Windows and Linux AppImage builds are published to the **same** GitHub release. Each installer is
built on its own OS. The Linux release also carries a `.deb`; it cannot self-update (install a newer
`.deb` by hand), and macOS builds are not published.

1. Bump `"version"` in `package.json` and add a `## [X.Y.Z] - YYYY-MM-DD` section to
   `CHANGELOG.md`. Its newest version section becomes the release notes operators see under
   Settings > About as "What's new".
2. Commit on the release branch with a clean tracked tree, then run `npm run release:win` on
   Windows and `npm run release:linux` on Linux. Each builds with publishing disabled, checks
   that the installer, update metadata (`.yml`) and blockmap exist in `dist/`, and attaches them
   to release `vX.Y.Z` (creating it the first time, uploading with `--clobber` afterwards).
3. `npm run release` alone is a dry run: it prints the commands without building or publishing.
   Use `npm run release -- --branch <name>` when the release branch is not `main`, and
   `--win` / `--linux` to pick one platform. `--publish` is required to run anything.

The repository must be public and `gh` must be signed in with permission to create releases before
the first publish. Windows needs the PowerPoint bridge (`npm run build:bridge`) and the OMT
binaries; Linux needs the OMT libraries (see above). A failed GitHub check is silent in the app.
