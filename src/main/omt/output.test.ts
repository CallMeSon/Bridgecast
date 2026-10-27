import { describe, expect, it } from 'vitest'
import { DEFAULT_OMT, type OmtSettings, type OmtStatus } from '../../shared/omt'
import {
  OmtController,
  type OmtDeps,
  type OmtWindowLike,
  type WindowHandlers,
  type WorkerLike
} from './output'

class FakeWorker implements WorkerLike {
  posted: { m: { type: string; [k: string]: unknown }; transfer?: unknown[] }[] = []
  terminated = false
  private ls: Record<string, ((a?: unknown) => void)[]> = {}
  postMessage(m: unknown, transfer?: unknown[]): void {
    this.posted.push({ m: m as { type: string }, transfer })
  }
  on(ev: string, fn: (a?: unknown) => void): void {
    ;(this.ls[ev] ??= []).push(fn)
  }
  terminate(): Promise<number> {
    this.terminated = true
    return Promise.resolve(0)
  }
  emit(ev: string, a?: unknown): void {
    for (const f of this.ls[ev] ?? []) f(a)
  }
  types(): string[] {
    return this.posted.map((p) => p.m.type)
  }
}

class FakeWindow implements OmtWindowLike {
  sizes: [number, number][] = []
  rates: number[] = []
  invalidates = 0
  destroyed = false
  constructor(
    public h: WindowHandlers,
    public size: { width: number; height: number },
    public fps: number
  ) {}
  resize(w: number, h: number): void {
    this.sizes.push([w, h])
  }
  setFrameRate(n: number): void {
    this.rates.push(n)
  }
  invalidate(): void {
    this.invalidates++
  }
  destroy(): void {
    this.destroyed = true
  }
}

type Rig = ReturnType<typeof rig>
const setup = (...a: Parameters<typeof rig>): Rig => rig(...a)

// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
function rig(settings: Partial<OmtSettings> = {}, canvas = { width: 1920, height: 1080 }) {
  const workers: FakeWorker[] = []
  const windows: FakeWindow[] = []
  const timers: { fn: () => void; ms: number; id: number; live: boolean }[] = []
  const statuses: OmtStatus[] = []
  let clock = 1_000_000
  let cv = { ...canvas }
  const deps: OmtDeps = {
    createWorker: () => {
      const w = new FakeWorker()
      workers.push(w)
      return w
    },
    createWindow: (h, size, fps) => {
      const w = new FakeWindow(h, size, fps)
      windows.push(w)
      return w
    },
    setTimer: (fn, ms) => {
      const t = { fn, ms, id: timers.length, live: true }
      timers.push(t)
      return t.id
    },
    clearTimer: (id) => {
      const t = timers[id as number]
      if (t) t.live = false
    },
    now: () => clock,
    restartDelayMs: 1000,
    stopWaitMs: 1500
  }
  const out = new OmtController(
    { ...DEFAULT_OMT, ...settings },
    () => cv,
    (s) => statuses.push(s),
    deps
  )
  const fire = (ms: number): void => {
    for (const t of timers.filter((x) => x.live && x.ms === ms)) {
      t.live = false
      t.fn()
    }
  }
  return {
    out,
    workers,
    windows,
    timers,
    statuses,
    fire,
    setCanvas: (c: { width: number; height: number }) => (cv = c),
    tick: (ms: number) => (clock += ms)
  }
}

const startMsg = (w: FakeWorker): { type: string; [k: string]: unknown } | undefined =>
  w.posted.map((p) => p.m).find((m) => m.type === 'start')

