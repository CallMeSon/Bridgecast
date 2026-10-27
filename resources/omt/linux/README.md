# OMT native libraries (Linux)

The Linux build copies this folder's files to `resources/omt/` in the packaged app.
The binaries are NOT in git (they are listed in `.gitignore`). Before `npm run build:linux`
(or `build:unpack`) put these two files here, side by side:

- `libomt.so`
- `libvmx.so`

How to build them: see the "OMT native libraries" section of the top-level README.md.

`LICENSE-libomt.txt` and `LICENSE-libvmx.txt` (MIT) ship with the binaries.
