import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FrameRepeater } from '../frame-repeater'
import { FakeNdiSender } from './fake-sender'
import { NdiPipeline, type OutputHandle } from './pipeline'
import { DEFAULT_SETTINGS } from '../settings'
import type { OutputOptions } from '../output-window'
import type { NdiSettings } from '../../shared/settings'

/**
 * Stand-in for the offscreen output window (createOutputWindow + Output):
 * `paint()` pushes a width*height*4 BGRA frame into a real FrameRepeater,
 * exactly like the window's paint handler does.
 */
class FakeOutput implements OutputHandle {
  readonly repeater: FrameRepeater
  started = false
  closed = false
  constructor(
    readonly opts: OutputOptions,
    send: (frame: Buffer) => void
  ) {
    this.repeater = new FrameRepeater(send, opts.fps)
  }
  start(): void {
    this.started = true
  }
  paint(): void {
    this.repeater.push(Buffer.alloc(this.opts.width * this.opts.height * 4))
  }
  shutdown(): void {
    this.closed = true
    this.repeater.stop()
  }
}

let sender: FakeNdiSender
let outputs: FakeOutput[]
let pipeline: NdiPipeline<FakeOutput>
const ndi = (patch: Partial<NdiSettings> = {}): NdiSettings => ({ ...DEFAULT_SETTINGS.ndi, ...patch })
const last = (): FakeOutput => outputs[outputs.length - 1]

beforeEach(() => {
  vi.useFakeTimers()
  sender = new FakeNdiSender()
  outputs = []
  pipeline = new NdiPipeline(sender, (opts, send) => {
    const o = new FakeOutput(opts, send)
    outputs.push(o)
    return o
  })
})
afterEach(() => {
  pipeline.shutdown()
  vi.useRealTimers()
})

