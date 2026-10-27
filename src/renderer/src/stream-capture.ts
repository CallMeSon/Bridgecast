import { playFirstFrame, stopStream } from './stream'

/** No first frame within this time: the layer shows its poster (and keeps trying). */
export const STREAM_PENDING_MS = 3000
/** Waits before capturing again after a failure or an ended track (then stays at the last). */
export const STREAM_RETRY_MS = [1000, 2000, 4000, 5000]

export interface CaptureEntry {
  key: number
  stream: MediaStream
}

/** What the layer renders: one <video> per entry, `shownKey` visible, the poster on top when set. */
export interface CaptureView {
  entries: CaptureEntry[]
  shownKey: number | null
  poster: boolean
}

/** The layer's side of a capture: how to open it, its sound, and what it reports. */
export interface CaptureHost {
  /** Requests a fresh source id and opens the stream. */
  open(): Promise<MediaStream>
  paused(): boolean
  /** Connects the visible stream's sound (or null to disconnect it). */
  sound(stream: MediaStream | null): void
  onView(view: CaptureView): void
  onReady(): void
  onFrame(): void
  onEnded(): void
  onFailed(failed: boolean): void
  /** Plays a stream in a <video> and resolves on its first frame (tests pass a fake). */
  play?(v: HTMLVideoElement, stream: MediaStream): Promise<void>
}

/**
 * One stream layer's captures, outside React. Each capture requests a new source
 * id. A capture plays into its own <video>; it becomes the visible one on its
 * first frame unless the layer is paused (a held frame stays held until resume).
 * A failed open or an ended track shows the poster (never black), reports the
 * failure and captures again after a while.
 */
export class StreamCapture {
  private entries: CaptureEntry[] = []
  private shown: number | null = null
  private poster = false
  private readonly framed = new Set<number>()
  private readonly started = new Set<number>()
  private readonly videos = new Map<number, HTMLVideoElement>()
  private seq = 0
  private alive = true
  private ready = false
  private failed = false
  private attempt = 0
  private retry: ReturnType<typeof setTimeout> | null = null
  private pending: ReturnType<typeof setTimeout> | null = null
  /** Per capture: no first frame in time means capture again (seen after a page crash reload). */
  private readonly frameTimers = new Map<number, ReturnType<typeof setTimeout>>()

  constructor(private readonly host: CaptureHost) {}

  /** First capture, with the pending timeout that falls back to the poster. */
  start(): void {
    this.capture()
    this.pending = setTimeout(() => {
      this.pending = null
      if (this.ready || !this.alive) return
      console.warn(`[stream] no frame within ${STREAM_PENDING_MS} ms, showing the poster`)
      this.poster = true
      this.setFailed(true)
      this.markReady()
      this.emit()
    }, STREAM_PENDING_MS)
  }

  /** Captures again (new source id); the visible frame stays until the new one has a frame. */
  capture(): void {
    if (!this.alive) return
    this.clearRetry()
    this.host.open().then(
      (stream) => {
        if (!this.alive) {
          stopStream(stream)
          return
        }
        this.attempt = 0
        const key = ++this.seq
        stream.getVideoTracks()[0]?.addEventListener('ended', () => this.ended(key))
        // Earlier captures that never got a frame are superseded.
        this.entries = this.entries.filter((e) => {
          if (e.key === this.shown || this.framed.has(e.key)) return true
          stopStream(e.stream)
          return false
        })
        this.entries.push({ key, stream })
        this.frameTimers.set(
          key,
          setTimeout(() => this.noFrame(key), STREAM_PENDING_MS)
        )
        this.emit()
      },
      (err: unknown) => {
        if (!this.alive) return
        console.warn('[stream] capture failed:', err)
        this.failure()
      }
    )
  }

  /** The <video> of an entry is in the DOM: play it (first frame callback registered before play). */
  bind(key: number, v: HTMLVideoElement): void {
    this.videos.set(key, v)
    const e = this.entries.find((x) => x.key === key)
    if (!e || this.started.has(key)) return
    this.started.add(key)
    const play = this.host.play ?? playFirstFrame
    play(v, e.stream).then(
      () => this.firstFrame(key),
      (err: unknown) => {
        if (!this.alive) return
        console.warn('[stream] capture could not play:', err)
        this.failure()
      }
    )
  }

