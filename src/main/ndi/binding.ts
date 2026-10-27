import { existsSync } from 'fs'
import { hostname } from 'os'
import { join } from 'path'
import { createRequire } from 'module'
import type KoffiModule from 'koffi'
import type { SenderBinding } from '../net/sender-binding'
import { ndiLibraryName, ndiSearchDirs } from './runtime'

export class NdiLoadError extends Error {
  kind: 'missing' | 'old'
  constructor(kind: 'missing' | 'old', message: string) {
    super(message)
    this.name = 'NdiLoadError'
    this.kind = kind
  }
}

const FOURCC_BGRX =
  'B'.charCodeAt(0) |
  ('G'.charCodeAt(0) << 8) |
  ('R'.charCodeAt(0) << 16) |
  ('X'.charCodeAt(0) << 24) |
  0
const FRAME_FORMAT_PROGRESSIVE = 1
const TIMECODE_SYNTHESIZE = 0x7fffffffffffffffn // NDIlib_send_timecode_synthesize (INT64_MAX)

// Field orders from NdiNative.cs (64-bit sizes 24 / 72 / 56, see docs/superpowers/notes/ndi-spike.md).
export const NDI_SEND_CREATE_FIELDS = {
  Name: 'const char *',
  Groups: 'const char *',
  ClockVideo: 'uint8_t',
  ClockAudio: 'uint8_t'
} as const

export const NDI_VIDEO_FRAME_FIELDS = {
  Xres: 'int',
  Yres: 'int',
  FourCC: 'int',
  FrameRateN: 'int',
  FrameRateD: 'int',
  PictureAspectRatio: 'float',
  FrameFormatType: 'int',
  Timecode: 'int64_t',
  Data: 'void *',
  LineStrideInBytes: 'int',
  Metadata: 'const char *',
  Timestamp: 'int64_t'
} as const

export const NDI_AUDIO_FRAME_FIELDS = {
  SampleRate: 'int',
  NoChannels: 'int',
  NoSamples: 'int',
  Timecode: 'int64_t',
  Data: 'void *',
  ChannelStrideInBytes: 'int',
  Metadata: 'const char *',
  Timestamp: 'int64_t'
} as const

type Koffi = typeof KoffiModule

// Required lazily so a failed native load stays catchable inside loadNdi.
const defaultKoffi = (): Koffi => createRequire(__filename)('koffi') as Koffi

let structsDefined = false
function defineStructs(koffi: Koffi): void {
  if (structsDefined) return // koffi rejects a second definition of a named type
  koffi.struct('NDIlib_send_create_t', NDI_SEND_CREATE_FIELDS)
  koffi.struct('NDIlib_video_frame_v2_t', NDI_VIDEO_FRAME_FIELDS)
  koffi.struct('NDIlib_audio_frame_v3_t', NDI_AUDIO_FRAME_FIELDS)
  structsDefined = true
}

/**
 * Loads the NDI runtime (never bundled) through koffi. No library, or
 * NDIlib_initialize() false, is NdiLoadError('missing'); a missing symbol is
 * NdiLoadError('old'). send_video_v2 is synchronous, so the frame buffer only
 * needs to stay alive for the call.
 */
export function loadNdi(
  dirs: string[] = ndiSearchDirs(process.env, process.platform, process.env.ProgramFiles ?? ''),
  loadKoffi: () => Koffi = defaultKoffi
): SenderBinding {
  const file = dirs.map((d) => join(d, ndiLibraryName(process.platform))).find((p) => existsSync(p))
  if (!file) throw new NdiLoadError('missing', `NDI runtime not found in: ${dirs.join(', ')}`)

  let koffi: Koffi
  let lib: ReturnType<Koffi['load']>
  try {
    koffi = loadKoffi()
    lib = koffi.load(file)
    defineStructs(koffi)
  } catch (e) {
    throw new NdiLoadError('missing', `NDI runtime unavailable at ${file}: ${(e as Error).message}`)
  }

  let fns: {
    initialize: () => boolean
    create: (p: object) => unknown
    destroy: (inst: unknown) => void
    sendVideo: (inst: unknown, f: object) => void
    sendAudio: (inst: unknown, f: object) => void
    connections: (inst: unknown, timeoutMs: number) => number
  }
  try {
    fns = {
      initialize: lib.func('bool NDIlib_initialize()'),
      create: lib.func('void *NDIlib_send_create(_In_ NDIlib_send_create_t *p)'),
      destroy: lib.func('void NDIlib_send_destroy(void *inst)'),
      sendVideo: lib.func(
        'void NDIlib_send_send_video_v2(void *inst, _In_ NDIlib_video_frame_v2_t *f)'
      ),
      sendAudio: lib.func(
        'void NDIlib_send_send_audio_v2(void *inst, _In_ NDIlib_audio_frame_v3_t *f)'
      ),
      connections: lib.func('int NDIlib_send_get_no_connections(void *inst, uint32_t timeout_ms)')
    }
  } catch (e) {
    throw new NdiLoadError(
      'old',
      `NDI runtime at ${file} lacks a required symbol: ${(e as Error).message}`
    )
  }
  if (!fns.initialize())
    throw new NdiLoadError('missing', 'NDIlib_initialize() failed (unsupported CPU?)')

  const instances = new Map<number, unknown>()
  const names = new Map<number, string>()
  const get = (h: number): unknown => {
    const inst = instances.get(h)
    if (!inst) throw new Error(`unknown NDI sender ${h}`)
    return inst
  }

  return {
    create(name) {
      const inst = fns.create({ Name: name, Groups: null, ClockVideo: 0, ClockAudio: 0 })
      if (!inst) return 0
      const h = Number(koffi.address(inst as never))
      instances.set(h, inst)
      names.set(h, name)
      return h
    },
    sendVideo(h, f) {
      if (f.data.byteLength < f.width * 4 * f.height)
        throw new Error('video buffer too short for width*4*height')
      const data = Buffer.from(f.data) // shares memory; alive for the synchronous call
      fns.sendVideo(get(h), {
        Xres: f.width,
        Yres: f.height,
        FourCC: FOURCC_BGRX,
        FrameRateN: f.fps,
        FrameRateD: 1,
        PictureAspectRatio: f.width / f.height,
        FrameFormatType: FRAME_FORMAT_PROGRESSIVE,
        Timecode: TIMECODE_SYNTHESIZE,
        Data: data,
        LineStrideInBytes: f.width * 4,
        Metadata: null,
        Timestamp: 0
      })
    },
    sendAudio(h, a) {
      const data = Buffer.from(a.data.buffer, a.data.byteOffset, a.data.byteLength)
      fns.sendAudio(get(h), {
        SampleRate: a.sampleRate,
        NoChannels: a.channels,
        NoSamples: a.samples,
        Timecode: TIMECODE_SYNTHESIZE,
        Data: data,
        ChannelStrideInBytes: a.samples * 4,
        Metadata: null,
        Timestamp: 0
      })
    },
    connections: (h) => fns.connections(get(h), 0),
    address: (h) => `${hostname()} (${names.get(h) ?? ''})`,
    videoStats: () => ({ frames: 0, dropped: 0 }),
    destroy(h) {
      const inst = instances.get(h)
      if (!inst) return
      instances.delete(h)
      names.delete(h)
      fns.destroy(inst)
    }
  }
}
