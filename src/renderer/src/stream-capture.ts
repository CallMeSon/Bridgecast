import { playFirstFrame, stopStream } from './stream'

/** No first frame within this time: the layer shows its poster (and keeps trying). */
export const STREAM_PENDING_MS = 3000
/** Waits before capturing again after a failure or an ended track (then stays at the last). */
export const STREAM_RETRY_MS = [1000, 2000, 4000, 5000]
/** Opening a capture (source id + getUserMedia) that takes longer counts as failed. */
export const STREAM_OPEN_TIMEOUT_MS = 5000
/** The still of the last frame is refreshed at most this often while the stream plays. */
export const STILL_COPY_MS = 150

export interface CaptureEntry {
  key: number
  stream: MediaStream
}

/**
 * What the layer renders: one <video> per entry, `shownKey` visible; on top, the
 * still of the last frame (`still`: paused, or the visible track ended) or else the
 * poster (`poster`: no frame at all).
 */
export interface CaptureView {
  entries: CaptureEntry[]
  shownKey: number | null
  poster: boolean
  still?: boolean
}

/** How the still of the last good frame is taken (tests pass a fake). */
export interface FrameTap {
  /** Calls `cb` for each frame `v` presents until the returned function is called. */
  watch(v: HTMLVideoElement, cb: () => void): () => void
  /** Copies the frame `v` shows now into the still; false when nothing could be copied. */
  copy(v: HTMLVideoElement): boolean
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
  /** The layer has paused its visible stream (HOLD, Freeze). */
  onPaused?(): void
  /** Still of the last frame; default: the canvas given to `bindStill`. */
  tap?: FrameTap
  /**
   * An ended track keeps showing the still of its last frame (default; a web page held
   * on HOLD). False for a slide show: a frame of an earlier slide would be wrong, so the
   * poster (the slide's PNG) shows until a new capture has a frame.
   */
  holdOnEnd?: boolean
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
  private readonly openTimers = new Set<ReturnType<typeof setTimeout>>()
  /** The still canvas (one per layer, capture size) and whether it holds a frame. */
  private canvas: HTMLCanvasElement | null = null
  private hasStill = false
  private lastCopy = -Infinity
  private unwatch: (() => void) | null = null
  /** The visible capture's track ended (its <video> is gone). */
  private shownGone = false
  private readonly tap: FrameTap

  constructor(private readonly host: CaptureHost) {
    this.tap = host.tap ?? {
      watch: (v, cb) => watchFrames(v, cb),
      copy: (v) => this.copyToCanvas(v)
    }
  }

