import { mkdtempSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { createRequire } from 'module'
import { describe, expect, it } from 'vitest'
import {
  NdiLoadError,
  loadNdi,
  NDI_AUDIO_FRAME_FIELDS,
  NDI_SEND_CREATE_FIELDS,
  NDI_VIDEO_FRAME_FIELDS
} from './binding'
import { ndiLibraryName, ndiSearchDirs } from './runtime'

function runtimeDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'ndi-'))
  writeFileSync(join(dir, ndiLibraryName(process.platform)), '')
  return dir
}

describe('ndiSearchDirs', () => {
  it('puts V6 before V5 env dirs, then Program Files folders on win32', () => {
    const dirs = ndiSearchDirs(
      { NDI_RUNTIME_DIR_V5: '/v5', NDI_RUNTIME_DIR_V6: '/v6' },
      'win32',
      'C:\\PF'
    )
    expect(dirs.slice(0, 2)).toEqual(['/v6', '/v5'])
    expect(dirs.slice(2).map((d) => d.replace(/\\/g, '/'))).toEqual([
      'C:/PF/NDI/NDI 6 Runtime/v6',
      'C:/PF/NDI/NDI 6 Tools/Runtime',
      'C:/PF/NDI/NDI 5 Runtime',
      'C:/PF/NDI/NDI 5 Tools/Runtime'
    ])
  })

  it('uses the three library folders on linux', () => {
    expect(ndiSearchDirs({}, 'linux', '')).toEqual([
      '/usr/lib',
      '/usr/local/lib',
      '/usr/lib/x86_64-linux-gnu'
    ])
  })

  it('names the library per platform', () => {
    expect(ndiLibraryName('win32')).toBe('Processing.NDI.Lib.x64.dll')
    expect(ndiLibraryName('linux')).toBe('libndi.so.6')
  })
})

describe('NDI structs', () => {
  it('have the 64-bit sizes 24 / 72 / 56', () => {
    const koffi = createRequire(__filename)('koffi') as typeof import('koffi')
    expect(koffi.sizeof(koffi.struct('T_Create', NDI_SEND_CREATE_FIELDS))).toBe(24)
    expect(koffi.sizeof(koffi.struct('T_Video', NDI_VIDEO_FRAME_FIELDS))).toBe(72)
    expect(koffi.sizeof(koffi.struct('T_Audio', NDI_AUDIO_FRAME_FIELDS))).toBe(56)
  })
})

describe('loadNdi', () => {
  it('throws missing when no runtime file exists', () => {
    try {
      loadNdi(['/nonexistent'])
      expect.unreachable()
    } catch (e) {
      expect(e).toBeInstanceOf(NdiLoadError)
      expect((e as NdiLoadError).kind).toBe('missing')
    }
  })

  it('throws old when a symbol is missing', () => {
    const koffi = {
      load: () => ({
        func: (sig: string) => {
          if (sig.includes('get_no_connections')) throw new Error('symbol not found')
          return () => true
        }
      }),
      struct: () => ({})
    }
    try {
      loadNdi([runtimeDir()], () => koffi as never)
      expect.unreachable()
    } catch (e) {
      expect(e).toBeInstanceOf(NdiLoadError)
      expect((e as NdiLoadError).kind).toBe('old')
    }
  })

  it('throws missing when NDIlib_initialize returns false', () => {
    const koffi = { load: () => ({ func: () => () => false }), struct: () => ({}) }
    try {
      loadNdi([runtimeDir()], () => koffi as never)
      expect.unreachable()
    } catch (e) {
      expect(e).toBeInstanceOf(NdiLoadError)
      expect((e as NdiLoadError).kind).toBe('missing')
      expect((e as Error).message).toMatch(/initialize/)
    }
  })

  it('sends BGRX progressive frames with synthesized timecode', () => {
    const sent: Record<string, unknown>[] = []
    const koffi = {
      address: () => 4242n,
      load: () => ({
        func: (sig: string) => {
          if (sig.includes('send_video'))
            return (_i: unknown, f: Record<string, unknown>) => sent.push(f)
          if (sig.includes('NDIlib_send_create')) return () => ({})
          return () => true
        }
      }),
      struct: () => ({})
    }
    const b = loadNdi([runtimeDir()], () => koffi as never)
    const h = b.create('PPT')
    expect(h).toBe(4242)
    expect(b.address(h)).toMatch(/ \(PPT\)$/)
    b.sendVideo(h, { width: 4, height: 2, fps: 30, data: new ArrayBuffer(32) })
    expect(sent[0]).toMatchObject({
      Xres: 4,
      Yres: 2,
      FourCC: 0x58524742,
      FrameRateN: 30,
      FrameRateD: 1,
      FrameFormatType: 1,
      Timecode: 0x7fffffffffffffffn,
      LineStrideInBytes: 16,
      PictureAspectRatio: 2
    })
    expect(b.videoStats(h)).toEqual({ frames: 0, dropped: 0 })
  })

  it('does not call native with an audio buffer that is too short', () => {
    const calls: unknown[] = []
    const koffi = {
      address: () => 7n,
      load: () => ({
        func: (sig: string) => {
          if (sig.includes('send_audio')) return (...a: unknown[]) => calls.push(a)
          if (sig.includes('NDIlib_send_create')) return () => ({})
          return () => true
        }
      }),
      struct: () => ({})
    }
    const b = loadNdi([runtimeDir()], () => koffi as never)
    const h = b.create('PPT')
    expect(() =>
      b.sendAudio(h, { sampleRate: 48000, channels: 2, samples: 480, data: new Float32Array(10) })
    ).toThrow(/too short/)
    expect(calls).toHaveLength(0)
    b.sendAudio(h, { sampleRate: 48000, channels: 2, samples: 4, data: new Float32Array(8) })
    expect(calls).toHaveLength(1)
  })
})
