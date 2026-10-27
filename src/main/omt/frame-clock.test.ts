import { describe, expect, it, vi } from 'vitest'
import { FrameClock, type Frame } from './frame-clock'

const frame = (n: number): Frame => ({ width: 1, height: 1, data: new ArrayBuffer(n) })

function setup(fps = 30): {
  clock: FrameClock
  sent: Frame[]
  timers: { setInterval: ReturnType<typeof vi.fn>; clearInterval: ReturnType<typeof vi.fn> }
  tick: () => void
} {
  let tick: () => void = () => {}
  const timers = {
    setInterval: vi.fn((fn: () => void) => {
      tick = fn
      return 1 as unknown as ReturnType<typeof setInterval>
    }),
    clearInterval: vi.fn(() => {
      tick = () => {}
    })
  }
  const sent: Frame[] = []
  const clock = new FrameClock(fps, (f) => sent.push(f), timers)
  return { clock, sent, timers, tick: () => tick() }
}

describe('FrameClock', () => {
  it('ticks at the frame interval', () => {
    const { clock, timers } = setup(60)
    clock.start()
    expect(timers.setInterval).toHaveBeenCalledWith(expect.any(Function), 1000 / 60)
  })

  it('two pushes before a tick send one frame and count one drop', () => {
    const { clock, sent, tick } = setup()
    clock.start()
    const a = frame(1)
    const b = frame(2)
    clock.push(a)
    clock.push(b)
    tick()
    expect(sent).toEqual([b])
    expect(clock.stats()).toEqual({ sent: 1, dropped: 1 })
  })

  it('a static slide: the last frame is repeated on every tick', () => {
    const { clock, sent, tick } = setup()
    clock.start()
    const a = frame(1)
    clock.push(a)
    for (let i = 0; i < 5; i++) tick()
    expect(sent).toHaveLength(5)
    expect(sent.every((f) => f === a)).toBe(true)
    expect(clock.stats()).toEqual({ sent: 5, dropped: 0 })
  })

  it('sends nothing before the first frame', () => {
    const { clock, sent, tick } = setup()
    clock.start()
    tick()
    expect(sent).toEqual([])
  })

  it('stop() stops sending and clears the timer', () => {
    const { clock, sent, timers, tick } = setup()
    clock.start()
    clock.push(frame(1))
    tick()
    clock.stop()
    tick()
    expect(sent).toHaveLength(1)
    expect(timers.clearInterval).toHaveBeenCalledTimes(1)
  })

  it('start() twice does not create two timers', () => {
    const { clock, timers } = setup()
    clock.start()
    clock.start()
    expect(timers.setInterval).toHaveBeenCalledTimes(1)
  })
})
