# OMT native libraries (Windows)

The Windows build copies this folder's files to `resources/omt/` in the installed app.
The binaries are NOT in git (they are listed in `.gitignore`). Before `npm run build:win`
put these two files here, side by side:

- `libomt.dll`
- `libvmx.dll`

Source: the prebuilt NATIVE `libomt.dll` and `libvmx.dll` from the openmediatransport/libomtnet
release (https://github.com/openmediatransport/libomtnet/releases). Do not use the .NET
`libomtnet.dll`: the app calls the native C API of libomt through koffi.

`LICENSE-libomt.txt` and `LICENSE-libvmx.txt` (MIT) ship with the binaries.
