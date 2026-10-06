import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FrameRepeater } from './frame-repeater'

describe('FrameRepeater', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('re-sends the last frame at fps even without new pushes', () => {
    const send = vi.fn()
    const r = new FrameRepeater(send, 30)
    const a = Buffer.from([1, 2, 3, 4])
    r.push(a)
    vi.advanceTimersByTime(1000)
    expect(send.mock.calls.length).toBeGreaterThanOrEqual(29)
    for (const [frame] of send.mock.calls) expect(frame).toBe(a)
    r.stop()
  })

  it('sends nothing before the first push', () => {
    const send = vi.fn()
    const r = new FrameRepeater(send, 30)
    vi.advanceTimersByTime(1000)
    expect(send).not.toHaveBeenCalled()
    r.stop()
  })

  it('a second push replaces the frame that is sent', () => {
    const send = vi.fn()
    const r = new FrameRepeater(send, 30)
    const a = Buffer.from([1])
    const b = Buffer.from([2])
    r.push(a)
    vi.advanceTimersByTime(500)
    r.push(b)
    send.mockClear()
    vi.advanceTimersByTime(500)
    expect(send.mock.calls.length).toBeGreaterThanOrEqual(14)
    for (const [frame] of send.mock.calls) expect(frame).toBe(b)
    r.stop()
  })

  it('stops sending after stop()', () => {
    const send = vi.fn()
    const r = new FrameRepeater(send, 30)
    r.push(Buffer.from([1]))
    vi.advanceTimersByTime(100)
    r.stop()
    const n = send.mock.calls.length
    vi.advanceTimersByTime(1000)
    r.push(Buffer.from([2]))
    vi.advanceTimersByTime(1000)
    expect(send.mock.calls.length).toBe(n)
  })

  it('uses the injected scheduler', () => {
    const handle = { id: 1 } as unknown as ReturnType<typeof setInterval>
    const schedule = vi.fn(() => handle) as unknown as typeof setInterval
    const r = new FrameRepeater(vi.fn(), 25, schedule)
    expect(schedule).toHaveBeenCalledTimes(1)
    r.stop()
  })

  // Windows timers fire on a 15.625 ms grid: setInterval(33.3) really runs every
  // 46.9 ms (21 fps). Measured in the e2e smoke test: 43 frames in 2 s.
  const coarse = ((fn: () => void, ms: number) =>
    setInterval(fn, Math.ceil(ms / 15.625) * 15.625)) as unknown as typeof setInterval

  it('keeps the average rate at fps with a coarse (Windows) timer', () => {
    const send = vi.fn()
    const r = new FrameRepeater(send, 30, coarse)
    r.push(Buffer.from([1]))
    vi.advanceTimersByTime(10_000)
    expect(send.mock.calls.length).toBeGreaterThanOrEqual(297)
    expect(send.mock.calls.length).toBeLessThanOrEqual(301)
    r.stop()
  })

  it('does not burst to catch up after the event loop was blocked', () => {
    let offset = 0
    const send = vi.fn()
    const r = new FrameRepeater(send, 30, setInterval, () => performance.now() + offset)
    r.push(Buffer.from([1]))
    vi.advanceTimersByTime(1000)
    const n = send.mock.calls.length
    offset += 2000 // 2 s passed without any timer running
    vi.advanceTimersByTime(100)
    expect(send.mock.calls.length - n).toBeLessThanOrEqual(4)
    r.stop()
  })

  // Windows time sync or a manual clock fix can step the wall clock backwards.
  it('keeps sending at fps after the wall clock steps back (default clock)', () => {
    const send = vi.fn()
    const r = new FrameRepeater(send, 30)
    r.push(Buffer.from([1]))
    vi.advanceTimersByTime(1000)
    vi.setSystemTime(Date.now() - 10_000) // Date.now() goes back 10 s
    send.mockClear()
    vi.advanceTimersByTime(1000)
    expect(send.mock.calls.length).toBeGreaterThanOrEqual(29)
    r.stop()
  })

  it('recovers when an injected clock jumps backwards', () => {
    let offset = 0
    const now = (): number => performance.now() + offset
    const send = vi.fn()
    const r = new FrameRepeater(send, 30, setInterval, now)
    r.push(Buffer.from([1]))
    vi.advanceTimersByTime(1000)
    offset -= 10_000
    send.mockClear()
    vi.advanceTimersByTime(1000)
    expect(send.mock.calls.length).toBeGreaterThanOrEqual(28)
    expect(send.mock.calls.length).toBeLessThanOrEqual(31)
    r.stop()
  })

  it('uses the injected clock', () => {
    let t = 0
    const send = vi.fn()
    const r = new FrameRepeater(send, 30, setInterval, () => t)
    r.push(Buffer.from([1]))
    vi.advanceTimersByTime(1000) // timers run, but the injected clock stands still
    expect(send).not.toHaveBeenCalled()
    t = 34
    vi.advanceTimersByTime(10)
    expect(send).toHaveBeenCalledTimes(1)
    r.stop()
  })

  it('also works at 60 fps', () => {
    const send = vi.fn()
    const r = new FrameRepeater(send, 60, coarse)
    r.push(Buffer.from([1]))
    vi.advanceTimersByTime(1000)
    expect(send.mock.calls.length).toBeGreaterThanOrEqual(58)
    expect(send.mock.calls.length).toBeLessThanOrEqual(61)
    r.stop()
  })

  it('keeps sending if send throws once', () => {
    let calls = 0
    const send = vi.fn(() => {
      calls++
      if (calls === 1) throw new Error('boom')
    })
    const r = new FrameRepeater(send, 30)
    r.push(Buffer.from([1]))
    vi.advanceTimersByTime(1000)
    expect(calls).toBeGreaterThanOrEqual(29)
    r.stop()
  })
})
