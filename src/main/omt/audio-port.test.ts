import { describe, expect, it } from 'vitest'
import { AudioPortFeed, type PortLike } from './audio-port'

class FakePort implements PortLike {
  closed = false
  started = false
  private fn: ((e: { data: unknown }) => void) | null = null
  on(_ev: 'message', fn: (e: { data: unknown }) => void): void {
    this.fn = fn
  }
  start(): void {
    this.started = true
  }
  close(): void {
    this.closed = true
  }
  send(data: unknown): void {
    this.fn?.({ data })
  }
}

function make(): {
  feed: AudioPortFeed
  pairs: { port1: FakePort; port2: FakePort }[]
  posted: FakePort[]
  audio: { samples: number }[]
} {
  const pairs: { port1: FakePort; port2: FakePort }[] = []
  const posted: FakePort[] = []
  const audio: { samples: number }[] = []
  const feed = new AudioPortFeed(
    () => {
      const p = { port1: new FakePort(), port2: new FakePort() }
      pairs.push(p)
      return p
    },
    (p) => posted.push(p as FakePort),
    (_d, samples) => audio.push({ samples })
  )
  return { feed, pairs, posted, audio }
}

describe('AudioPortFeed', () => {
  it('a request makes a fresh channel, posts port1 and feeds from port2', () => {
    const t = make()
    t.feed.request()
    expect(t.posted).toEqual([t.pairs[0].port1])
    expect(t.pairs[0].port2.started).toBe(true)
    t.pairs[0].port2.send({ data: new Float32Array(8), samples: 4 })
    expect(t.audio).toEqual([{ samples: 4 }])
  })

  it('a later request closes the previous port2 and replaces it', () => {
    const t = make()
    t.feed.request()
    t.feed.request()
    expect(t.pairs).toHaveLength(2)
    expect(t.pairs[0].port2.closed).toBe(true)
    expect(t.posted).toEqual([t.pairs[0].port1, t.pairs[1].port1])
    t.pairs[0].port2.send({ data: new Float32Array(8), samples: 4 })
    expect(t.audio).toHaveLength(0)
    t.pairs[1].port2.send({ data: new Float32Array(8), samples: 4 })
    expect(t.audio).toHaveLength(1)
  })

  it('drops anything that is not { data: Float32Array, samples } with length 2*samples', () => {
    const t = make()
    t.feed.request()
    const p = t.pairs[0].port2
    p.send(null)
    p.send({ data: [1, 2], samples: 1 })
    p.send({ data: new Float32Array(3), samples: 2 })
    p.send({ data: new Float32Array(4), samples: 0.5 })
    expect(t.audio).toHaveLength(0)
  })

  it('close() ends the feed and ignores requests afterwards', () => {
    const t = make()
    t.feed.request()
    t.feed.close()
    expect(t.pairs[0].port2.closed).toBe(true)
    t.feed.request()
    expect(t.pairs).toHaveLength(1)
  })
})
