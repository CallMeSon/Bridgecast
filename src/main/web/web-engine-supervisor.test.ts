import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FakeWebEngine } from './fake-web-engine'
import { WEB_ENGINE_FALLBACK, WebEngineSupervisor } from './web-engine-supervisor'

const canvas = { width: 1920, height: 1080 }
const open = { url: 'https://canva.com/x', canvas, zoom: 1, profile: 'default' }

let engines: FakeWebEngine[]
let holds: string[]
let fallbacks: string[]
let reopened: Map<string, { windowId: string; audioPipe: string | null }>[]
let sup: WebEngineSupervisor

beforeEach(() => {
  vi.useFakeTimers()
  engines = []
  holds = []
  fallbacks = []
  reopened = []
  sup = new WebEngineSupervisor({
    create: () => {
      const e = new FakeWebEngine()
      const n = engines.length + 1
      e.open = async (deckId, o) => {
        e.opened.set(deckId, o)
        e.sizes.set(deckId, o.canvas)
        return { windowId: `w${n}-${deckId}`, audioPipe: null }
      }
      engines.push(e)
      return e
    },
    onHold: (deckId) => holds.push(deckId),
    onFallback: (m) => fallbacks.push(m)
  })
  sup.onPagesReopened = (pages) => reopened.push(pages)
})
afterEach(() => {
  vi.useRealTimers()
})

describe('WebEngineSupervisor', () => {
  it('starts the helper on the first open, then pings it', async () => {
    await sup.open('d1', open)
    expect(engines).toHaveLength(1)
    expect(engines[0].opened.get('d1')?.url).toBe(open.url)
    expect(sup.ready()).toBe(true)
    await vi.advanceTimersByTimeAsync(1000)
    expect(engines[0].alive).toBe(true)
  })

  it('a hung helper: HOLD the pages, restart, and reopen them at their last URL', async () => {
    await sup.open('d1', open)
    await sup.navigate('d1', 'https://canva.com/next')
    engines[0].pingFails = true
    await vi.advanceTimersByTimeAsync(1000)
    expect(holds).toEqual(['d1'])
    expect(engines).toHaveLength(2)
    expect(engines[1].opened.get('d1')?.url).toBe('https://canva.com/next')
    expect(reopened.at(-1)?.get('d1')?.windowId).toBe('w2-d1')
    expect(sup.ready()).toBe(true)
  })

  it('a helper that exits on its own is restarted the same way', async () => {
    await sup.open('d1', open)
    engines[0].emitExit()
    await vi.advanceTimersByTimeAsync(0)
    expect(engines).toHaveLength(2)
    expect(engines[1].opened.get('d1')?.url).toBe(open.url)
    expect(holds).toEqual([]) // exited, not hung: the exited event makes main hold
  })

  it('three restarts, then it gives up and tells main to fall back (once)', async () => {
    await sup.open('d1', open)
    for (let i = 0; i < 4; i++) {
      engines.at(-1)!.pingFails = true
      await vi.advanceTimersByTimeAsync(1000)
    }
    expect(engines.length).toBeLessThanOrEqual(4)
    expect(fallbacks).toEqual([WEB_ENGINE_FALLBACK])
    expect(sup.ready()).toBe(false)
    // No further restarts after giving up.
    await vi.advanceTimersByTimeAsync(5000)
    expect(fallbacks).toHaveLength(1)
  })

  it('shutdown stops the heartbeat and the helper', async () => {
    await sup.open('d1', open)
    await sup.shutdown()
    expect(engines[0].alive).toBe(false)
    const n = engines.length
    await vi.advanceTimersByTimeAsync(5000)
    expect(engines).toHaveLength(n)
    expect(sup.ready()).toBe(false)
  })
})
