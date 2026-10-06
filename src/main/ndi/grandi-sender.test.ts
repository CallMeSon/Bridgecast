import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  GrandiNdiSender,
  NDI_NAME_IN_USE,
  NDI_RUNTIME_MISSING,
  runtimeDirs,
  type GrandiLike,
  type NativeSender,
  type NativeVideoFrame
} from './grandi-sender'
import type { NdiStatus } from '../../shared/ipc'

/** Minimal stand-in for the grandi module and its native senders. */
class FakeNative implements NativeSender {
  destroyed = false
  frames: NativeVideoFrame[] = []
  /** Resolvers of in-flight video() calls (resolved manually by the test). */
  pending: (() => void)[] = []
  constructor(readonly name: string) {}
  video(frame: NativeVideoFrame): Promise<void> {
    this.frames.push(frame)
    return new Promise((r) => this.pending.push(r))
  }
  sourceName(): string {
    return `TEST-PC (${this.name})`
  }
  connections(): number {
    return 0
  }
  destroy(): boolean {
    this.destroyed = true
    return true
  }
}

function fakeGrandi(opts: { failCreates?: number } = {}): GrandiLike & { natives: FakeNative[] } {
  let fails = opts.failCreates ?? 0
  const natives: FakeNative[] = []
  return {
    natives,
    send: async ({ name }) => {
      if (fails-- > 0) throw new Error('Failed to create NDI sender.')
      const n = new FakeNative(name)
      natives.push(n)
      return n
    },
    FourCC: { BGRX: 1481787202 },
    FrameType: { Progressive: 1 }
  }
}

const fmt = { name: 'PPT Share', width: 4, height: 2, fps: 30 }
const frame = (w = 4, h = 2): Buffer => Buffer.alloc(w * h * 4, 0x7f)
const flush = async (): Promise<void> => {
  for (let i = 0; i < 5; i++) await Promise.resolve()
}

let statuses: NdiStatus[]
beforeEach(() => {
  statuses = []
})
afterEach(() => vi.useRealTimers())

