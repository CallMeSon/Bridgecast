import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  HELPER_START_FAILED,
  PowerPointEngine,
  bridgeExePath,
  type BridgeChild
} from './powerpoint-engine'

type Msg = Record<string, unknown>

/** A scripted stand-in for ppt-bridge.exe. */
class FakeChild implements BridgeChild {
  written: Msg[] = []
  stdinEnded = false
  killed = false
  exitCbs: ((c: number | null) => void)[] = []
  errCbs: ((e: Error) => void)[] = []
  dataCbs: ((c: Buffer | string) => void)[] = []
  /** What to answer per command; return undefined for no reply. */
  reply: (m: Msg) => Msg | undefined = (m) => ({ id: m.id, ok: true })
  /** Exit when stdin closes (a healthy helper). */
  exitOnEnd = true

  stdin = {
    write: (chunk: string): boolean => {
      for (const line of chunk.split('\n').filter(Boolean)) {
        const m = JSON.parse(line) as Msg
        this.written.push(m)
        const r = this.reply(m)
        if (r) this.send(r)
      }
      return true
    },
    end: (): void => {
      this.stdinEnded = true
      if (this.exitOnEnd) this.exit(0)
    }
  }
  stdout = {
    on: (_ev: 'data', cb: (c: Buffer | string) => void): void => void this.dataCbs.push(cb)
  }
  stderr = { on: (): void => {} }
  on(ev: 'exit', cb: (code: number | null) => void): void
  on(ev: 'error', cb: (err: Error) => void): void
  on(ev: 'exit' | 'error', cb: never): void {
    if (ev === 'exit') this.exitCbs.push(cb)
    else this.errCbs.push(cb)
  }
  kill(): void {
    this.killed = true
    this.exit(null)
  }

  send(m: Msg): void {
    for (const cb of this.dataCbs) cb(JSON.stringify(m) + '\n')
  }
  sendBytes(b: Buffer): void {
    for (const cb of this.dataCbs) cb(b)
  }
  exit(code: number | null): void {
    for (const cb of this.exitCbs) cb(code)
  }
  fail(e: Error): void {
    for (const cb of this.errCbs) cb(e)
  }
}

const canvas = { width: 1920, height: 1080 }
let child: FakeChild
let spawned: string[]
let engine: PowerPointEngine
let startFailures: string[]
let restores: string[]
let procKill: ReturnType<typeof vi.spyOn>

const openReply =
  (extra: Msg = {}) =>
  (m: Msg): Msg | undefined =>
    m.cmd === 'open'
      ? { id: m.id, ok: true, windowId: '1049870', ...extra }
      : { id: m.id, ok: true }

