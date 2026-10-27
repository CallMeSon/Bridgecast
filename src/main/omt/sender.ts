import { NDI_COPY, dropWarning, type OmtStatus } from '../../shared/omt'
import type { SenderBinding } from '../net/sender-binding'
import { OmtLoadError } from './binding'
import { NdiLoadError } from '../ndi/binding'
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
function loadMessage(id: SendTarget['id'], e: unknown): string {
  if (id === 'ndi') {
    if (e instanceof NdiLoadError) return e.kind === 'old' ? NDI_COPY.tooOld : NDI_COPY.missing
    return NDI_COPY.createFailed
  }
  return e instanceof OmtLoadError ? LIBRARY_MISSING : CREATE_FAILED
}

const createMessage = (id: SendTarget['id']): string =>
  id === 'ndi' ? NDI_COPY.createFailed : CREATE_FAILED
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
  /** Targets that could not start; left alone until they are unlisted. */
  private failed = new Map<SendTarget['id'], SendTarget>()
  private fps: 30 | 60 = 30

  constructor(
    private readonly timers: Timers = {
      setInterval: (fn, ms) => setInterval(fn, ms),
      clearInterval: (id) => clearInterval(id)
    }
  ) {}

  /** Starts from scratch (a stop first) with a new frame rate and target list. */
  start(o: { targets: SendTarget[]; fps: 30 | 60; width: number; height: number }): void {
    this.stop()
    this.fps = o.fps
    this.setTargets(o.targets)
  }

  /**
   * Makes the sender follow `targets`. A target whose id is new is created and
   * reports; an id no longer listed is destroyed; the others (also failed ones)
   * are untouched and the frame clock keeps its cadence. An empty list stops
   * the clock (before anything is destroyed); a clock needed again is a new one.
   */
  setTargets(targets: SendTarget[]): void {
    const ids = new Set(targets.map((t) => t.id))
    const gone = this.live.filter((l) => !ids.has(l.target.id))
    for (const id of [...this.failed.keys()]) if (!ids.has(id)) this.failed.delete(id)
    const keep = this.live.filter((l) => ids.has(l.target.id))
    if (keep.length === 0) this.stopClock()
    this.live = keep
    for (const l of gone) this.release(l)

    for (const target of targets) {
      if (this.failed.has(target.id) || this.live.some((l) => l.target.id === target.id)) continue
      const l = this.open(target)
      if (l) this.live.push(l)
      else this.failed.set(target.id, target)
    }
    if (this.live.length > 0 && !this.clock) this.startClock()
  }

  private open(target: SendTarget): Live | null {
    target.report({ state: 'starting', connections: 0, address: null })
    let binding: SenderBinding
    try {
      binding = target.binding()
    } catch (e) {
      target.report({ state: 'error', message: loadMessage(target.id, e) })
      return null
    }
    let handle = 0
    try {
      handle = binding.create(target.name)
    } catch {
      handle = 0
    }
    if (!handle) {
      target.report({ state: 'error', message: createMessage(target.id) })
      return null
    }
    target.report({ state: 'running', connections: 0, address: binding.address(handle) })
    return { target, binding, handle }
  }

  private release(l: Live): void {
    this.safe(() => l.binding.destroy(l.handle), undefined)
    l.target.report({ state: 'off', connections: 0, address: null, warning: undefined })
  }

  private startClock(): void {
    // A new clock every time: a stopped clock keeps its last frame (stale slide).
    this.clock = new FrameClock(this.fps, (f) => this.sendVideo(f), this.timers)
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
        // Frame drops only matter to OMT (NDI buffers inside its runtime).
        if (l.target.id === 'omt')
          s.warning = dropWarning(samples, this.fps, now) ? 'drops' : undefined
        l.target.report(s)
      }
    }, POLL_MS)
  }

  private stopClock(): void {
    this.clock?.stop()
    this.clock = null
    if (this.poll !== null) this.timers.clearInterval(this.poll)
    this.poll = null
  }

  frame(f: Frame): void {
    this.clock?.push(f)
  }

  /**
   * `a` must be 48 kHz planar stereo with a.length === 2 * samples: all left
   * samples first, then all right samples.
   */
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
    this.stopClock()
    const live = this.live
    this.live = []
    this.failed.clear()
    for (const l of live) this.release(l)
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