  /** Pause holds the visible frame; resuming shows the newest capture that has a frame. */
  setPaused(paused: boolean): void {
    if (!paused) {
      const newest = [...this.entries].reverse().find((e) => this.framed.has(e.key))
      if (newest && newest.key !== this.shown) {
        this.promote(newest.key)
        return
      }
    }
    this.applyPause()
  }

  /** Sound follows the visible stream (call again when muting changes). */
  syncSound(): void {
    this.host.sound(this.entries.find((e) => e.key === this.shown)?.stream ?? null)
  }

  dispose(): void {
    this.alive = false
    this.clearRetry()
    if (this.pending) clearTimeout(this.pending)
    this.pending = null
    this.frameTimers.forEach(clearTimeout)
    this.frameTimers.clear()
    this.host.sound(null)
    for (const e of this.entries) stopStream(e.stream)
    for (const v of this.videos.values()) {
      v.pause()
      v.srcObject = null
    }
    this.entries = []
    this.videos.clear()
    if (this.failed) this.host.onFailed(false)
  }

  /** A capture that never delivered a frame is dropped and replaced by a new one. */
  private noFrame(key: number): void {
    this.frameTimers.delete(key)
    if (!this.alive || this.framed.has(key)) return
    const e = this.entries.find((x) => x.key === key)
    if (!e) return
    console.warn('[stream] capture has no frame, capturing again')
    stopStream(e.stream)
    this.entries = this.entries.filter((x) => x.key !== key)
    this.emit()
    this.scheduleRetry()
  }

  private firstFrame(key: number): void {
    if (!this.alive || !this.entries.some((e) => e.key === key)) return
    const t = this.frameTimers.get(key)
    if (t) clearTimeout(t)
    this.frameTimers.delete(key)
    this.framed.add(key)
    this.host.onFrame()
    if (this.shown === null || !this.host.paused()) this.promote(key)
  }

  private promote(key: number): void {
    this.entries = this.entries.filter((e) => {
      if (e.key >= key) return true
      stopStream(e.stream)
      this.videos.delete(e.key)
      return false
    })
    this.shown = key
    this.poster = false
    this.setFailed(false)
    this.syncSound()
    this.applyPause()
    this.markReady()
    this.emit()
  }

  private applyPause(): void {
    const v = this.shown !== null ? this.videos.get(this.shown) : undefined
    if (!v) return
    if (this.host.paused()) v.pause()
    else v.play()?.catch((e: unknown) => console.warn('[stream] could not resume:', e))
  }

  private ended(key: number): void {
    if (!this.alive) return
    this.host.onEnded()
    const e = this.entries.find((x) => x.key === key)
    if (e) stopStream(e.stream)
    if (key === this.shown) {
      // An ended track goes black: the poster covers it until a new capture has a frame.
      this.poster = true
      this.setFailed(true)
      this.emit()
    }
    this.scheduleRetry()
  }

  private failure(): void {
    if (!this.entries.some((e) => e.key === this.shown)) this.poster = true
    this.setFailed(true)
    this.markReady()
    this.emit()
    this.scheduleRetry()
  }

  private scheduleRetry(): void {
    if (this.retry || !this.alive) return
    const wait = STREAM_RETRY_MS[Math.min(this.attempt, STREAM_RETRY_MS.length - 1)]
    this.attempt++
    this.retry = setTimeout(() => {
      this.retry = null
      this.capture()
    }, wait)
  }

  private clearRetry(): void {
    if (this.retry) clearTimeout(this.retry)
    this.retry = null
  }

  private markReady(): void {
    if (this.ready) return
    this.ready = true
    if (this.pending) clearTimeout(this.pending)
    this.pending = null
    this.host.onReady()
  }

  private setFailed(f: boolean): void {
    if (this.failed === f) return
    this.failed = f
    this.host.onFailed(f)
  }

  private emit(): void {
    if (!this.alive) return
    this.host.onView({ entries: [...this.entries], shownKey: this.shown, poster: this.poster })
  }
}
