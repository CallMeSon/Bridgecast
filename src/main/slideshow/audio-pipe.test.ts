import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest'
import { initialState, type ProgramState } from '../../shared/program'
import {
  PCM_FRAMES,
  PcmBlocker,
  PcmFanout,
  PcmPipe,
  SlideSound,
  fallbackVolume,
  soundWanted,
  type PipeSocket,
  type PortLike
} from './audio-pipe'
import { DEFAULT_AUDIO } from '../../shared/settings'

/** Interleaved little-endian float32 frames: frame i is (l(i), r(i)). */
function pcm(frames: number, l = (i: number) => i, r = (i: number) => -i): Buffer {
  const b = Buffer.alloc(frames * 8)
  for (let i = 0; i < frames; i++) {
    b.writeFloatLE(l(i), i * 8)
    b.writeFloatLE(r(i), i * 8 + 4)
  }
  return b
}

describe('PcmBlocker', () => {
  it('turns the interleaved pipe bytes into planar 10 ms blocks (left then right)', () => {
    const b = new PcmBlocker()
    const out = b.push(pcm(PCM_FRAMES))
    expect(out).toHaveLength(1)
    expect(out[0].samples).toBe(480)
    expect(out[0].data).toHaveLength(960)
    expect(out[0].data[0]).toBe(0)
    expect(out[0].data[5]).toBe(5)
    expect(out[0].data[480]).toBe(-0)
    expect(out[0].data[485]).toBe(-5)
  })
  it('keeps partial blocks and bytes that split a sample between chunks', () => {
    const b = new PcmBlocker()
    const all = pcm(
      PCM_FRAMES * 2 + 100,
      (i) => i + 0.5,
      (i) => -(i + 0.5)
    )
    const got = [
      ...b.push(all.subarray(0, 3)),
      ...b.push(all.subarray(3, 3842)),
      ...b.push(all.subarray(3842))
    ]
    expect(got).toHaveLength(2)
    expect(got[1].data[0]).toBe(480.5)
    expect(got[1].data[959]).toBe(-959.5)
  })
  it('works on a Buffer that is a view into a larger pool (odd byteOffset)', () => {
    const pool = Buffer.alloc(3 + PCM_FRAMES * 8)
    pcm(PCM_FRAMES).copy(pool, 3)
    const out = new PcmBlocker().push(pool.subarray(3))
    expect(out[0].data[7]).toBe(7)
  })
  it('reset drops a half block (a new connection starts on a frame boundary)', () => {
    const b = new PcmBlocker()
    b.push(pcm(100))
    b.reset()
    expect(b.push(pcm(PCM_FRAMES))).toHaveLength(1)
  })
})

class FakeSocket implements PipeSocket {
  handlers: Record<string, ((a?: unknown) => void)[]> = {}
  destroyed = false
  on(ev: 'data', cb: (chunk: Uint8Array) => void): this
  on(ev: 'error', cb: (err: Error) => void): this
  on(ev: 'close', cb: () => void): this
  on(ev: string, cb: (a: never) => void): this {
    ;(this.handlers[ev] ??= []).push(cb as (a?: unknown) => void)
    return this
  }
  destroy(): void {
    this.destroyed = true
  }
  emit(ev: string, a?: unknown): void {
    for (const h of this.handlers[ev] ?? []) h(a)
  }
}

