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

  it('uses the injected scheduler with a 1000/fps interval', () => {
    const handle = { id: 1 } as unknown as ReturnType<typeof setInterval>
    const schedule = vi.fn(() => handle) as unknown as typeof setInterval
    const r = new FrameRepeater(vi.fn(), 25, schedule)
    expect(schedule).toHaveBeenCalledWith(expect.any(Function), 40)
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