describe('GrandiNdiSender', () => {
  it('creates one source with the name, clockVideo off, and reports running with its full name', async () => {
    const g = fakeGrandi()
    const send = vi.spyOn(g, 'send')
    const s = new GrandiNdiSender(
      (x) => statuses.push(x),
      async () => g
    )
    s.start(fmt)
    await flush()
    expect(send).toHaveBeenCalledWith({ name: 'PPT Share', clockVideo: false, clockAudio: false })
    expect(statuses.at(-1)).toEqual({ state: 'running', source: 'TEST-PC (PPT Share)' })
  })

  it('sends BGRX progressive frames with exact integer frame rate and aspect ratio', async () => {
    const g = fakeGrandi()
    const s = new GrandiNdiSender(
      () => {},
      async () => g
    )
    s.start({ ...fmt, fps: 60 })
    await flush()
    const buf = frame()
    s.sendBgra(buf)
    const f = g.natives[0].frames[0]
    expect(f).toMatchObject({
      xres: 4,
      yres: 2,
      frameRateN: 60,
      frameRateD: 1,
      pictureAspectRatio: 2,
      fourCC: 1481787202,
      frameFormatType: 1,
      lineStrideBytes: 16
    })
    // The caller's buffer is handed over as-is (no copy); the caller never mutates it.
    expect(f.data).toBe(buf)
  })

  it('drops frames while a send is in flight (one buffer owned by NDI at a time)', async () => {
    const g = fakeGrandi()
    const s = new GrandiNdiSender(
      () => {},
      async () => g
    )
    s.start(fmt)
    await flush()
    s.sendBgra(frame())
    s.sendBgra(frame())
    s.sendBgra(frame())
    expect(g.natives[0].frames).toHaveLength(1)
    expect(s.stats.dropped).toBe(2)
    g.natives[0].pending[0]()
    await flush()
    s.sendBgra(frame())
    expect(g.natives[0].frames).toHaveLength(2)
    expect(s.stats.sent).toBe(1)
  })

  it('drops frames whose size does not match the format', async () => {
    const g = fakeGrandi()
    const s = new GrandiNdiSender(
      () => {},
      async () => g
    )
    s.start(fmt)
    await flush()
    s.sendBgra(frame(8, 4))
    expect(g.natives[0].frames).toHaveLength(0)
    expect(s.stats.dropped).toBe(1)
  })

  it('ignores frames before the source exists and after stop', async () => {
    const g = fakeGrandi()
    const s = new GrandiNdiSender(
      (x) => statuses.push(x),
      async () => g
    )
    s.sendBgra(frame())
    s.start(fmt)
    s.sendBgra(frame()) // still creating
    await flush()
    s.stop()
    s.sendBgra(frame())
    expect(g.natives[0].frames).toHaveLength(0)
    expect(g.natives[0].destroyed).toBe(true)
    expect(statuses.at(-1)).toEqual({ state: 'stopped' })
  })

  it('same name: a new format reuses the source (no gap); frames of the new size go out', async () => {
    const g = fakeGrandi()
    const s = new GrandiNdiSender(
      () => {},
      async () => g
    )
    s.start(fmt)
    await flush()
    s.start({ ...fmt, width: 8, height: 4, fps: 60 })
    await flush()
    expect(g.natives).toHaveLength(1)
    expect(g.natives[0].destroyed).toBe(false)
    s.sendBgra(frame(8, 4))
    expect(g.natives[0].frames[0]).toMatchObject({ xres: 8, yres: 4, frameRateN: 60 })
  })

  it('new name: destroys the old source and creates a new one', async () => {
    const g = fakeGrandi()
    const s = new GrandiNdiSender(
      (x) => statuses.push(x),
      async () => g
    )
    s.start(fmt)
    await flush()
    s.start({ ...fmt, name: 'Aula' })
    await flush()
    expect(g.natives.map((n) => [n.name, n.destroyed])).toEqual([
      ['PPT Share', true],
      ['Aula', false]
    ])
    expect(statuses).toEqual([
      { state: 'running', source: 'TEST-PC (PPT Share)' },
      { state: 'stopped' },
      { state: 'running', source: 'TEST-PC (Aula)' }
    ])
  })

  it('retries creation (a destroyed source may still be finishing its last send)', async () => {
    vi.useFakeTimers()
    const g = fakeGrandi({ failCreates: 2 })
    const s = new GrandiNdiSender(
      (x) => statuses.push(x),
      async () => g
    )
    s.start(fmt)
    await vi.advanceTimersByTimeAsync(1000)
    expect(g.natives).toHaveLength(1)
    expect(statuses.at(-1)?.state).toBe('running')
  })

  it('reports the name as in use when creation keeps failing', async () => {
    vi.useFakeTimers()
    const g = fakeGrandi({ failCreates: 100 })
    const s = new GrandiNdiSender(
      (x) => statuses.push(x),
      async () => g
    )
    s.start(fmt)
    await vi.advanceTimersByTimeAsync(5000)
    expect(statuses.at(-1)).toEqual({ state: 'error', message: NDI_NAME_IN_USE('PPT Share') })
    expect(statuses.at(-1)?.message).toMatch(/ganti nama source/i)
  })

  it('reports a missing runtime with the fix when the library cannot load', async () => {
    const s = new GrandiNdiSender(
      (x) => statuses.push(x),
      async () => {
        throw new Error('Failed to load native addon')
      }
    )
    s.start(fmt)
    await flush()
    expect(statuses.at(-1)).toEqual({ state: 'error', message: NDI_RUNTIME_MISSING })
    expect(NDI_RUNTIME_MISSING).toContain(
      'Pasang NDI Tools dari ndi.video lalu mulai ulang aplikasi.'
    )
  })

  it('stop during creation destroys the late source', async () => {
    let release!: () => void
    const g = fakeGrandi()
    const gate = new Promise<void>((r) => (release = r))
    const s = new GrandiNdiSender(
      (x) => statuses.push(x),
      async () => {
        await gate
        return g
      }
    )
    s.start(fmt)
    s.stop()
    release()
    await flush()
    expect(g.natives.every((n) => n.destroyed)).toBe(true)
    expect(statuses.at(-1)).toEqual({ state: 'stopped' })
  })

  it('a failed send is counted and does not block later sends', async () => {
    const g = fakeGrandi()
    const s = new GrandiNdiSender(
      () => {},
      async () => g
    )
    s.start(fmt)
    await flush()
    const native = g.natives[0]
    native.video = vi.fn().mockRejectedValueOnce(new Error('boom')).mockResolvedValue(undefined)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    s.sendBgra(frame())
    await flush()
    s.sendBgra(frame())
    await flush()
    expect(s.stats.failed).toBe(1)
    expect(s.stats.sent).toBe(1)
    warn.mockRestore()
  })
})

describe('runtimeDirs', () => {
  it('lists installed NDI runtime folders from the environment, newest first', () => {
    expect(
      runtimeDirs({
        NDI_RUNTIME_DIR_V5: 'C:\\NDI5',
        NDI_RUNTIME_DIR_V6: 'C:\\NDI6',
        NDILIB_REDIST_FOLDER: 'C:\\redist'
      })
    ).toEqual(['C:\\NDI6', 'C:\\NDI5', 'C:\\redist'])
    expect(runtimeDirs({})).toEqual([])
  })
})
