import { existsSync } from 'fs'
import { join } from 'path'
import { createRequire } from 'module'
import type KoffiModule from 'koffi'
import type { SenderBinding } from '../net/sender-binding'

export class OmtLoadError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'OmtLoadError'
  }
}

const OMT_FRAME_VIDEO = 2
const OMT_FRAME_AUDIO = 4
const OMT_CODEC_BGRA = 0x41524742
const OMT_CODEC_FPA1 = 0x31415046
const OMT_QUALITY_DEFAULT = 0
const ADDRESS_MAX = 1024

function libName(base: 'libomt' | 'libvmx'): string {
  return `${base}.${process.platform === 'win32' ? 'dll' : process.platform === 'darwin' ? 'dylib' : 'so'}`
}

// Field order copied from libomt.h (OMTMediaFrame); koffi adds the padding.
const FRAME_FIELDS = {
  Type: 'int',
  Timestamp: 'int64_t',
  Codec: 'int',
  Width: 'int',
  Height: 'int',
  Stride: 'int',
  Flags: 'int',
  FrameRateN: 'int',
  FrameRateD: 'int',
  AspectRatio: 'float',
  ColorSpace: 'int',
  SampleRate: 'int',
  Channels: 'int',
  SamplesPerChannel: 'int',
  Data: 'void *',
  DataLength: 'int',
  CompressedData: 'void *',
  CompressedLength: 'int',
  FrameMetadata: 'void *',
  FrameMetadataLength: 'int'
} as const

// OMTStatistics: 16 x int64_t, named as in libomt.h.
const STATS_FIELDS = Object.fromEntries(
  [
    'BytesSent',
    'BytesReceived',
    'BytesSentSinceLast',
    'BytesReceivedSinceLast',
    'Frames',
    'FramesSinceLast',
    'FramesDropped',
    'CodecTime',
    'CodecTimeSinceLast',
    'Reserved1',
    'Reserved2',
    'Reserved3',
    'Reserved4',
    'Reserved5',
    'Reserved6',
    'Reserved7'
  ].map((k) => [k, 'int64_t'])
)

type Koffi = typeof KoffiModule

// koffi is required lazily so a failed native load becomes an OmtLoadError
// inside loadLibomt instead of breaking the import of this module.
const defaultKoffi = (): Koffi => createRequire(__filename)('koffi') as Koffi

let structsDefined = false
function defineStructs(koffi: Koffi): void {
  if (structsDefined) return // koffi rejects a second definition of a named type
  koffi.struct('OMTMediaFrame', FRAME_FIELDS)
  koffi.struct('OMTStatistics', STATS_FIELDS)
  structsDefined = true
}

/**
 * Loads libomt through koffi. Throws OmtLoadError when the library or a symbol
 * is missing. libvmx is loaded by libomt itself at runtime, so it must sit
 * next to libomt.
 *
 * NOTE: frames are sent with Timestamp = -1, so `omt_send` throttles and
 * blocks for about 1/fps per call. sendVideo/sendAudio call it synchronously;
 * pacing is decided by the caller (the output worker).
 */
export function loadLibomt(dir: string, loadKoffi: () => Koffi = defaultKoffi): SenderBinding {
  let fns: {
    create: (name: string, quality: number) => unknown
    send: (inst: unknown, frame: object) => number
    connections: (inst: unknown) => number
    getAddress: (inst: unknown, buf: Buffer, max: number) => number
    videoStats: (inst: unknown, out: Record<string, bigint | number>) => void
    destroy: (inst: unknown) => void
  }
  try {
    const koffi = loadKoffi()
    const lib = koffi.load(join(dir, libName('libomt')))
    if (!existsSync(join(dir, libName('libvmx')))) throw new Error(`${libName('libvmx')} missing`)
    defineStructs(koffi)
    fns = {
      create: lib.func('void *omt_send_create(const char *name, int quality)'),
      send: lib.func('int omt_send(void *inst, _In_ OMTMediaFrame *frame)'),
      connections: lib.func('int omt_send_connections(void *inst)'),
      getAddress: lib.func('int omt_send_getaddress(void *inst, _Out_ uint8_t *addr, int max)'),
      videoStats: lib.func('void omt_send_getvideostatistics(void *inst, _Out_ OMTStatistics *s)'),
      destroy: lib.func('void omt_send_destroy(void *inst)')
    }
  } catch (e) {
    throw new OmtLoadError(`libomt unavailable in ${dir}: ${(e as Error).message}`)
  }

  const instances = new Map<number, unknown>()
  let next = 1
  const get = (h: number): unknown => {
    const inst = instances.get(h)
    if (!inst) throw new Error(`unknown OMT sender ${h}`)
    return inst
  }

  return {
    create(name) {
      const inst = fns.create(name, OMT_QUALITY_DEFAULT)
      if (!inst) throw new Error('omt_send_create failed')
      const h = next++
      instances.set(h, inst)
      return h
    },
    sendVideo(h, f) {
      if (f.data.byteLength < f.width * 4 * f.height)
        throw new Error('video buffer too short for width*4*height')
      const data = Buffer.from(f.data)
      fns.send(get(h), {
        Type: OMT_FRAME_VIDEO,
        Timestamp: -1,
        Codec: OMT_CODEC_BGRA,
        Width: f.width,
        Height: f.height,
        Stride: f.width * 4,
        Flags: 0,
        FrameRateN: f.fps,
        FrameRateD: 1,
        AspectRatio: f.width / f.height,
        ColorSpace: 0,
        Data: data,
        DataLength: data.length
      })
    },
    sendAudio(h, a) {
      const data = Buffer.from(a.data.buffer, a.data.byteOffset, a.data.byteLength)
      fns.send(get(h), {
        Type: OMT_FRAME_AUDIO,
        Timestamp: -1,
        Codec: OMT_CODEC_FPA1,
        SampleRate: a.sampleRate,
        Channels: a.channels,
        SamplesPerChannel: a.samples,
        Data: data,
        DataLength: data.length
      })
    },
    connections: (h) => fns.connections(get(h)),
    address(h) {
      const buf = Buffer.alloc(ADDRESS_MAX)
      const n = fns.getAddress(get(h), buf, ADDRESS_MAX)
      if (n <= 0) return ''
      const end = buf.indexOf(0)
      return buf.toString('utf8', 0, end < 0 ? n : end)
    },
    videoStats(h) {
      const s: Record<string, bigint | number> = {}
      fns.videoStats(get(h), s)
      return { frames: Number(s.Frames ?? 0), dropped: Number(s.FramesDropped ?? 0) }
    },
    destroy(h) {
      const inst = instances.get(h)
      if (!inst) return
      instances.delete(h)
      fns.destroy(inst)
    }
  }
}