  /** The layer's still canvas (null when it unmounts). */
  bindStill(c: HTMLCanvasElement | null): void {
    this.canvas = c
  }

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
    // A source id or getUserMedia that never answers must not stop the retries.
    let settled = false
    const timer = setTimeout(() => {
      this.openTimers.delete(timer)
      if (settled || !this.alive) return
      settled = true
      console.warn(`[stream] capture did not open within ${STREAM_OPEN_TIMEOUT_MS} ms`)
      this.failure()
    }, STREAM_OPEN_TIMEOUT_MS)
    this.openTimers.add(timer)
    const settle = (): boolean => {
      clearTimeout(timer)
      this.openTimers.delete(timer)
      if (settled) return false
      settled = true
      return true
    }
    this.host.open().then(
      (stream) => {
        if (!settle() || !this.alive) {
          stopStream(stream)
          return
        }
        this.attempt = 0
        const key = ++this.seq
        stream.getVideoTracks()[0]?.addEventListener('ended', () => this.ended(key))
        // Earlier captures that never got a frame are superseded.
        for (const e of [...this.entries]) {
          if (e.key !== this.shown && !this.framed.has(e.key)) this.drop(e.key)
        }
        this.entries.push({ key, stream })
        this.frameTimers.set(
          key,
          setTimeout(() => this.noFrame(key), STREAM_PENDING_MS)
        )
        this.emit()
      },
      (err: unknown) => {
        if (!settle() || !this.alive) return
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
    this.emit()
    if (paused) this.host.onPaused?.()
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
    this.openTimers.forEach(clearTimeout)
    this.openTimers.clear()
    this.unwatch?.()
    this.unwatch = null
    this.host.sound(null)
    for (const e of this.entries) stopStream(e.stream)
    for (const v of this.videos.values()) release(v)
    this.entries = []
    this.videos.clear()
    // The still holds a full frame: give its memory back.
    if (this.canvas) {
      this.canvas.width = 0
      this.canvas.height = 0
    }
    this.hasStill = false
    if (this.failed) this.host.onFailed(false)
  }

  /** Stops a capture and releases its <video> (no stream stays attached). */
  private drop(key: number): void {
    const e = this.entries.find((x) => x.key === key)
    if (e) stopStream(e.stream)
    this.entries = this.entries.filter((x) => x.key !== key)
    const v = this.videos.get(key)
    if (v) release(v)
    this.videos.delete(key)
    this.framed.delete(key)
    this.started.delete(key)
    const t = this.frameTimers.get(key)
    if (t) clearTimeout(t)
    this.frameTimers.delete(key)
  }

  /** Keeps the still current while the stream plays (never while paused). */
  private watchShown(): void {
    this.unwatch?.()
    this.unwatch = null
    const v = this.shown !== null ? this.videos.get(this.shown) : undefined
    if (!v) return
    this.copyNow(v)
    this.unwatch = this.tap.watch(v, () => {
      if (this.host.paused() || Date.now() - this.lastCopy < STILL_COPY_MS) return
      this.copyNow(v)
    })
  }

  private copyNow(v: HTMLVideoElement): void {
    try {
      if (this.tap.copy(v)) {
        this.hasStill = true
        this.lastCopy = Date.now()
      }
    } catch (e) {
      console.warn('[stream] could not keep the last frame:', e)
    }
  }

  private copyToCanvas(v: HTMLVideoElement): boolean {
    const c = this.canvas
    if (!c || !v.videoWidth || !v.videoHeight) return false
    if (c.width !== v.videoWidth) c.width = v.videoWidth
    if (c.height !== v.videoHeight) c.height = v.videoHeight
    const ctx = c.getContext('2d')
    if (!ctx) return false
    ctx.drawImage(v, 0, 0, c.width, c.height)
    return true
  }

  /** A capture that never delivered a frame is dropped and replaced by a new one. */
  private noFrame(key: number): void {
    this.frameTimers.delete(key)
    if (!this.alive || this.framed.has(key)) return
    const e = this.entries.find((x) => x.key === key)
    if (!e) return
    console.warn('[stream] capture has no frame, capturing again')
    this.drop(key)
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
    for (const e of [...this.entries]) if (e.key < key) this.drop(e.key)
    this.shown = key
    this.shownGone = false
    this.poster = false
    this.setFailed(false)
    this.syncSound()
    this.applyPause()
    this.watchShown()
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
    if (key === this.shown) {
      this.unwatch?.()
      this.unwatch = null
    }
    this.drop(key)
    if (key === this.shown) {
      // An ended track goes black: the still of the last frame (else the poster) covers
      // it until a new capture has a frame.
      this.shownGone = true
      this.poster = true
      this.setFailed(true)
    }
    this.emit()
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
    const still =
      this.hasStill && ((this.shownGone && this.host.holdOnEnd !== false) || this.host.paused())
    this.host.onView({
      entries: [...this.entries],
      shownKey: this.shown,
      poster: this.poster && !still,
      still
    })
  }
}

function release(v: HTMLVideoElement): void {
  v.pause()
  v.srcObject = null
}

/** requestVideoFrameCallback loop on `v` (nothing without the API). */
function watchFrames(v: HTMLVideoElement, cb: () => void): () => void {
  if (!v.requestVideoFrameCallback) return () => undefined
  let id = 0
  let on = true
  const next = (): void => {
    if (!on) return
    cb()
    id = v.requestVideoFrameCallback(next)
  }
  id = v.requestVideoFrameCallback(next)
  return () => {
    on = false
    v.cancelVideoFrameCallback?.(id)
  }
}