describe('NdiPipeline', () => {
  it('starts the sender with the name and resolution from settings', () => {
    pipeline.apply(DEFAULT_SETTINGS.ndi)
    expect(sender.starts).toEqual([{ name: 'PPT Share', width: 1920, height: 1080, fps: 30 }])
    expect(outputs).toHaveLength(1)
    expect(last().opts).toEqual({ width: 1920, height: 1080, fps: 30 })
    expect(last().started).toBe(true)
  })

  it('sends every repeated frame at width*height*4 bytes, at the settings fps', () => {
    pipeline.apply(DEFAULT_SETTINGS.ndi)
    last().paint()
    vi.advanceTimersByTime(1000)
    expect(sender.frames.length).toBeGreaterThanOrEqual(29)
    expect(sender.frames.length).toBeLessThanOrEqual(31)
    expect(sender.frames.every((n) => n === 1920 * 1080 * 4)).toBe(true)
  })

  it('turning enabled off stops the sender and the output; nothing is sent after', () => {
    pipeline.apply(DEFAULT_SETTINGS.ndi)
    last().paint()
    vi.advanceTimersByTime(200)
    pipeline.apply(ndi({ enabled: false }))
    expect(sender.stops).toBe(1)
    expect(sender.running).toBe(false)
    expect(last().closed).toBe(true)
    const n = sender.frames.length
    vi.advanceTimersByTime(1000)
    expect(sender.frames.length).toBe(n)
    expect(pipeline.current).toBeNull()
  })

  it('starts disabled without creating an output or starting the sender', () => {
    pipeline.apply(ndi({ enabled: false }))
    expect(sender.starts).toHaveLength(0)
    expect(outputs).toHaveLength(0)
  })

  it('turning enabled back on starts again', () => {
    pipeline.apply(DEFAULT_SETTINGS.ndi)
    pipeline.apply(ndi({ enabled: false }))
    pipeline.apply(DEFAULT_SETTINGS.ndi)
    expect(sender.starts).toHaveLength(2)
    expect(outputs).toHaveLength(2)
    expect(last().closed).toBe(false)
  })

  it('a name change restarts the sender but keeps the output window', () => {
    pipeline.apply(DEFAULT_SETTINGS.ndi)
    pipeline.apply(ndi({ name: 'Aula' }))
    expect(sender.starts.map((s) => s.name)).toEqual(['PPT Share', 'Aula'])
    expect(outputs).toHaveLength(1)
  })

  it('applying the same settings again does not rebuild anything', () => {
    pipeline.apply(DEFAULT_SETTINGS.ndi)
    pipeline.apply(DEFAULT_SETTINGS.ndi)
    expect(outputs).toHaveLength(1)
  })

  describe('resolution / fps change', () => {
    const uhd = ndi({ width: 3840, height: 2160, fps: 60 })

    it('builds a new output at the new size and keeps sending the old frames until it paints', () => {
      pipeline.apply(DEFAULT_SETTINGS.ndi)
      const old = last()
      old.paint()
      vi.advanceTimersByTime(100)
      pipeline.apply(uhd)
      expect(outputs).toHaveLength(2)
      expect(last().opts).toEqual({ width: 3840, height: 2160, fps: 60 })
      expect(last().started).toBe(true)
      // No gap: the old window still feeds the sender while the new one loads.
      const before = sender.frames.length
      vi.advanceTimersByTime(300)
      expect(sender.frames.length).toBeGreaterThan(before + 5)
      expect(sender.frames.slice(before).every((n) => n === 1920 * 1080 * 4)).toBe(true)
      expect(old.closed).toBe(false)
      expect(pipeline.current).toBe(old)
    })

    it('swaps on the first frame of the new output: restarts the sender with the new size', () => {
      pipeline.apply(DEFAULT_SETTINGS.ndi)
      const old = last()
      old.paint()
      pipeline.apply(uhd)
      const fresh = last()
      fresh.paint()
      vi.advanceTimersByTime(50)
      expect(sender.starts[sender.starts.length - 1]).toEqual({
        name: 'PPT Share',
        width: 3840,
        height: 2160,
        fps: 60
      })
      expect(old.closed).toBe(true)
      expect(pipeline.current).toBe(fresh)
      const n = sender.frames.length
      vi.advanceTimersByTime(1000)
      const sent = sender.frames.slice(n)
      expect(sent.length).toBeGreaterThanOrEqual(58)
      expect(sent.every((x) => x === 3840 * 2160 * 4)).toBe(true)
    })

    it('swaps anyway after a timeout when the new output never paints', () => {
      pipeline.apply(DEFAULT_SETTINGS.ndi)
      const old = last()
      pipeline.apply(uhd)
      vi.advanceTimersByTime(5000)
      expect(old.closed).toBe(true)
      expect(pipeline.current).toBe(last())
      expect(sender.starts[sender.starts.length - 1].width).toBe(3840)
    })

    it('a second change while one is pending discards the pending output', () => {
      pipeline.apply(DEFAULT_SETTINGS.ndi)
      pipeline.apply(uhd)
      const pending = last()
      pipeline.apply(ndi({ fps: 60 }))
      expect(pending.closed).toBe(true)
      expect(outputs).toHaveLength(3)
      last().paint()
      vi.advanceTimersByTime(50)
      expect(sender.starts[sender.starts.length - 1]).toEqual({
        name: 'PPT Share',
        width: 1920,
        height: 1080,
        fps: 60
      })
      expect(outputs.filter((o) => !o.closed)).toEqual([last()])
    })

    it('changing back to the active size while pending drops the pending output only', () => {
      pipeline.apply(DEFAULT_SETTINGS.ndi)
      const old = last()
      pipeline.apply(uhd)
      const pending = last()
      pipeline.apply(DEFAULT_SETTINGS.ndi)
      expect(pending.closed).toBe(true)
      expect(old.closed).toBe(false)
      expect(pipeline.current).toBe(old)
      vi.advanceTimersByTime(5000)
      expect(pipeline.current).toBe(old)
      expect(sender.starts[sender.starts.length - 1].width).toBe(1920)
    })

    it('disabling while a change is pending closes both outputs', () => {
      pipeline.apply(DEFAULT_SETTINGS.ndi)
      pipeline.apply(uhd)
      pipeline.apply(ndi({ enabled: false }))
      expect(outputs.every((o) => o.closed)).toBe(true)
      vi.advanceTimersByTime(5000)
      expect(sender.running).toBe(false)
    })
  })

  it('shutdown stops the sender and every output', () => {
    pipeline.apply(DEFAULT_SETTINGS.ndi)
    pipeline.apply(ndi({ fps: 60 }))
    pipeline.shutdown()
    expect(outputs.every((o) => o.closed)).toBe(true)
    expect(sender.running).toBe(false)
  })
})
