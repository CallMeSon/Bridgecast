import { describe, expect, it, vi } from 'vitest'
import {
  LO_DEFAULT_DEVICE_SOUND,
  LO_START_FAILED,
  LibreOfficeEngine,
  loBridgePath
} from './libreoffice-engine'
import type { BridgeChild } from './powerpoint-engine'

type Msg = Record<string, unknown>

class FakeChild implements BridgeChild {
  written: Msg[] = []
  killed = false
  exitCbs: ((c: number | null) => void)[] = []
  dataCbs: ((c: string) => void)[] = []
  reply: (m: Msg) => Msg | undefined = (m) => ({ id: m.id, ok: true, windowId: '123' })
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
    end: (): void => this.exit(0)
  }
  stdout = { on: (_e: 'data', cb: (c: string) => void): void => void this.dataCbs.push(cb) }
  stderr = { on: (): void => {} }
  on(ev: 'exit', cb: (code: number | null) => void): void
  on(ev: 'error', cb: (err: Error) => void): void
  on(ev: 'exit' | 'error', cb: never): void {
    if (ev === 'exit') this.exitCbs.push(cb)
  }
  kill(): void {
    this.killed = true
    this.exit(null)
  }
  send(m: Msg): void {
    for (const cb of this.dataCbs) cb(JSON.stringify(m) + '\n')
  }
  exit(code: number | null): void {
    for (const cb of this.exitCbs) cb(code)
  }
}

function make(opts: { sink?: boolean; reply?: FakeChild['reply'] } = {}): {
  engine: LibreOfficeEngine
  child: FakeChild
  args: () => string[]
  audio: unknown[]
} {
  const child = new FakeChild()
  if (opts.reply) child.reply = opts.reply
  let args: string[] = []
  const audio: unknown[] = []
  const engine = new LibreOfficeEngine({
    script: '/x/bridge.py',
    profile: '/data/lo-profile',
    exists: () => true,
    spawn: (_py, a) => {
      args = a
      return child
    },
    ensureSink: async () => opts.sink ?? true,
    onAudio: (a) => audio.push(a)
  })
  return { engine, child, args: () => args, audio }
}

const canvas = { width: 1920, height: 1080 }

describe('loBridgePath', () => {
  it('uses resources/lo-bridge packaged and native/lo-bridge in dev', () => {
    const o = { resourcesPath: '/res', appPath: '/app' }
    expect(loBridgePath({ ...o, packaged: true })).toBe('/res/lo-bridge/bridge.py')
    expect(loBridgePath({ ...o, packaged: false })).toBe('/app/native/lo-bridge/bridge.py')
  })
})

describe('LibreOfficeEngine', () => {
  it('starts the bridge with the profile and the private sink and opens a session', async () => {
    const { engine, child, args, audio } = make()
    const s = await engine.open('d1', '/deck/source.odp', canvas)
    expect(args()).toEqual([
      '/x/bridge.py',
      '--profile',
      '/data/lo-profile',
      '--pulse-sink',
      'pptshare_lo'
    ])
    expect(s.windowId).toBe('123')
    expect(child.written[0]).toMatchObject({
      cmd: 'open',
      deckId: 'd1',
      file: '/deck/source.odp',
      width: 1920
    })
    expect(audio.at(-1)).toEqual({ mode: 'monitor', note: null })
    await s.next()
    await s.goto(3)
    expect(child.written.slice(1).map((m) => m.cmd)).toEqual(['next', 'goto'])
  })

  it('without a sound sink: no PULSE_SINK argument and the default-device copy', async () => {
    const { engine, args, audio } = make({ sink: false })
    await engine.open('d1', '/f.odp', canvas)
    expect(args()).not.toContain('--pulse-sink')
    expect(audio.at(-1)).toEqual({ mode: 'device', note: LO_DEFAULT_DEVICE_SOUND })
  })

  it('turns position events into engine positions', async () => {
    const { engine, child } = make()
    const seen: unknown[] = []
    engine.on('position', (p) => seen.push(p))
    await engine.open('d1', '/f.odp', canvas)
    child.send({ event: 'position', deckId: 'd1', index: 2, step: 1, clicks: 3 })
    child.send({ event: 'position', deckId: 'd1', index: 'x', step: 1, clicks: 3 })
    expect(seen).toEqual([{ deckId: 'd1', index: 2, step: 1, clicks: 3 }])
  })

  it('a start failure of LibreOffice is remembered as the operator copy', async () => {
    const { engine } = make({
      reply: (m) => ({ id: m.id, ok: false, code: 'start', message: LO_START_FAILED })
    })
    await expect(engine.open('d1', '/f.odp', canvas)).rejects.toThrow(/could not start/)
    expect(engine.helperError).toBe(LO_START_FAILED)
  })

  it('a missing bridge script fails with the start copy', async () => {
    const engine = new LibreOfficeEngine({
      script: '/nope',
      profile: '/p',
      exists: () => false,
      onStartFailure: vi.fn()
    })
    await expect(engine.open('d', '/f', canvas)).rejects.toThrow(/could not start/)
    expect(engine.helperError).toBe(LO_START_FAILED)
  })

  it('importDeck sends the import command and returns the reply', async () => {
    const { engine, child } = make({
      reply: (m) => ({ id: m.id, ok: true, name: 'n', pngs: [] })
    })
    const r = await engine.importDeck({ path: '/a.pptx', outDir: '/o', width: 1920, format: 'odp' })
    expect(r.name).toBe('n')
    expect(child.written[0]).toMatchObject({ cmd: 'import', path: '/a.pptx', format: 'odp' })
  })

  it('ping resolves at once when nothing runs and goes to the bridge otherwise', async () => {
    const { engine, child } = make()
    await engine.ping()
    expect(child.written).toEqual([])
    await engine.open('d1', '/f.odp', canvas)
    await engine.ping()
    expect(child.written.at(-1)?.cmd).toBe('ping')
  })

  it('an unexpected exit reports exited; shutdown does not', async () => {
    const a = make()
    const exited = vi.fn()
    a.engine.on('exited', exited)
    await a.engine.open('d1', '/f.odp', canvas)
    a.child.exit(1)
    expect(exited).toHaveBeenCalledTimes(1)

    const b = make()
    const exitedB = vi.fn()
    b.engine.on('exited', exitedB)
    await b.engine.open('d1', '/f.odp', canvas)
    await b.engine.shutdown()
    expect(exitedB).not.toHaveBeenCalled()
    expect(b.engine.running).toBe(false)
  })

  it('shutdown kills only the bridge process when it does not end by itself', async () => {
    vi.useFakeTimers()
    try {
      const { engine, child } = make()
      await engine.open('d1', '/f.odp', canvas)
      child.stdin.end = (): void => {}
      const p = engine.shutdown()
      await vi.advanceTimersByTimeAsync(10_001)
      await p
      expect(child.killed).toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })
})
