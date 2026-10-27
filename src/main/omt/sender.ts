import { dropWarning, type OmtStatus } from '../../shared/omt'
import type { SenderBinding } from '../net/sender-binding'
import { OmtLoadError } from './binding'
import { FrameClock, type Frame } from './frame-clock'

export interface SendTarget {
  id: 'omt' | 'ndi'
  name: string
  binding: () => SenderBinding
  report: (s: Partial<OmtStatus>) => void
}

type Timers = {
  setInterval: (fn: () => void, ms: number) => ReturnType<typeof setInterval>
  clearInterval: (id: ReturnType<typeof setInterval>) => void
}

const LIBRARY_MISSING = 'OMT could not start: its library is missing. Reinstall PPT Share.'
const CREATE_FAILED =
  'OMT could not start. Close other apps that send OMT, then turn OMT off and on.'
const POLL_MS = 1000
const SAMPLE_KEEP_MS = 10_000
const SAMPLE_RATE = 48_000

interface Live {
  target: SendTarget
  binding: SenderBinding
  handle: number
}

/**
 * Sends frames and sound to every target. Runs inside the output worker.
 * One FrameClock paces video; the real omt_send blocks about 1/fps per call,
 * so cadence equals fps and nothing else paces it. Audio blocks arrive between
 * sends and go out back-to-back.
 */
export class OmtSender {
  private clock: FrameClock | null = null
  private poll: ReturnType<typeof setInterval> | null = null
  private live: Live[] = []
  private fps: 30 | 60 = 30

  constructor(
    private readonly timers: Timers = {
      setInterval: (fn, ms) => setInterval(fn, ms),
      clearInterval: (id) => clearInterval(id)
    }
  ) {}

  start(o: { targets: SendTarget[]; fps: 30 | 60; width: number; height: number }): void {
    this.stop()
    this.fps = o.fps
    for (const target of o.targets) {
      target.report({ state: 'starting', connections: 0, address: null })
      let binding: SenderBinding
      try {
        binding = target.binding()
      } catch (e) {
        const message = e instanceof OmtLoadError ? LIBRARY_MISSING : CREATE_FAILED
        target.report({ state: 'error', message })
        continue
      }
      let handle = 0
      try {
        handle = binding.create(target.name)
      } catch {
        handle = 0
      }
      if (!handle) {
        target.report({ state: 'error', message: CREATE_FAILED })
        continue
      }
      this.live.push({ target, binding, handle })
      target.report({ state: 'running', connections: 0, address: binding.address(handle) })
    }
    if (this.live.length === 0) return

    // A new clock every start: a stopped clock keeps its last frame (stale slide).
    this.clock = new FrameClock(o.fps, (f) => this.sendVideo(f), this.timers)
    this.clock.start()

    let prev = { sent: 0, dropped: 0 }
    const samples: { sent: number; dropped: number; at: number }[] = []
    this.poll = this.timers.setInterval(() => {
      const now = Date.now()
      const st = this.clock?.stats() ?? prev
      samples.push({ sent: st.sent - prev.sent, dropped: st.dropped - prev.dropped, at: now })
      prev = st
      while (samples.length > 0 && now - samples[0].at > SAMPLE_KEEP_MS) samples.shift()
      for (const l of this.live) {
        const s: Partial<OmtStatus> = {
          connections: this.safe(() => l.binding.connections(l.handle), 0)
        }
        if (l.target.id === 'omt')
          s.warning = dropWarning(samples, this.fps, now) ? 'drops' : undefined
        l.target.report(s)
      }
    }, POLL_MS)
  }

  frame(f: Frame): void {
    this.clock?.push(f)
  }

  audio(a: Float32Array, samples: number): void {
    for (const l of this.live) {
      this.safe(() => {
        l.binding.sendAudio(l.handle, {
          sampleRate: SAMPLE_RATE,
          channels: 2,
          samples,
          data: a
        })
      }, undefined)
    }
  }

  /** Stops the clock first so nothing is sent after destroy. */
  stop(): void {
    this.clock?.stop()
    this.clock = null
    if (this.poll !== null) this.timers.clearInterval(this.poll)
    this.poll = null
    const live = this.live
    this.live = []
    for (const l of live) {
      this.safe(() => l.binding.destroy(l.handle), undefined)
      l.target.report({ state: 'off', connections: 0, address: null, warning: undefined })
    }
  }

  private sendVideo(f: Frame): void {
    for (const l of this.live) {
      this.safe(() => {
        l.binding.sendVideo(l.handle, {
          width: f.width,
          height: f.height,
          fps: this.fps,
          data: f.data
        })
      }, undefined)
    }
  }

  private safe<T>(fn: () => T, fallback: T): T {
    try {
      return fn()
    } catch {
      return fallback
    }
  }
}
