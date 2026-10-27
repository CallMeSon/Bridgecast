# app

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

## OMT native libraries

OMT output (video and sound to vMix / OBS over the LAN) loads two native libraries at run time:
`libomt` and `libvmx`, from the openmediatransport project (MIT; the license files are in
`resources/omt/win` and `resources/omt/linux`). The binaries are NOT committed. Put them in
place before building; the build copies them to `resources/omt/` of the packaged app (see
`extraResources` in `electron-builder.yml`). Without them the build still works (the folder then holds only
the README and licenses; if the folder itself is missing, electron-builder only prints
"file source doesn't exist"); the app then shows "OMT could not start: its library is
missing. Reinstall PPT Share." when OMT is switched on, and HDMI keeps working.

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

### Tests

`npm run test:e2e:network` runs the OMT end-to-end checks with a recording fake in place of
libomt (`PPT_OMT_FAKE=1`), so it needs no native library.