describe('PcmPipe', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  function setup(): { pipe: PcmPipe; sockets: FakeSocket[]; paths: string[]; blocks: number[] } {
    const sockets: FakeSocket[] = []
    const paths: string[] = []
    const blocks: number[] = []
    const pipe = new PcmPipe({
      connect: (p) => {
        paths.push(p)
        const s = new FakeSocket()
        sockets.push(s)
        return s
      },
      onBlock: (b) => blocks.push(b.samples),
      retryMs: 500
    })
    return { pipe, sockets, paths, blocks }
  }

  it('connects to the named pipe and forwards blocks', () => {
    const { pipe, sockets, paths, blocks } = setup()
    pipe.open('\\\\.\\pipe\\pptshare-audio-7')
    expect(paths).toEqual(['\\\\.\\pipe\\pptshare-audio-7'])
    sockets[0].emit('data', pcm(PCM_FRAMES * 2))
    expect(blocks).toEqual([480, 480])
  })
  it('reconnects after the pipe closes or fails (the bridge serves it again), until closed', () => {
    const { pipe, sockets, paths } = setup()
    pipe.open('p')
    sockets[0].emit('error', new Error('ENOENT'))
    sockets[0].emit('close')
    expect(paths).toHaveLength(1)
    vi.advanceTimersByTime(500)
    expect(paths).toHaveLength(2) // one retry for error+close together
    sockets[1].emit('close')
    pipe.open(null)
    vi.advanceTimersByTime(5000)
    expect(paths).toHaveLength(2)
    expect(sockets[1].destroyed).toBe(true)
  })
  it('opening another path drops the old connection and ignores its late data', () => {
    const { pipe, sockets, blocks } = setup()
    pipe.open('a')
    pipe.open('b')
    expect(sockets[0].destroyed).toBe(true)
    sockets[0].emit('data', pcm(PCM_FRAMES))
    expect(blocks).toEqual([])
    sockets[1].emit('data', pcm(PCM_FRAMES))
    expect(blocks).toEqual([480])
  })
  it('opening the path already open keeps the connection', () => {
    const { pipe, paths } = setup()
    pipe.open('a')
    pipe.open('a')
    expect(paths).toHaveLength(1)
  })
  it('a connect that throws is retried, not fatal', () => {
    let n = 0
    const pipe = new PcmPipe({
      connect: () => {
        n++
        throw new Error('no pipe')
      },
      onBlock: () => {},
      retryMs: 100
    })
    pipe.open('a')
    vi.advanceTimersByTime(250)
    expect(n).toBeGreaterThan(1)
    pipe.open(null)
  })
})

class FakePort implements PortLike {
  sent: { data: Float32Array; samples: number }[] = []
  closed = false
  throws = false
  postMessage(m: { data: Float32Array; samples: number }): void {
    if (this.throws) throw new Error('closed')
    this.sent.push(m)
  }
  close(): void {
    this.closed = true
  }
}

describe('PcmFanout', () => {
  const block = { data: new Float32Array(960), samples: 480 }
  it('posts a block to every window port while sound is wanted', () => {
    const f = new PcmFanout()
    const a = new FakePort()
    const b = new FakePort()
    f.add(1, a)
    f.add(2, b)
    f.setWanted(true)
    f.post(block)
    expect(a.sent).toHaveLength(1)
    expect(b.sent).toHaveLength(1)
  })
  it('drops blocks while no native slide is on air', () => {
    const f = new PcmFanout()
    const a = new FakePort()
    f.add(1, a)
    f.post(block)
    f.setWanted(true)
    f.setWanted(false)
    f.post(block)
    expect(a.sent).toHaveLength(0)
  })
  it('a new port for a window replaces and closes the old one; remove closes', () => {
    const f = new PcmFanout()
    const a = new FakePort()
    const b = new FakePort()
    f.add(1, a)
    f.add(1, b)
    expect(a.closed).toBe(true)
    f.remove(1)
    expect(b.closed).toBe(true)
    expect(f.size).toBe(0)
  })
  it('a port that throws is dropped without hurting the others', () => {
    const f = new PcmFanout()
    const bad = new FakePort()
    bad.throws = true
    const ok = new FakePort()
    f.add(1, bad)
    f.add(2, ok)
    f.setWanted(true)
    f.post(block)
    f.post(block)
    expect(ok.sent).toHaveLength(2)
    expect(f.size).toBe(1)
  })
})

describe('soundWanted', () => {
  const shown = { deckId: 'd', index: 0, file: '001.png' }
  const st = (over: Partial<ProgramState> = {}): ProgramState => ({ ...initialState, ...over })
  it('only while a native deck is the slide on air', () => {
    expect(soundWanted(st({ shown: { ...shown, playback: 'native' } }))).toBe(true)
    expect(soundWanted(st({ shown: { ...shown, playback: 'images' } }))).toBe(false)
    expect(soundWanted(st({ shown: { ...shown, playback: 'vector' } }))).toBe(false)
    expect(soundWanted(st({ shown: { ...shown } }))).toBe(false)
    expect(soundWanted(st())).toBe(false)
  })
})

describe('fallbackVolume', () => {
  const shown = { deckId: 'd', index: 0, file: '001.png', playback: 'native' as const }
  const audio = { ...DEFAULT_AUDIO }
  it('is deck level times master for the live native deck', () => {
    const s = { ...initialState, shown: { ...shown, audio: { volume: 50, muted: false } } }
    expect(fallbackVolume(s, { ...audio, masterVolume: 80 })).toBeCloseTo(0.4)
  })
  it('is 0 when the deck or the master is muted', () => {
    const s = { ...initialState, shown: { ...shown, audio: { volume: 50, muted: true } } }
    expect(fallbackVolume(s, audio)).toBe(0)
    expect(fallbackVolume({ ...initialState, shown }, { ...audio, muted: true })).toBe(0)
  })
  it('is null when no native deck is live', () => {
    expect(fallbackVolume(initialState, audio)).toBeNull()
    expect(
      fallbackVolume({ ...initialState, shown: { ...shown, playback: 'images' } }, audio)
    ).toBeNull()
  })
})

