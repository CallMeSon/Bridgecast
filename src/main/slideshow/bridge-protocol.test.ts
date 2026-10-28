import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { BridgeClient, type BridgeEvent } from './bridge-protocol'

let lines: string[]
let c: BridgeClient
beforeEach(() => {
  vi.useFakeTimers()
  lines = []
  c = new BridgeClient((l) => lines.push(l))
})
afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('BridgeClient', () => {
  it('writes a JSON line and resolves with the matching reply', async () => {
    const p = c.request('open', { file: 'a.pptx' }, 1000)
    const sent = JSON.parse(lines[0])
    expect(lines[0].endsWith('\n')).toBe(true)
    expect(sent).toMatchObject({ cmd: 'open', file: 'a.pptx' })
    c.feed(JSON.stringify({ id: sent.id, ok: true, windowId: 'w1' }) + '\n')
    await expect(p).resolves.toMatchObject({ windowId: 'w1' })
  })

  it('rejects with the code and message of a failed reply', async () => {
    const p = c.request('next', {}, 1000)
    const { id } = JSON.parse(lines[0])
    c.feed(JSON.stringify({ id, ok: false, code: 'nope', message: 'bad' }) + '\n')
    await expect(p).rejects.toMatchObject({ code: 'nope', message: 'bad' })
  })

  it('rejects when no reply arrives within the timeout', async () => {
    const p = c.request('ping', {}, 3000)
    const assertion = expect(p).rejects.toMatchObject({ code: 'timeout' })
    await vi.advanceTimersByTimeAsync(3000)
    await assertion
  })

  it('handles replies split over chunks and several lines in one chunk', async () => {
    const a = c.request('ping', {}, 1000)
    const b = c.request('ping', {}, 1000)
    const [ia, ib] = lines.map((l) => JSON.parse(l).id)
    const text =
      JSON.stringify({ id: ia, ok: true }) + '\n' + JSON.stringify({ id: ib, ok: true }) + '\n'
    c.feed(text.slice(0, 7))
    c.feed(text.slice(7))
    await expect(Promise.all([a, b])).resolves.toHaveLength(2)
  })

  it('dispatches events', () => {
    const got: BridgeEvent[] = []
    c.onEvent((e) => got.push(e))
    c.feed('{"event":"position","deckId":"d","index":2,"step":1,"clicks":3}\n{"event":"exited"}\n')
    expect(got.map((e) => e.event)).toEqual(['position', 'exited'])
    expect(got[0]).toMatchObject({ index: 2, step: 1 })
  })

  it('ignores malformed lines, unknown ids and unknown events', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const got: BridgeEvent[] = []
    c.onEvent((e) => got.push(e))
    c.feed('not json\n')
    c.feed('{"id":99,"ok":true}\n')
    c.feed('{"event":"weird"}\n')
    c.feed('42\n\n')
    expect(got).toEqual([])
    expect(warn).toHaveBeenCalled()
  })

  it('failAll rejects what is in flight', async () => {
    const p = c.request('ping', {}, 1000)
    c.failAll('exited', 'bridge exited')
    await expect(p).rejects.toMatchObject({ code: 'exited' })
  })
})
