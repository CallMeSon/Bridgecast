# NDI spike (2026-10-28)

Plan: `docs/superpowers/plans/2026-10-27-ndi-output.md`, Task 1. Spike code is throwaway and not committed. Layouts are taken from `~/work/stagecast/src/Stagecast.Rendering/Ndi/NdiNative.cs`.

## Linux (agent)

**Step 1, struct sizes (`koffi.sizeof`, koffi from `node_modules`): pass.**

| Struct | Size | Expected | Field order used |
|---|---|---|---|
| `SendCreate` | 24 | 24 | `Name` ptr, `Groups` ptr, `ClockVideo` u8, `ClockAudio` u8 |
| `VideoFrame` | 72 | 72 | `Xres` i32, `Yres` i32, `FourCC` i32, `FrameRateN` i32, `FrameRateD` i32, `PictureAspectRatio` f32, `FrameFormatType` i32, `Timecode` i64, `Data` ptr, `LineStrideInBytes` i32, `Metadata` ptr, `Timestamp` i64 |
| `AudioFrame` | 56 | 56 | `SampleRate` i32, `NoChannels` i32, `NoSamples` i32, `Timecode` i64, `Data` ptr, `ChannelStrideInBytes` i32, `Metadata` ptr, `Timestamp` i64 |

**Step 2, Linux runtime: none on this machine.** `ldconfig -p | grep -i ndi` finds no `libndi.so.6`, and nothing in `/usr/lib`, `/usr/local/lib` or `/usr/lib/x86_64-linux-gnu`. The NDI SDK needs a licence acceptance on ndi.video, so steps 2 to 3 (send from Linux, CPU of main plus worker) are skipped. Windows checklist below.

## Windows checklist (user)

Run on a PC with the NDI Runtime (the Stagecast machine works).

1. Copy the Node script that declares the three structs as above and sends one 1920×1080 BGRX gradient frame (FourCC `BGRX`, progressive, `Timecode` = `INT64_MAX`, `FrameRateN` 30, `FrameRateD` 1, stride `width*4`) plus one 480-sample, 48000 Hz, 2-channel float planar test tone, repeating at 30 fps.
2. NDI Monitor (or Stagecast `NdiProbe`) shows a correct, undistorted gradient and the test tone is audible.
3. vMix and OBS (DistroAV) list the source.
4. CPU at 30 and 60 fps for 1920×1080 and 3840×1080: record below.

Results:

- [ ] Gradient correct in NDI Monitor / NdiProbe:
- [ ] Test tone audible:
- [ ] Listed in vMix:
- [ ] Listed in OBS (DistroAV):
- CPU (1920×1080 @30 / @60, 3840×1080 @30 / @60):

A distorted picture or crash means a struct layout mistake: fix against `NdiNative.cs` and retry.