describe('SlideSound', () => {
  const native = { deckId: 'd', index: 0, file: '001.png', playback: 'native' as const }
  const live = (volume = 100): ProgramState => ({
    ...initialState,
    shown: { ...native, audio: { volume, muted: false } }
  })
  const COPY = "PowerPoint sound plays on this PC's default device only."

  function setup(): {
    sound: SlideSound
    sockets: FakeSocket[]
    ports: FakePort[]
    volumes: number[]
    notes: (string | null)[]
  } {
    const sockets: FakeSocket[] = []
    const volumes: number[] = []
    const notes: (string | null)[] = []
    const sound = new SlideSound({
      connect: () => {
        const s = new FakeSocket()
        sockets.push(s)
        return s
      },
      setVolume: async (v) => void volumes.push(v),
      onNote: (n) => notes.push(n)
    })
    const ports = [new FakePort()]
    sound.fanout.add(1, ports[0])
    return { sound, sockets, ports, volumes, notes }
  }

  it('pipe mode: reads the pipe and forwards the sound while a native slide is on air', () => {
    const { sound, sockets, ports, volumes, notes } = setup()
    sound.engineAudio({ mode: 'pipe', pipe: 'p', note: null })
    sound.program(live(), DEFAULT_AUDIO)
    sockets[0].emit('data', pcm(PCM_FRAMES))
    expect(ports[0].sent).toHaveLength(1)
    expect(volumes).toEqual([]) // the level is applied in the output window's gain
    expect(notes.at(-1) ?? null).toBeNull()
    sound.program(initialState, DEFAULT_AUDIO)
    sockets[0].emit('data', pcm(PCM_FRAMES))
    expect(ports[0].sent).toHaveLength(1)
  })
  it('fallback (no pipe): no connection; the level goes to PowerPoint and the default-device copy shows', () => {
    const { sound, sockets, volumes, notes } = setup()
    sound.engineAudio({ mode: 'fallback', pipe: null, note: null })
    sound.program(live(50), { ...DEFAULT_AUDIO, masterVolume: 80 })
    expect(sockets).toHaveLength(0)
    expect(volumes).toHaveLength(1)
    expect(volumes[0]).toBeCloseTo(0.4)
    expect(notes.at(-1)).toBe(COPY)
  })
  it('sends a level only when it changes, and 0 on mute', () => {
    const { sound, volumes } = setup()
    sound.engineAudio({ mode: 'fallback', pipe: null, note: null })
    sound.program(live(50), DEFAULT_AUDIO)
    sound.program(live(50), DEFAULT_AUDIO)
    sound.program(live(50), { ...DEFAULT_AUDIO, muted: true })
    expect(volumes).toEqual([0.5, 0])
  })
  it('a foreign PowerPoint (device) keeps the copy and sends nothing', () => {
    const { sound, volumes, notes } = setup()
    sound.engineAudio({ mode: 'device', pipe: null, note: COPY })
    sound.program(live(), DEFAULT_AUDIO)
    expect(volumes).toEqual([])
    expect(notes.at(-1)).toBe(COPY)
  })
  it('the copy only shows while a native slide is on air, and clears when the engine stops', () => {
    const { sound, notes } = setup()
    sound.engineAudio({ mode: 'fallback', pipe: null, note: null })
    sound.program(initialState, DEFAULT_AUDIO)
    expect(notes.at(-1) ?? null).toBeNull()
    sound.program(live(), DEFAULT_AUDIO)
    expect(notes.at(-1)).toBe(COPY)
    sound.engineAudio({ mode: 'none', pipe: null, note: null })
    expect(notes.at(-1)).toBeNull()
  })
  it('a setVolume failure never throws', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const sound = new SlideSound({
      connect: () => new FakeSocket(),
      setVolume: () => Promise.reject(new Error('bridge gone')),
      onNote: () => {}
    })
    sound.engineAudio({ mode: 'fallback', pipe: null, note: null })
    expect(() => sound.program(live(), DEFAULT_AUDIO)).not.toThrow()
    await Promise.resolve()
    warn.mockRestore()
  })
  it('a mode change to none closes the pipe', () => {
    const { sound, sockets } = setup()
    sound.engineAudio({ mode: 'pipe', pipe: 'p', note: null })
    sound.engineAudio({ mode: 'none', pipe: null, note: null })
    expect(sockets[0].destroyed).toBe(true)
  })
})