function make(opts: Partial<ConstructorParameters<typeof PowerPointEngine>[0]> = {}): void {
  engine = new PowerPointEngine({
    exe: 'C:\\app\\ppt-bridge.exe',
    spawn: (exe) => {
      spawned.push(exe)
      return child
    },
    exists: () => true,
    dpi: () => 144,
    onStartFailure: (m) => startFailures.push(m),
    restoreAudio: async (exe) => void restores.push(exe),
    shutdownMs: 1000,
    ...opts
  })
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  child = new FakeChild()
  child.reply = openReply()
  spawned = []
  startFailures = []
  restores = []
  procKill = vi.spyOn(process, 'kill').mockImplementation(() => true)
  make()
})
afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('PowerPointEngine', () => {
  it('does not start the helper before the first open, then frames the open request', async () => {
    expect(spawned).toEqual([])
    const s = await engine.open('d1', 'C:\\lib\\source.pptx', canvas)
    expect(spawned).toEqual(['C:\\app\\ppt-bridge.exe'])
    expect(child.written).toHaveLength(1)
    expect(child.written[0]).toMatchObject({
      cmd: 'open',
      deckId: 'd1',
      file: 'C:\\lib\\source.pptx',
      width: 1920,
      height: 1080,
      dpi: 144,
      behind: true
    })
    expect(typeof child.written[0].id).toBe('number')
    expect(s.windowId).toBe('1049870')
    expect(s.deckId).toBe('d1')
  })

  it('maps session calls to commands with the deck id and the 0-based goto index', async () => {
    const s = await engine.open('d1', 'f.pptx', canvas)
    await s.next()
    await s.prev()
    await s.goto(3)
    await s.close()
    expect(child.written.slice(1).map((m) => [m.cmd, m.deckId, m.index])).toEqual([
      ['next', 'd1', undefined],
      ['prev', 'd1', undefined],
      ['goto', 'd1', 3],
      ['close', 'd1', undefined]
    ])
  })

  it('reuses one helper for several sessions', async () => {
    await engine.open('a', 'a.pptx', canvas)
    await engine.open('b', 'b.pptx', canvas)
    expect(spawned).toHaveLength(1)
  })

  it('rejects a call with the bridge code and message', async () => {
    const s = await engine.open('d1', 'f.pptx', canvas)
    child.reply = (m) => ({ id: m.id, ok: false, code: 'nosession', message: 'not open' })
    await expect(s.next()).rejects.toMatchObject({ code: 'nosession', message: 'not open' })
  })

  it('rejects an open without a window id', async () => {
    child.reply = (m) => ({ id: m.id, ok: true })
    await expect(engine.open('d1', 'f.pptx', canvas)).rejects.toMatchObject({ code: 'protocol' })
  })

  it('maps bridge events: position, error, exited', async () => {
    const pos: unknown[] = []
    const errs: unknown[] = []
    let exited = 0
    engine.on('position', (p) => pos.push(p))
    engine.on('error', (e) => errs.push(e))
    engine.on('exited', () => exited++)
    await engine.open('d1', 'f.pptx', canvas)
    child.send({ event: 'position', deckId: 'd1', index: 2, step: 1, clicks: 3 })
    child.send({ event: 'position', deckId: 'd1', index: '2', step: 1, clicks: 3 }) // malformed: ignored
    child.send({ event: 'error', deckId: 'd1', message: 'closed' })
    child.send({ event: 'error', message: 'general' })
    expect(pos).toEqual([{ deckId: 'd1', index: 2, step: 1, clicks: 3 }])
    expect(errs).toEqual([{ deckId: 'd1', message: 'closed' }, { message: 'general' }])
    child.send({ event: 'exited' })
    expect(exited).toBe(1)
    child.exit(1) // the process ends right after: no second event
    expect(exited).toBe(1)
  })

  it('decodes UTF-8 split over chunks', async () => {
    const errs: { message: string }[] = []
    engine.on('error', (e) => errs.push(e))
    await engine.open('d1', 'f.pptx', canvas)
    const buf = Buffer.from(JSON.stringify({ event: 'error', message: 'é日本' }) + '\n', 'utf8')
    const cut = buf.indexOf(0xc3) + 1 // inside "é"
    child.sendBytes(buf.subarray(0, cut))
    child.sendBytes(buf.subarray(cut))
    expect(errs[0].message).toBe('é日本')
  })

  it('an unexpected process exit fails calls in flight and emits exited once', async () => {
    let exited = 0
    engine.on('exited', () => exited++)
    const s = await engine.open('d1', 'f.pptx', canvas)
    child.reply = () => undefined
    const p = s.next()
    child.exit(1)
    await expect(p).rejects.toMatchObject({ code: 'exited' })
    expect(exited).toBe(1)
    await expect(s.next()).rejects.toMatchObject({ code: 'exited' })
    expect(engine.running).toBe(false)
  })

  it('starts a new helper for the next open after the old one exited', async () => {
    await engine.open('a', 'a.pptx', canvas)
    child.exit(1)
    const second = new FakeChild()
    second.reply = openReply({ windowId: '77' })
    child = second
    const s = await engine.open('a', 'a.pptx', canvas)
    expect(spawned).toHaveLength(2)
    expect(s.windowId).toBe('77')
  })

  describe('ping', () => {
    it('sends a ping request and resolves on the reply', async () => {
      await engine.open('d1', 'f.pptx', canvas)
      await engine.ping()
      expect(child.written.at(-1)).toMatchObject({ cmd: 'ping' })
    })

    it('rejects when the helper does not answer within 3 s (hung)', async () => {
      await engine.open('d1', 'f.pptx', canvas)
      child.reply = () => undefined
      const p = engine.ping()
      const assertion = expect(p).rejects.toMatchObject({ code: 'timeout' })
      await vi.advanceTimersByTimeAsync(3000)
      await assertion
    })

    it('resolves at once when no helper runs (nothing can hang)', async () => {
      await expect(engine.ping()).resolves.toBeUndefined()
      expect(spawned).toEqual([])
    })
  })

  describe('start failure', () => {
    it('spawn throwing rejects open with the helper copy and reports it', async () => {
      make({
        spawn: () => {
          throw new Error('EACCES')
        }
      })
      await expect(engine.open('d1', 'f.pptx', canvas)).rejects.toMatchObject({
        code: 'start',
        message: HELPER_START_FAILED
      })
      expect(startFailures).toEqual([HELPER_START_FAILED])
      expect(engine.helperError).toBe(HELPER_START_FAILED)
    })

    it('a missing exe never spawns', async () => {
      make({ exists: () => false })
      await expect(engine.open('d1', 'f.pptx', canvas)).rejects.toMatchObject({ code: 'start' })
      expect(spawned).toEqual([])
      expect(startFailures).toEqual([HELPER_START_FAILED])
    })

    it('an async spawn error (ENOENT) rejects the pending open and emits no exited', async () => {
      let exited = 0
      engine.on('exited', () => exited++)
      child.reply = () => undefined
      const p = engine.open('d1', 'f.pptx', canvas)
      child.fail(Object.assign(new Error('spawn ENOENT'), { code: 'ENOENT' }))
      await expect(p).rejects.toMatchObject({ code: 'start', message: HELPER_START_FAILED })
      expect(startFailures).toEqual([HELPER_START_FAILED])
      expect(exited).toBe(0)
    })

    it('exit before any output is a failed start; exit after output is a crash', async () => {
      let exited = 0
      engine.on('exited', () => exited++)
      child.reply = () => undefined
      const p = engine.open('d1', 'f.pptx', canvas)
      child.exit(1)
      await expect(p).rejects.toMatchObject({ code: 'start' })
      expect(exited).toBe(0)

      child = new FakeChild()
      child.reply = openReply()
      await engine.open('d1', 'f.pptx', canvas)
      child.exit(1)
      expect(exited).toBe(1)
    })
  })

  describe('shutdown', () => {
    it('closes stdin, waits for the exit and emits no exited', async () => {
      let exited = 0
      engine.on('exited', () => exited++)
      await engine.open('d1', 'f.pptx', canvas)
      await engine.shutdown()
      expect(child.stdinEnded).toBe(true)
      expect(child.killed).toBe(false)
      expect(exited).toBe(0)
      expect(engine.running).toBe(false)
    })

    it('kills only the helper process when it does not exit in time', async () => {
      await engine.open('d1', 'f.pptx', canvas)
      child.exitOnEnd = false
      const p = engine.shutdown()
      await vi.advanceTimersByTimeAsync(1000)
      await p
      expect(child.killed).toBe(true)
    })

    it('is harmless without a helper and a later open starts a new one', async () => {
      await engine.shutdown()
      await engine.open('d1', 'f.pptx', canvas)
      await engine.shutdown()
      child = new FakeChild()
      child.reply = openReply()
      await engine.open('d1', 'f.pptx', canvas)
      expect(spawned).toHaveLength(2)
    })

    it('fails requests in flight', async () => {
      const s = await engine.open('d1', 'f.pptx', canvas)
      child.reply = () => undefined
      const p = s.next()
      void engine.shutdown()
      await expect(p).rejects.toMatchObject({ code: 'exited' })
    })
  })

  describe('hung helper: only the helper is killed, never a PowerPoint', () => {
    async function hang(c: FakeChild, run: () => Promise<void>): Promise<void> {
      c.exitOnEnd = false
      const p = run()
      await vi.advanceTimersByTimeAsync(5000)
      await p
    }

    it('owned PowerPoint + hung helper: the helper is killed, no pid is', async () => {
      await engine.open('d1', 'f.pptx', canvas)
      child.send({ event: 'app', pid: 4321, owned: true })
      expect(engine.powerPoint).toEqual({ pid: 4321, owned: true })
      await hang(child, () => engine.shutdown())
      expect(child.killed).toBe(true)
      expect(procKill).not.toHaveBeenCalled()
    })

    it('foreign PowerPoint + hung helper: no pid is killed', async () => {
      await engine.open('d1', 'f.pptx', canvas)
      child.send({ event: 'app', pid: 4321, owned: false })
      await hang(child, () => engine.shutdown())
      expect(child.killed).toBe(true)
      expect(procKill).not.toHaveBeenCalled()
    })

    it('edit window opened + hung helper: no pid is killed', async () => {
      await engine.open('d1', 'f.pptx', canvas)
      child.send({ event: 'app', pid: 4321, owned: true })
      await engine.edit('C:\\lib\\edit.pptx')
      await hang(child, () => engine.shutdown())
      expect(child.killed).toBe(true)
      expect(procKill).not.toHaveBeenCalled()
    })

    it('waits the full 5 s before killing the helper by default', async () => {
      make({ shutdownMs: undefined })
      await engine.open('d1', 'f.pptx', canvas)
      child.exitOnEnd = false
      const p = engine.shutdown()
      await vi.advanceTimersByTimeAsync(4999)
      expect(child.killed).toBe(false)
      await vi.advanceTimersByTimeAsync(1)
      await p
      expect(child.killed).toBe(true)
    })

    it('graceful end and malformed or missing app events: nothing is killed', async () => {
      await engine.open('d1', 'f.pptx', canvas)
      child.send({ event: 'app', pid: 4321, owned: true })
      await engine.shutdown()
      expect(child.killed).toBe(false)
      child = new FakeChild()
      child.reply = openReply()
      await engine.open('d1', 'f.pptx', canvas)
      child.send({ event: 'app', pid: 'x', owned: true })
      child.send({ event: 'app', pid: -3, owned: true })
      expect(engine.powerPoint).toBeNull()
      await hang(child, () => engine.shutdown())
      expect(procKill).not.toHaveBeenCalled()
    })
  })

  describe('audio settings restore', () => {
    it('runs --restore-audio at the first start only', async () => {
      await engine.open('a', 'a.pptx', canvas)
      await engine.open('b', 'b.pptx', canvas)
      expect(restores).toEqual(['C:\\app\\ppt-bridge.exe'])
    })

    it('runs it after an abnormal exit and after a killed helper, not after a clean shutdown', async () => {
      await engine.open('a', 'a.pptx', canvas)
      restores.length = 0
      await engine.shutdown()
      expect(restores).toEqual([])
      child = new FakeChild()
      child.reply = openReply()
      await engine.open('a', 'a.pptx', canvas)
      child.exit(1)
      expect(restores).toHaveLength(1)
      child = new FakeChild()
      child.reply = openReply()
      await engine.open('a', 'a.pptx', canvas)
      child.exitOnEnd = false
      const p = engine.shutdown()
      await vi.advanceTimersByTimeAsync(1000)
      await p
      expect(restores).toHaveLength(2)
    })
  })

  describe('audio and edit', () => {
    it('a foreign PowerPoint refuses setVolume: no throw, default-device copy', async () => {
      child.reply = openReply({ audio: 'fallback' })
      await engine.open('d1', 'f.pptx', canvas)
      child.reply = (m) =>
        m.cmd === 'setVolume'
          ? { id: m.id, ok: false, code: 'foreignapp', message: 'x' }
          : { id: m.id, ok: true }
      await expect(engine.setVolume(0.3)).resolves.toBeUndefined()
      expect(engine.audioNote).toBe("PowerPoint sound plays on this PC's default device only.")
    })

    it('audio device mode from open sets the default-device copy', async () => {
      child.reply = openReply({ audio: 'device' })
      await engine.open('d1', 'f.pptx', canvas)
      expect(engine.audioMode).toBe('device')
      expect(engine.audioNote).toBe("PowerPoint sound plays on this PC's default device only.")
    })

    it('other setVolume failures still reject', async () => {
      await engine.open('d1', 'f.pptx', canvas)
      child.reply = (m) => ({ id: m.id, ok: false, code: 'error', message: 'boom' })
      await expect(engine.setVolume(0.3)).rejects.toMatchObject({ code: 'error' })
    })

    it('keeps the audio pipe the open reply reports', async () => {
      child.reply = openReply({ audio: 'pipe', audioPipe: '\\\\.\\pipe\\pptshare-audio-42' })
      await engine.open('d1', 'f.pptx', canvas)
      expect(engine.audioMode).toBe('pipe')
      expect(engine.audioPipe).toBe('\\\\.\\pipe\\pptshare-audio-42')
    })

    it('fallback audio applies the remembered level through setVolume', async () => {
      await engine.setVolume(0.4) // helper not running: remembered
      child.reply = openReply({ audio: 'fallback' })
      await engine.open('d1', 'f.pptx', canvas)
      await vi.advanceTimersByTimeAsync(0)
      expect(engine.audioMode).toBe('fallback')
      expect(child.written.at(-1)).toMatchObject({ cmd: 'setVolume', volume: 0.4 })
      await engine.setVolume(5)
      expect(child.written.at(-1)).toMatchObject({ cmd: 'setVolume', volume: 1 })
    })

    it('reports the sound route to the app: pipe, then none after shutdown', async () => {
      const seen: unknown[] = []
      make({ onAudio: (a) => seen.push(a) })
      child.reply = openReply({ audio: 'pipe', audioPipe: '\\\\.\\pipe\\pptshare-audio-42' })
      await engine.open('d1', 'f.pptx', canvas)
      expect(seen.at(-1)).toEqual({
        mode: 'pipe',
        pipe: '\\\\.\\pipe\\pptshare-audio-42',
        note: null
      })
      const done = engine.shutdown()
      child.exit(0)
      await done
      expect(seen.at(-1)).toEqual({ mode: 'none', pipe: null, note: null })
    })

    it('reports the default-device copy for the fallback and a foreign PowerPoint', async () => {
      const seen: { mode: string; pipe: string | null; note: string | null }[] = []
      make({ onAudio: (a) => seen.push(a) })
      child.reply = openReply({ audio: 'fallback' })
      await engine.open('d1', 'f.pptx', canvas)
      expect(seen.at(-1)).toEqual({ mode: 'fallback', pipe: null, note: null })
      child.reply = (m) =>
        m.cmd === 'setVolume'
          ? { id: m.id, ok: false, code: 'foreignapp', message: 'x' }
          : { id: m.id, ok: true }
      await engine.setVolume(0.3)
      expect(seen.at(-1)?.note).toBe("PowerPoint sound plays on this PC's default device only.")
    })

    it('a helper that exits unexpectedly reports no sound route', async () => {
      const seen: { mode: string }[] = []
      make({ onAudio: (a) => seen.push(a) })
      child.reply = openReply({ audio: 'pipe', audioPipe: 'p' })
      await engine.open('d1', 'f.pptx', canvas)
      child.exit(1)
      expect(seen.at(-1)?.mode).toBe('none')
    })

    it('edit sends the file', async () => {
      await engine.edit('C:\\lib\\edit.pptx')
      expect(child.written.at(-1)).toMatchObject({ cmd: 'edit', file: 'C:\\lib\\edit.pptx' })
    })
  })
})

describe('bridgeExePath', () => {
  it('uses resources/ppt-bridge when packaged and the build output in dev', () => {
    const packaged = bridgeExePath({ packaged: true, resourcesPath: '/r', appPath: '/a' })
    const dev = bridgeExePath({ packaged: false, resourcesPath: '/r', appPath: '/a' })
    expect(packaged.replace(/\\/g, '/')).toBe('/r/ppt-bridge/ppt-bridge.exe')
    expect(dev.replace(/\\/g, '/')).toBe('/a/native/ppt-bridge/bin/Release/net48/ppt-bridge.exe')
  })
})
