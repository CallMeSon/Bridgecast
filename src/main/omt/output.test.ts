import { describe, expect, it } from 'vitest'
import {
  DEFAULT_NDI,
  DEFAULT_OMT,
  type NdiSettings,
  type NetStatus,
  type OmtSettings
} from '../../shared/omt'
import {
  NetController,
  type OmtDeps,
  type OmtWindowLike,
  type WindowHandlers,
  type WorkerLike
} from './output'

const frameBuf = (w = 1920, h = 1080): ArrayBuffer => new ArrayBuffer(w * h * 4)

class FakeWorker implements WorkerLike {
  posted: { m: { type: string; [k: string]: unknown }; transfer?: unknown[] }[] = []
  terminated = false
  hangTerminate = false
  private ls: Record<string, ((a?: unknown) => void)[]> = {}
  postMessage(m: unknown, transfer?: unknown[]): void {
    this.posted.push({ m: m as { type: string }, transfer })
  }
  on(ev: string, fn: (a?: unknown) => void): void {
    ;(this.ls[ev] ??= []).push(fn)
  }
  terminate(): Promise<number> {
    this.terminated = true
    return this.hangTerminate ? new Promise<number>(() => {}) : Promise.resolve(0)
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

const cfg = (
  omt: Partial<OmtSettings> = {},
  ndi: Partial<NdiSettings> = {}
): { omt: OmtSettings; ndi: NdiSettings } => ({
  omt: { ...DEFAULT_OMT, ...omt },
  ndi: { ...DEFAULT_NDI, ...ndi }
})

type Rig = ReturnType<typeof rig>
const setup = (...a: Parameters<typeof rig>): Rig => rig(...a)

// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
function rig(
  settings: Partial<OmtSettings> = {},
  canvas = { width: 1920, height: 1080 },
  ndi: Partial<NdiSettings> = {}
) {
  const workers: FakeWorker[] = []
  const windows: FakeWindow[] = []
  const timers: { fn: () => void; ms: number; id: number; live: boolean }[] = []
  const statuses: NetStatus[] = []
  const ndiStatuses: NetStatus[] = []
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
  const out = new NetController(
    cfg(settings, ndi),
    () => cv,
    (id, s) => (id === 'omt' ? statuses : ndiStatuses).push(s),
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
    ndiStatuses,
    fire,
    setCanvas: (c: { width: number; height: number }) => (cv = c),
    tick: (ms: number) => (clock += ms)
  }
}

const startMsg = (w: FakeWorker): { type: string; [k: string]: unknown } | undefined =>
  w.posted.map((p) => p.m).find((m) => m.type === 'start')

describe('NetController', () => {
  it('stays off and builds nothing while disabled', () => {
    const t = setup({ enabled: false })
    t.out.start()
    expect(t.workers).toHaveLength(0)
    expect(t.windows).toHaveLength(0)
    expect(t.out.status('omt').state).toBe('off')
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
    t.windows[0].h.onPaint(1920, 1080, frameBuf())
    expect(w.posted.length).toBe(before)
    t.windows[0].h.onReady()
    const ab = frameBuf()
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
    expect(t.out.status('omt')).toMatchObject({ state: 'running', address: 'HOST (Show)' })
    w.emit('message', { type: 'status', id: 'omt', status: { connections: 2, warning: 'drops' } })
    expect(t.out.status('omt')).toMatchObject({ connections: 2, warning: 'drops' })
    w.emit('message', { type: 'status', id: 'omt', status: { warning: undefined } })
    expect(t.out.status('omt').warning).toBeUndefined()
    w.emit('message', { type: 'status', id: 'omt', status: { state: 'off' } })
    expect(t.out.status('omt').state).toBe('running')
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
    expect(t.out.status('omt')).toMatchObject({ state: 'error', message: copy })
    expect(t.workers).toHaveLength(1)
  })

  it('a worker that cannot even be created gives the error status instead of throwing', () => {
    const t = setup({ enabled: true })
    const bad = new NetController(
      cfg({ enabled: true }),
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
    expect(bad.status('omt').state).toBe('error')
    void t
  })

  it('name change: the target is removed, then added with the new name after 1000 ms; no sender restart', () => {
    const t = setup({ enabled: true })
    t.out.start()
    const w = t.workers[0]
    t.out.apply(cfg({ enabled: true, name: 'Other' }))
    const targets = (): unknown[] =>
      w.posted
        .map((p) => p.m)
        .filter((m) => m.type === 'targets')
        .map((m) => m.targets)
    expect(w.types().filter((x) => x === 'stop')).toHaveLength(0)
    expect(w.types().filter((x) => x === 'start')).toHaveLength(1)
    expect(targets()).toEqual([[]])
    expect(t.out.status('omt').state).toBe('starting')
    expect(t.timers.some((x) => x.live && x.ms === 1000)).toBe(true)
    t.fire(1000)
    expect(targets()).toEqual([[], [{ id: 'omt', name: 'Other' }]])
  })

  it('fps change restarts too and sets the window frame rate', () => {
    const t = setup({ enabled: true, fps: 30 })
    t.out.start()
    t.out.apply(cfg({ enabled: true, fps: 60 }))
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

  it('two quick changes while waiting add the target only once, with the last name', () => {
    const t = setup({ enabled: true })
    t.out.start()
    t.out.apply(cfg({ enabled: true, name: 'A' }))
    t.out.apply(cfg({ enabled: true, name: 'B' }))
    t.fire(1000)
    const adds = t.workers[0].posted
      .map((p) => p.m)
      .filter((m) => m.type === 'targets' && (m.targets as unknown[]).length > 0)
    expect(adds).toHaveLength(1)
    expect((adds[0].targets as { name: string }[])[0].name).toBe('B')
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
    t.windows[1].h.onPaint(1920, 1080, frameBuf())
    expect(w.posted.length).toBe(n)
    t.windows[1].h.onReady()
    t.windows[1].h.onPaint(1920, 1080, frameBuf())
    expect(w.posted.length).toBe(n + 1)
  })

  it('worker exit restarts with a new worker after the delay', () => {
    const t = setup({ enabled: true })
    t.out.start()
    t.workers[0].emit('exit', 1)
    expect(t.out.status('omt').state).toBe('starting')
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
    expect(t.out.status('omt')).toMatchObject({
      state: 'error',
      message: 'OMT could not start. Close other apps that send OMT, then turn OMT off and on.'
    })
    t.out.apply(cfg({ enabled: false }))
    expect(t.out.status('omt').state).toBe('off')
    t.out.apply(cfg({ enabled: true }))
    expect(t.workers).toHaveLength(4)
    expect(t.out.status('omt').state).toBe('starting')
  })

  it('turning off stops, then terminates the worker only after stopped, and removes the window', async () => {
    const t = setup({ enabled: true })
    t.out.start()
    const w = t.workers[0]
    t.out.apply(cfg({ enabled: false }))
    expect(t.windows[0].destroyed).toBe(true)
    expect(w.types().at(-1)).toBe('stop')
    expect(w.terminated).toBe(false)
    w.emit('message', { type: 'stopped' })
    await Promise.resolve()
    await Promise.resolve()
    expect(w.terminated).toBe(true)
    expect(t.out.status('omt').state).toBe('off')
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

  it('shutdown still resolves in bounded time when terminate() never settles', async () => {
    const t = setup({ enabled: true })
    t.out.start()
    const w = t.workers[0]
    w.hangTerminate = true
    let done = false
    const p = t.out.shutdown().then(() => (done = true))
    w.emit('message', { type: 'stopped' })
    await Promise.resolve()
    await Promise.resolve()
    expect(w.terminated).toBe(true)
    expect(done).toBe(false)
    t.fire(1500)
    await p
    expect(done).toBe(true)
  })

  it('drops paints whose byte length or size does not match the Canvas', () => {
    const t = setup({ enabled: true })
    t.out.start()
    t.windows[0].h.onReady()
    const n = t.workers[0].posted.length
    t.windows[0].h.onPaint(1920, 1080, new ArrayBuffer(100))
    t.windows[0].h.onPaint(1920, 1028, frameBuf(1920, 1028))
    expect(t.workers[0].posted.length).toBe(n)
    t.windows[0].h.onPaint(1920, 1080, frameBuf())
    expect(t.workers[0].posted.length).toBe(n + 1)
  })

  describe('no-sound warning from the window', () => {
    const running = (t: Rig): void => {
      t.out.start()
      t.workers[0].emit('message', {
        type: 'status',
        id: 'omt',
        status: { state: 'running', connections: 0, address: 'H' }
      })
    }

    it('sets status.warning and broadcasts it', () => {
      const t = setup({ enabled: true })
      running(t)
      t.windows[0].h.onWarning('no-sound')
      expect(t.out.status('omt').warning).toBe('no-sound')
      expect(t.statuses.at(-1)).toMatchObject({ state: 'running', warning: 'no-sound' })
    })

    it('survives sender status updates, drops and a sender restart; no-sound wins over drops', () => {
      const t = setup({ enabled: true, name: 'A' })
      running(t)
      t.windows[0].h.onWarning('no-sound')
      t.workers[0].emit('message', { type: 'status', id: 'omt', status: { warning: 'drops' } })
      expect(t.out.status('omt').warning).toBe('no-sound')
      t.workers[0].emit('message', { type: 'status', id: 'omt', status: { warning: undefined } })
      expect(t.out.status('omt').warning).toBe('no-sound')
      t.out.apply(cfg({ enabled: true, name: 'B' }))
      expect(t.out.status('omt').warning).toBe('no-sound')
      expect(t.windows).toHaveLength(1)
    })

    it('is cleared when OMT is turned off', () => {
      const t = setup({ enabled: true })
      running(t)
      t.windows[0].h.onWarning('no-sound')
      t.out.apply(cfg({ enabled: false }))
      expect(t.out.status('omt').warning).toBeUndefined()
      expect(t.out.status('omt').state).toBe('off')
    })

    it('is cleared when the window is recreated, and a stale window cannot set it', () => {
      const t = setup({ enabled: true })
      running(t)
      const old = t.windows[0]
      old.h.onWarning('no-sound')
      old.h.onGone()
      expect(t.out.status('omt').warning).toBeUndefined()
      old.h.onWarning('no-sound')
      expect(t.out.status('omt').warning).toBeUndefined()
    })

    it('ignores any other payload', () => {
      const t = setup({ enabled: true })
      running(t)
      for (const bad of ['drops', 'no-receivers', '', null, undefined, 1, { a: 1 }, ['no-sound']])
        t.windows[0].h.onWarning(bad)
      expect(t.out.status('omt').warning).toBeUndefined()
    })
  })
})

describe('NetController with OMT and NDI', () => {
  const targetsMsgs = (w: FakeWorker): unknown[] =>
    w.posted
      .map((p) => p.m)
      .filter((m) => m.type === 'targets')
      .map((m) => m.targets)
  const run = (t: Rig, id: 'omt' | 'ndi'): void =>
    t.workers[0].emit('message', {
      type: 'status',
      id,
      status: { state: 'running', connections: 0, address: id }
    })

  it('NDI alone starts one window and a worker with only the ndi target', () => {
    const t = setup({ enabled: false }, undefined, { enabled: true, name: 'N' })
    t.out.start()
    expect(t.windows).toHaveLength(1)
    expect(startMsg(t.workers[0])).toMatchObject({ targets: [{ id: 'ndi', name: 'N' }], fps: 30 })
    expect(t.out.status('omt').state).toBe('off')
    expect(t.out.status('ndi').state).toBe('starting')
  })

  it('the frame rate is omt.fps for NDI alone too', () => {
    const t = setup({ enabled: false, fps: 60 }, undefined, { enabled: true })
    t.out.start()
    expect(t.windows[0].fps).toBe(60)
    expect(startMsg(t.workers[0])?.fps).toBe(60)
  })

  it('both on start one window and one worker with both targets', () => {
    const t = setup({ enabled: true, name: 'O' }, undefined, { enabled: true, name: 'N' })
    t.out.start()
    expect(t.windows).toHaveLength(1)
    expect(t.workers).toHaveLength(1)
    expect(startMsg(t.workers[0])?.targets).toEqual([
      { id: 'omt', name: 'O' },
      { id: 'ndi', name: 'N' }
    ])
  })

  it('switching NDI on while OMT runs adds the target without stop, start, window or worker change', () => {
    const t = setup({ enabled: true })
    t.out.start()
    run(t, 'omt')
    const w = t.workers[0]
    const posted = w.posted.length
    const omtStatuses = t.statuses.length
    t.out.apply(cfg({ enabled: true }, { enabled: true, name: 'N' }))
    expect(w.posted.slice(posted).map((p) => p.m)).toEqual([
      {
        type: 'targets',
        targets: [
          { id: 'omt', name: 'PPT Share' },
          { id: 'ndi', name: 'N' }
        ]
      }
    ])
    expect(t.windows).toHaveLength(1)
    expect(t.workers).toHaveLength(1)
    expect(t.out.status('omt').state).toBe('running')
    expect(t.statuses).toHaveLength(omtStatuses)
    expect(t.out.status('ndi').state).toBe('starting')
  })

  it('switching NDI off while OMT runs removes only NDI', () => {
    const t = setup({ enabled: true }, undefined, { enabled: true })
    t.out.start()
    run(t, 'omt')
    run(t, 'ndi')
    const w = t.workers[0]
    const posted = w.posted.length
    t.out.apply(cfg({ enabled: true }, { enabled: false }))
    expect(w.posted.slice(posted).map((p) => p.m)).toEqual([
      { type: 'targets', targets: [{ id: 'omt', name: 'PPT Share' }] }
    ])
    expect(t.out.status('ndi').state).toBe('off')
    expect(t.out.status('omt').state).toBe('running')
    expect(t.windows[0].destroyed).toBe(false)
    // a late report from the removed target is stale
    w.emit('message', { type: 'status', id: 'ndi', status: { connections: 3 } })
    expect(t.out.status('ndi')).toMatchObject({ state: 'off', connections: 0 })
  })

  it('a missing NDI runtime errors NDI only; OMT stays running and nothing restarts', () => {
    const t = setup({ enabled: true }, undefined, { enabled: true })
    t.out.start()
    run(t, 'omt')
    t.workers[0].emit('message', {
      type: 'status',
      id: 'ndi',
      status: { state: 'error', message: 'NDI could not start' }
    })
    expect(t.out.status('ndi')).toMatchObject({ state: 'error', message: 'NDI could not start' })
    expect(t.out.status('omt').state).toBe('running')
    expect(t.workers).toHaveLength(1)
    expect(t.workers[0].types().filter((x) => x === 'stop')).toHaveLength(0)
  })

  it('OMT name change with NDI running leaves NDI alone', () => {
    const t = setup({ enabled: true }, undefined, { enabled: true, name: 'N' })
    t.out.start()
    run(t, 'omt')
    run(t, 'ndi')
    const w = t.workers[0]
    t.out.apply(cfg({ enabled: true, name: 'Other' }, { enabled: true, name: 'N' }))
    expect(t.out.status('ndi').state).toBe('running')
    expect(t.out.status('omt').state).toBe('starting')
    t.fire(1000)
    expect(targetsMsgs(w)).toEqual([
      [{ id: 'ndi', name: 'N' }],
      [
        { id: 'omt', name: 'Other' },
        { id: 'ndi', name: 'N' }
      ]
    ])
    expect(w.types().filter((x) => x === 'stop')).toHaveLength(0)
  })

  it('an fps change with both on restarts the sender once, for both targets', () => {
    const t = setup({ enabled: true }, undefined, { enabled: true })
    t.out.start()
    t.out.apply(cfg({ enabled: true, fps: 60 }, { enabled: true }))
    const w = t.workers[0]
    expect(w.types().filter((x) => x === 'stop')).toHaveLength(1)
    expect(t.windows[0].rates).toEqual([60])
    expect(t.out.status('omt').state).toBe('starting')
    expect(t.out.status('ndi').state).toBe('starting')
    t.fire(1000)
    const starts = w.posted.map((p) => p.m).filter((m) => m.type === 'start')
    expect(starts).toHaveLength(2)
    expect(starts[1]).toMatchObject({ fps: 60 })
    expect((starts[1].targets as unknown[]).length).toBe(2)
  })

  it('a canvas change with both on restarts the sender once', () => {
    const t = setup({ enabled: true }, undefined, { enabled: true })
    t.out.start()
    t.setCanvas({ width: 3840, height: 1080 })
    t.out.canvasChanged()
    t.out.canvasChanged()
    expect(t.workers[0].types().filter((x) => x === 'stop')).toHaveLength(1)
    t.fire(1000)
    const starts = t.workers[0].posted.map((p) => p.m).filter((m) => m.type === 'start')
    expect(starts).toHaveLength(2)
    expect(starts[1]).toMatchObject({ width: 3840, height: 1080 })
  })

  it('turning NDI on during an fps restart waits for that one start', () => {
    const t = setup({ enabled: true })
    t.out.start()
    t.out.apply(cfg({ enabled: true, fps: 60 }))
    t.out.apply(cfg({ enabled: true, fps: 60 }, { enabled: true }))
    expect(targetsMsgs(t.workers[0])).toEqual([])
    t.fire(1000)
    const starts = t.workers[0].posted.map((p) => p.m).filter((m) => m.type === 'start')
    expect((starts[1].targets as unknown[]).length).toBe(2)
  })

  it('turning both off removes the window and stops the worker; either one keeps it', async () => {
    const t = setup({ enabled: true }, undefined, { enabled: true })
    t.out.start()
    t.out.apply(cfg({ enabled: false }, { enabled: true }))
    expect(t.windows[0].destroyed).toBe(false)
    expect(t.out.status('omt').state).toBe('off')
    t.out.apply(cfg({ enabled: false }, { enabled: false }))
    expect(t.windows[0].destroyed).toBe(true)
    expect(t.workers[0].types().at(-1)).toBe('stop')
    expect(t.out.status('ndi').state).toBe('off')
  })

  it('NDI turned on from nothing creates window and worker', () => {
    const t = setup({ enabled: false })
    t.out.start()
    expect(t.workers).toHaveLength(0)
    t.out.apply(cfg({ enabled: false }, { enabled: true }))
    expect(t.workers).toHaveLength(1)
    expect(t.windows).toHaveLength(1)
    expect(startMsg(t.workers[0])?.targets).toEqual([{ id: 'ndi', name: 'PPT Share' }])
  })

  it('removing the last target then adding one asks for a fresh frame', () => {
    const t = setup({ enabled: true })
    t.out.start()
    t.windows[0].h.onReady()
    const inv = t.windows[0].invalidates
    t.out.apply(cfg({ enabled: true }, { enabled: true }))
    expect(t.windows[0].invalidates).toBe(inv)
    t.out.apply(cfg({ enabled: false }, { enabled: true }))
    t.out.apply(cfg({ enabled: false }, { enabled: false }))
    t.out.apply(cfg({ enabled: false }, { enabled: true }))
    expect(t.windows).toHaveLength(2)
  })

  it('the no-sound warning shows on both targets and clears with the window', () => {
    const t = setup({ enabled: true }, undefined, { enabled: true })
    t.out.start()
    run(t, 'omt')
    run(t, 'ndi')
    t.windows[0].h.onWarning('no-sound')
    expect(t.out.status('omt').warning).toBe('no-sound')
    expect(t.out.status('ndi').warning).toBe('no-sound')
    t.windows[0].h.onGone()
    expect(t.out.status('omt').warning).toBeUndefined()
    expect(t.out.status('ndi').warning).toBeUndefined()
  })

  it('three worker failures give each enabled target its own error copy', () => {
    const t = setup({ enabled: true }, undefined, { enabled: true })
    t.out.start()
    for (let i = 0; i < 3; i++) {
      t.tick(1000)
      t.workers.at(-1)!.emit('error', new Error('x'))
      t.fire(1000)
    }
    expect(t.out.status('omt').message).toMatch(/^OMT could not start/)
    expect(t.out.status('ndi').message).toMatch(/^NDI could not start/)
  })
})