describe('OmtController', () => {
  it('stays off and builds nothing while disabled', () => {
    const t = setup({ enabled: false })
    t.out.start()
    expect(t.workers).toHaveLength(0)
    expect(t.windows).toHaveLength(0)
    expect(t.out.status().state).toBe('off')
  })

  it('enabling starts one worker with the single omt target, the canvas size, and a black first frame', () => {
    const t = setup({ enabled: true, name: 'Show', fps: 60 })
    t.out.start()
    expect(t.workers).toHaveLength(1)
    expect(startMsg(t.workers[0])).toEqual({
      type: 'start',
      targets: [{ id: 'omt', name: 'Show' }],
      fps: 60,
      width: 1920,
      height: 1080
    })
    expect(t.windows[0].size).toEqual({ width: 1920, height: 1080 })
    expect(t.windows[0].fps).toBe(60)
    const frame = t.workers[0].posted.find((p) => p.m.type === 'frame')!
    expect(frame.m.width).toBe(1920)
    expect(frame.m.height).toBe(1080)
    const data = frame.m.data as ArrayBuffer
    expect(data.byteLength).toBe(1920 * 1080 * 4)
    expect(new Uint8Array(data).subarray(0, 8)).toEqual(
      new Uint8Array([0, 0, 0, 255, 0, 0, 0, 255])
    )
    expect(frame.transfer).toEqual([data])
  })

  it('paints are dropped until this window is ready, then forwarded with transfer', () => {
    const t = setup({ enabled: true })
    t.out.start()
    const w = t.workers[0]
    const before = w.posted.length
    t.windows[0].h.onPaint(1920, 1080, new ArrayBuffer(8))
    expect(w.posted.length).toBe(before)
    t.windows[0].h.onReady()
    const ab = new ArrayBuffer(16)
    t.windows[0].h.onPaint(1920, 1080, ab)
    const last = w.posted[w.posted.length - 1]
    expect(last.m).toMatchObject({ type: 'frame', width: 1920, height: 1080 })
    expect(last.transfer).toEqual([ab])
  })

  it('merges worker status, ignores off while enabled, and reports it', () => {
    const t = setup({ enabled: true })
    t.out.start()
    const w = t.workers[0]
    w.emit('message', {
      type: 'status',
      id: 'omt',
      status: { state: 'running', connections: 0, address: 'HOST (Show)' }
    })
    expect(t.out.status()).toMatchObject({ state: 'running', address: 'HOST (Show)' })
    w.emit('message', { type: 'status', id: 'omt', status: { connections: 2, warning: 'drops' } })
    expect(t.out.status()).toMatchObject({ connections: 2, warning: 'drops' })
    w.emit('message', { type: 'status', id: 'omt', status: { warning: undefined } })
    expect(t.out.status().warning).toBeUndefined()
    w.emit('message', { type: 'status', id: 'omt', status: { state: 'off' } })
    expect(t.out.status().state).toBe('running')
    expect(t.statuses.at(-1)).toMatchObject({ state: 'running' })
  })

  it('library missing: error with that copy, no throw, no restart, window kept', () => {
    const copy = 'OMT could not start: its library is missing. Reinstall PPT Share.'
    const t = setup({ enabled: true })
    expect(() => {
      t.out.start()
      t.workers[0].emit('message', { type: 'status', id: 'omt', status: { state: 'starting' } })
      t.workers[0].emit('message', {
        type: 'status',
        id: 'omt',
        status: { state: 'error', message: copy }
      })
    }).not.toThrow()
    expect(t.out.status()).toMatchObject({ state: 'error', message: copy })
    expect(t.workers).toHaveLength(1)
  })

  it('a worker that cannot even be created gives the error status instead of throwing', () => {
    const t = setup({ enabled: true })
    const bad = new OmtController(
      { ...DEFAULT_OMT, enabled: true },
      () => ({ width: 10, height: 10 }),
      () => {},
      {
        ...({} as OmtDeps),
        createWorker: () => {
          throw new Error('boom')
        },
        createWindow: (h, s, f) => new FakeWindow(h, s, f),
        setTimer: () => 0,
        clearTimer: () => {},
        now: () => 0,
        restartDelayMs: 1000,
        stopWaitMs: 10
      }
    )
    expect(() => bad.start()).not.toThrow()
    expect(bad.status().state).toBe('error')
    void t
  })

  it('name change: stop, wait 1000 ms, only then start with the new name', () => {
    const t = setup({ enabled: true })
    t.out.start()
    const w = t.workers[0]
    t.out.apply({ ...DEFAULT_OMT, enabled: true, name: 'Other' })
    expect(w.types().filter((x) => x === 'stop')).toHaveLength(1)
    expect(w.types().filter((x) => x === 'start')).toHaveLength(1)
    expect(t.timers.some((x) => x.live && x.ms === 1000)).toBe(true)
    t.fire(1000)
    const starts = w.posted.map((p) => p.m).filter((m) => m.type === 'start')
    expect(starts).toHaveLength(2)
    expect((starts[1].targets as { name: string }[])[0].name).toBe('Other')
    expect(w.types().lastIndexOf('stop')).toBeLessThan(w.types().lastIndexOf('start'))
  })

  it('fps change restarts too and sets the window frame rate', () => {
    const t = setup({ enabled: true, fps: 30 })
    t.out.start()
    t.out.apply({ ...DEFAULT_OMT, enabled: true, fps: 60 })
    expect(t.windows[0].rates).toContain(60)
    t.fire(1000)
    const starts = t.workers[0].posted.map((p) => p.m).filter((m) => m.type === 'start')
    expect(starts[1].fps).toBe(60)
  })

  it('canvas change resizes the window and restarts with the new size; same size does nothing', () => {
    const t = setup({ enabled: true })
    t.out.start()
    t.out.canvasChanged()
    expect(t.workers[0].types().filter((x) => x === 'stop')).toHaveLength(0)
    t.setCanvas({ width: 3840, height: 1080 })
    t.out.canvasChanged()
    expect(t.windows[0].sizes).toEqual([[3840, 1080]])
    t.fire(1000)
    const starts = t.workers[0].posted.map((p) => p.m).filter((m) => m.type === 'start')
    expect(starts[1]).toMatchObject({ width: 3840, height: 1080 })
  })

  it('two quick changes while waiting start only once', () => {
    const t = setup({ enabled: true })
    t.out.start()
    t.out.apply({ ...DEFAULT_OMT, enabled: true, name: 'A' })
    t.out.apply({ ...DEFAULT_OMT, enabled: true, name: 'B' })
    t.fire(1000)
    const starts = t.workers[0].posted.map((p) => p.m).filter((m) => m.type === 'start')
    expect(starts).toHaveLength(2)
    expect((starts[1].targets as { name: string }[])[0].name).toBe('B')
  })

  it('renderer crash: window rebuilt after 1000 ms, worker untouched, no black frame, paints ignored until ready', () => {
    const t = setup({ enabled: true })
    t.out.start()
    t.windows[0].h.onReady()
    const w = t.workers[0]
    const n = w.posted.length
    t.windows[0].h.onGone()
    expect(t.windows[0].destroyed).toBe(true)
    expect(w.posted.length).toBe(n)
    t.fire(1000)
    expect(t.windows).toHaveLength(2)
    t.windows[1].h.onPaint(1920, 1080, new ArrayBuffer(8))
    expect(w.posted.length).toBe(n)
    t.windows[1].h.onReady()
    t.windows[1].h.onPaint(1920, 1080, new ArrayBuffer(8))
    expect(w.posted.length).toBe(n + 1)
  })

  it('worker exit restarts with a new worker after the delay', () => {
    const t = setup({ enabled: true })
    t.out.start()
    t.workers[0].emit('exit', 1)
    expect(t.out.status().state).toBe('starting')
    t.fire(1000)
    expect(t.workers).toHaveLength(2)
    expect(startMsg(t.workers[1])).toBeDefined()
    // error then exit of the same dead worker count once
    t.workers[1].emit('error', new Error('x'))
    t.workers[1].emit('exit', 1)
    t.fire(1000)
    expect(t.workers).toHaveLength(3)
  })

  it('three worker failures within a minute: error status, no more retries until off and on', () => {
    const t = setup({ enabled: true })
    t.out.start()
    for (let i = 0; i < 3; i++) {
      t.tick(1000)
      t.workers.at(-1)!.emit('error', new Error('x'))
      t.fire(1000)
    }
    expect(t.workers).toHaveLength(3)
    expect(t.out.status()).toMatchObject({
      state: 'error',
      message: 'OMT could not start. Close other apps that send OMT, then turn OMT off and on.'
    })
    t.out.apply({ ...DEFAULT_OMT, enabled: false })
    expect(t.out.status().state).toBe('off')
    t.out.apply({ ...DEFAULT_OMT, enabled: true })
    expect(t.workers).toHaveLength(4)
    expect(t.out.status().state).toBe('starting')
  })

  it('turning off stops, then terminates the worker only after stopped, and removes the window', async () => {
    const t = setup({ enabled: true })
    t.out.start()
    const w = t.workers[0]
    t.out.apply({ ...DEFAULT_OMT, enabled: false })
    expect(t.windows[0].destroyed).toBe(true)
    expect(w.types().at(-1)).toBe('stop')
    expect(w.terminated).toBe(false)
    w.emit('message', { type: 'stopped' })
    await Promise.resolve()
    await Promise.resolve()
    expect(w.terminated).toBe(true)
    expect(t.out.status().state).toBe('off')
    // the retired worker's exit is not a failure
    w.emit('exit', 1)
    t.fire(1000)
    expect(t.workers).toHaveLength(1)
  })

  it('shutdown sends stop, waits for stopped, then terminates; times out when no answer', async () => {
    const t = setup({ enabled: true })
    t.out.start()
    const w = t.workers[0]
    let done = false
    const p = t.out.shutdown().then(() => (done = true))
    expect(w.types().at(-1)).toBe('stop')
    expect(w.terminated).toBe(false)
    w.emit('message', { type: 'stopped' })
    await p
    expect(done).toBe(true)
    expect(w.terminated).toBe(true)

    const t2 = setup({ enabled: true })
    t2.out.start()
    const w2 = t2.workers[0]
    const p2 = t2.out.shutdown()
    expect(w2.terminated).toBe(false)
    t2.fire(1500)
    await p2
    expect(w2.terminated).toBe(true)
  })

  it('audio from the window goes to the worker as audio with the buffer transferred; bad blocks are dropped', () => {
    const t = setup({ enabled: true })
    t.out.start()
    const a = new Float32Array(8)
    t.windows[0].h.onAudio(a, 4)
    const last = t.workers[0].posted.at(-1)!
    expect(last.m).toMatchObject({ type: 'audio', samples: 4 })
    expect(last.transfer).toEqual([a.buffer])
    const n = t.workers[0].posted.length
    t.windows[0].h.onAudio(new Float32Array(3), 4)
    expect(t.workers[0].posted.length).toBe(n)
  })
})
