import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  WEB_HELPER_START_FAILED,
  WebBridgeEngine,
  webBridgeExePath,
  type WebBridgeChild as BridgeChild
} from './web-engine'

type Msg = Record<string, unknown>

/** A scripted stand-in for web-bridge.exe. */
class FakeChild implements BridgeChild {
  written: Msg[] = []
  stdinEnded = false
  killed = false
  exitCbs: ((c: number | null) => void)[] = []
  errCbs: ((e: Error) => void)[] = []
  dataCbs: ((c: Buffer | string) => void)[] = []
  reply: (m: Msg) => Msg | undefined = (m) => ({ id: m.id, ok: true })
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
let engine: WebBridgeEngine
let startFailures: string[]

const openReply =
  (extra: Msg = {}) =>
  (m: Msg): Msg | undefined =>
    m.cmd === 'open'
      ? { id: m.id, ok: true, windowId: '1049870', browserPid: 77, ...extra }
      : { id: m.id, ok: true }

function make(opts: Partial<ConstructorParameters<typeof WebBridgeEngine>[0]> = {}): void {
  engine = new WebBridgeEngine({
    exe: 'C:\\app\\web-bridge.exe',
    userData: 'C:\\data\\web-profile',
    spawn: (exe) => {
      spawned.push(exe)
      return child
    },
    exists: () => true,
    onStartFailure: (m) => startFailures.push(m),
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
  make()
})
afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('WebBridgeEngine', () => {
  it('does not start the helper before the first open, then frames the open request', async () => {
    expect(spawned).toEqual([])
    const r = await engine.open('d1', {
      url: 'https://canva.com/x',
      canvas,
      zoom: 1.5,
      profile: 'default'
    })
    expect(spawned).toEqual(['C:\\app\\web-bridge.exe'])
    expect(child.written).toHaveLength(1)
    expect(child.written[0]).toMatchObject({
      cmd: 'open',
      deckId: 'd1',
      url: 'https://canva.com/x',
      width: 1920,
      height: 1080,
      x: 0,
      y: 0,
      profile: 'default',
      zoom: 1.5
    })
    expect(typeof child.written[0].id).toBe('number')
    expect(r.windowId).toBe('1049870')
    expect(r.audioPipe).toBeNull()
  })

  it('keeps the audio pipe the helper reports', async () => {
    child.reply = openReply({ audioPipe: '\\\\.\\pipe\\web-audio-1-2' })
    const r = await engine.open('d1', { url: 'https://a.b', canvas, zoom: 1, profile: 'default' })
    expect(r.audioPipe).toBe('\\\\.\\pipe\\web-audio-1-2')
  })

  it('asks the helper for a page snapshot and returns its base64 PNG', async () => {
    await engine.open('d1', { url: 'https://a.b', canvas, zoom: 1, profile: 'default' })
    child.reply = (m) =>
      m.cmd === 'snapshot' ? { id: m.id, ok: true, png: 'aGk=' } : { id: m.id, ok: true }
    await expect(engine.snapshot('d1')).resolves.toBe('aGk=')
    child.reply = (m) => ({ id: m.id, ok: true })
    await expect(engine.snapshot('d1')).resolves.toBeNull()
    expect(child.written.find((m) => m.cmd === 'snapshot')).toMatchObject({ deckId: 'd1' })
  })

  it('maps every command with the deck id', async () => {
    await engine.open('d1', { url: 'https://a.b', canvas, zoom: 1, profile: 'default' })
    await engine.navigate('d1', 'https://c.d')
    await engine.reload('d1')
    await engine.back('d1')
    await engine.forward('d1')
    await engine.setZoom('d1', 2)
    await engine.resize('d1', { width: 2520, height: 1080 })
    engine.input('d1', { kind: 'key', type: 'keyDown', keyCode: 'ArrowRight', modifiers: [] })
    await engine.setMuted('d1', true)
    await engine.snapshot('d1')
    await engine.signOut('default')
    await engine.setLive('d1', true)
    engine.stop('d1')
    await engine.close('d1')
    expect(child.written.slice(1).map((m) => m.cmd)).toEqual([
      'navigate',
      'reload',
      'back',
      'forward',
      'setZoom',
      'resize',
      'input',
      'setMuted',
      'snapshot',
      'signOut',
      'setLive',
      'stop',
      'close'
    ])
    expect(child.written.find((m) => m.cmd === 'setZoom')).toMatchObject({ deckId: 'd1', zoom: 2 })
    expect(child.written.find((m) => m.cmd === 'resize')).toMatchObject({
      deckId: 'd1',
      width: 2520,
      height: 1080
    })
    expect(child.written.find((m) => m.cmd === 'setMuted')).toMatchObject({
      deckId: 'd1',
      muted: true
    })
    expect(child.written.find((m) => m.cmd === 'signOut')).toMatchObject({ profile: 'default' })
    expect(child.written.find((m) => m.cmd === 'input')).toMatchObject({
      deckId: 'd1',
      ev: { kind: 'key', type: 'keyDown', keyCode: 'ArrowRight' }
    })
  })

  it('sends input without waiting for a reply', async () => {
    await engine.open('d1', { url: 'https://a.b', canvas, zoom: 1, profile: 'default' })
    child.reply = () => undefined
    expect(() =>
      engine.input('d1', { kind: 'key', type: 'keyDown', keyCode: 'a', modifiers: [] })
    ).not.toThrow()
    expect(child.written.at(-1)).toMatchObject({ cmd: 'input' })
  })

  it('maps nav and status events, adding the deck zoom', async () => {
    const navs: unknown[] = []
    const states: unknown[] = []
    engine.on('nav', (s) => navs.push(s))
    engine.on('status', (s) => states.push(s))
    await engine.open('d1', { url: 'https://a.b', canvas, zoom: 1.25, profile: 'default' })
    child.send({
      event: 'nav',
      deckId: 'd1',
      url: 'https://a.b/1',
      title: 'T',
      canGoBack: true,
      canGoForward: false,
      loading: false,
      cursor: 'pointer'
    })
    child.send({ event: 'status', deckId: 'd1', status: 'ready' })
    child.send({ event: 'status', deckId: 'd1', status: 'error', message: 'boom' })
    expect(navs).toEqual([
      {
        deckId: 'd1',
        url: 'https://a.b/1',
        title: 'T',
        canGoBack: true,
        canGoForward: false,
        loading: false,
        zoom: 1.25,
        cursor: 'pointer'
      }
    ])
    expect(states).toEqual([
      { deckId: 'd1', status: 'ready' },
      { deckId: 'd1', status: 'error', message: 'boom' }
    ])
  })

  it('ignores malformed nav and status events', async () => {
    const navs: unknown[] = []
    const states: unknown[] = []
    engine.on('nav', (s) => navs.push(s))
    engine.on('status', (s) => states.push(s))
    await engine.open('d1', { url: 'https://a.b', canvas, zoom: 1, profile: 'default' })
    child.send({ event: 'nav', deckId: 'd1' })
    child.send({ event: 'status', deckId: 'd1', status: 'weird' })
    expect(navs).toEqual([])
    expect(states).toEqual([])
  })

  it('reports a crashed page with its deck id, once per event', async () => {
    const crashed: string[] = []
    engine.on('crashed', (deckId) => crashed.push(deckId))
    await engine.open('d1', { url: 'https://a.b', canvas, zoom: 1, profile: 'default' })
    child.send({ event: 'crashed', deckId: 'd1' })
    child.send({ event: 'crashed' })
    expect(crashed).toEqual(['d1'])
  })

  it('reports a hung page (the renderer stopped answering)', async () => {
    const hung: string[] = []
    engine.on('hung', (deckId) => hung.push(deckId))
    await engine.open('d1', { url: 'https://a.b', canvas, zoom: 1, profile: 'default' })
    child.send({ event: 'hung', deckId: 'd1' })
    child.send({ event: 'hung' })
    expect(hung).toEqual(['d1'])
  })

  it('rejects a call with the bridge code and message', async () => {
    await engine.open('d1', { url: 'https://a.b', canvas, zoom: 1, profile: 'default' })
    child.reply = (m) => ({ id: m.id, ok: false, code: 'nosession', message: 'not open' })
    await expect(engine.reload('d1')).rejects.toMatchObject({
      code: 'nosession',
      message: 'not open'
    })
  })

  it('rejects an open without a window id', async () => {
    child.reply = (m) => ({ id: m.id, ok: true })
    await expect(
      engine.open('d1', { url: 'https://a.b', canvas, zoom: 1, profile: 'default' })
    ).rejects.toMatchObject({ code: 'protocol' })
  })

  it('an unexpected exit fails calls in flight, emits exited once and clears the pipe', async () => {
    let exited = 0
    engine.on('exited', () => exited++)
    child.reply = openReply({ audioPipe: 'p' })
    await engine.open('d1', { url: 'https://a.b', canvas, zoom: 1, profile: 'default' })
    child.reply = () => undefined
    const p = engine.reload('d1')
    child.exit(1)
    await expect(p).rejects.toMatchObject({ code: 'exited' })
    expect(exited).toBe(1)
    expect(engine.running).toBe(false)
    child.exit(1)
    expect(exited).toBe(1)
  })

  it('starts a new helper for the next open after the old one exited', async () => {
    await engine.open('a', { url: 'https://a.b', canvas, zoom: 1, profile: 'default' })
    child.exit(1)
    const second = new FakeChild()
    second.reply = openReply({ windowId: '77' })
    child = second
    const r = await engine.open('a', { url: 'https://a.b', canvas, zoom: 1, profile: 'default' })
    expect(spawned).toHaveLength(2)
    expect(r.windowId).toBe('77')
  })

  describe('ping', () => {
    it('sends a ping and resolves on the reply', async () => {
      await engine.open('d1', { url: 'https://a.b', canvas, zoom: 1, profile: 'default' })
      await engine.ping()
      expect(child.written.at(-1)).toMatchObject({ cmd: 'ping' })
    })

    it('rejects when the helper does not answer within 3 s (hung)', async () => {
      await engine.open('d1', { url: 'https://a.b', canvas, zoom: 1, profile: 'default' })
      child.reply = () => undefined
      const p = engine.ping()
      const assertion = expect(p).rejects.toMatchObject({ code: 'timeout' })
      await vi.advanceTimersByTimeAsync(3000)
      await assertion
    })

    it('resolves at once when no helper runs', async () => {
      await expect(engine.ping()).resolves.toBeUndefined()
      expect(spawned).toEqual([])
    })
  })

  describe('start failure', () => {
    it('a missing exe never spawns and reports the copy', async () => {
      make({ exists: () => false })
      await expect(
        engine.open('d1', { url: 'https://a.b', canvas, zoom: 1, profile: 'default' })
      ).rejects.toMatchObject({ code: 'start', message: WEB_HELPER_START_FAILED })
      expect(spawned).toEqual([])
      expect(startFailures).toEqual([WEB_HELPER_START_FAILED])
      expect(engine.helperError).toBe(WEB_HELPER_START_FAILED)
    })

    it('spawn throwing rejects open with the helper copy', async () => {
      make({
        spawn: () => {
          throw new Error('EACCES')
        }
      })
      await expect(
        engine.open('d1', { url: 'https://a.b', canvas, zoom: 1, profile: 'default' })
      ).rejects.toMatchObject({ code: 'start' })
      expect(startFailures).toEqual([WEB_HELPER_START_FAILED])
    })
  })

  describe('shutdown', () => {
    it('closes stdin, waits for the exit and emits no exited', async () => {
      let exited = 0
      engine.on('exited', () => exited++)
      await engine.open('d1', { url: 'https://a.b', canvas, zoom: 1, profile: 'default' })
      await engine.shutdown()
      expect(child.stdinEnded).toBe(true)
      expect(child.killed).toBe(false)
      expect(exited).toBe(0)
      expect(engine.running).toBe(false)
    })

    it('kills only the helper process when it does not exit in time', async () => {
      await engine.open('d1', { url: 'https://a.b', canvas, zoom: 1, profile: 'default' })
      child.exitOnEnd = false
      const p = engine.shutdown()
      await vi.advanceTimersByTimeAsync(1000)
      await p
      expect(child.killed).toBe(true)
    })

    it('is harmless without a helper and a later open starts a new one', async () => {
      await engine.shutdown()
      await engine.open('d1', { url: 'https://a.b', canvas, zoom: 1, profile: 'default' })
      await engine.shutdown()
      child = new FakeChild()
      child.reply = openReply()
      await engine.open('d1', { url: 'https://a.b', canvas, zoom: 1, profile: 'default' })
      expect(spawned).toHaveLength(2)
    })
  })
})

describe('webBridgeExePath', () => {
  it('uses resources/web-bridge when packaged and the build output in dev', () => {
    const packaged = webBridgeExePath({ packaged: true, resourcesPath: '/r', appPath: '/a' })
    const dev = webBridgeExePath({ packaged: false, resourcesPath: '/r', appPath: '/a' })
    expect(packaged.replace(/\\/g, '/')).toBe('/r/web-bridge/web-bridge.exe')
    expect(dev.replace(/\\/g, '/')).toBe(
      '/a/native/web-bridge/bin/Release/net48/web-bridge.exe'
    )
  })
})
