/** AudioContext.setSinkId is not in every lib.dom version. */
type SinkContext = AudioContext & { setSinkId?: (id: string) => Promise<void> }
type SinkElement = HTMLVideoElement & { setSinkId?: (id: string) => Promise<void> }

/** Time constant of a gain change: fast enough to feel instant, slow enough not to click. */
const GAIN_TIME_CONSTANT = 0.015

/**
 * The output window's video sound, routed through one GainNode so the deck and
 * master volume apply to all of it (and later sources can connect to the same
 * node). Each <video> is connected once; an element can only have one source node.
 *
 * Sound never depends on this working: without an AudioContext, or when an
 * element cannot be connected, that element falls back to `element.volume` and
 * its own `setSinkId`, and the video keeps playing.
 */
export class OutputAudio {
  /** True when Web Audio is not usable and `element.volume` is used instead. */
  fallback = false

  private ctx: SinkContext | null = null
  private node: GainNode | null = null
  private gain = 1
  private sink = ''
  private readonly routed = new WeakMap<HTMLVideoElement, string>()
  private readonly sources = new Map<HTMLVideoElement, MediaElementAudioSourceNode | null>()

  constructor(private readonly create: () => AudioContext = () => new AudioContext()) {}

  /** Routes a video's sound into the shared gain. Safe to call on every render. */
  attach(v: HTMLVideoElement): void {
    if (this.sources.has(v)) return
    if (!this.fallback && !this.ctx) this.open()
    if (this.ctx && this.node) {
      try {
        const src = this.ctx.createMediaElementSource(v)
        src.connect(this.node)
        this.sources.set(v, src)
        this.resume()
      } catch (e) {
        this.useFallback(e)
      }
    }
    if (!this.sources.has(v)) this.sources.set(v, null)
    if (this.sources.get(v) === null) v.volume = this.gain
    this.sinkElement(v)
  }

  /** Forgets a video that is about to be removed. */
  detach(v: HTMLVideoElement): void {
    try {
      this.sources.get(v)?.disconnect()
    } catch {
      // Already disconnected: nothing to release.
    }
    this.sources.delete(v)
  }

  /**
   * The level the sound path was last given (0–1): the gain target, or for
   * elements outside the graph the volume they actually carry. Lets the e2e
   * read what the audio path received, not what React computed.
   */
  get level(): number {
    if (!this.node) {
      for (const [v, src] of this.sources) if (src === null) return v.volume
    }
    return this.gain
  }

  /** Sets the gain (0–1) of everything attached. */
  setGain(g: number): void {
    this.gain = Math.min(1, Math.max(0, g))
    if (this.ctx && this.node) {
      this.node.gain.setTargetAtTime(this.gain, this.ctx.currentTime, GAIN_TIME_CONSTANT)
    }
    // Elements outside the graph (fallback) take the volume themselves.
    for (const [v, src] of this.sources) if (src === null) v.volume = this.gain
  }

  /**
   * Sets the audio device ('' = default). The context is asked every time, so a
   * refusal never sticks; elements outside the graph use their own `setSinkId`.
   */
  async setSink(id: string): Promise<void> {
    this.sink = id
    this.sinkElements()
    // No context yet: it gets the device when it is created.
    if (this.ctx) await this.sinkContext(this.ctx, id)
  }

  /** Releases the context. */
  close(): void {
    for (const v of [...this.sources.keys()]) this.detach(v)
    const ctx = this.ctx
    this.ctx = null
    this.node = null
    ctx?.close().catch(() => undefined)
  }

  private open(): void {
    try {
      const ctx: SinkContext = this.create()
      const node = ctx.createGain()
      node.gain.value = this.gain
      node.connect(ctx.destination)
      this.ctx = ctx
      this.node = node
    } catch (e) {
      this.useFallback(e)
      return
    }
    if (this.sink !== '') void this.sinkContext(this.ctx, this.sink)
  }

  /** Autoplay can leave a new context suspended, and then nothing is heard. */
  private resume(): void {
    if (this.ctx?.state !== 'suspended') return
    this.ctx.resume().catch((e: unknown) => console.warn('[audio] could not start the sound:', e))
  }

  private async sinkContext(ctx: SinkContext, id: string): Promise<void> {
    try {
      if (!ctx.setSinkId) throw new Error('AudioContext.setSinkId is not available')
      await ctx.setSinkId(id)
    } catch (e) {
      // Elements in the graph play through the context, so their own setSinkId
      // would do nothing; the next setSink tries the context again.
      console.warn('[audio] audio device could not be used, playing on the default device:', e)
    }
  }

  private useFallback(why: unknown): void {
    if (this.fallback) return
    this.fallback = true
    // Elements already connected stay in the graph (disconnecting would silence
    // them for good); only the ones that cannot be connected use their volume.
    if (this.sources.size === 0) {
      this.node = null
      this.ctx?.close().catch(() => undefined)
      this.ctx = null
    }
    console.warn('[audio] Web Audio is not available, using the video volume:', why)
  }

  private sinkElements(): void {
    for (const v of this.sources.keys()) this.sinkElement(v)
  }

  /** Routes an element outside the graph to the device through its own `setSinkId`. */
  private sinkElement(v: HTMLVideoElement): void {
    if (this.sources.get(v) !== null) return
    if ((this.routed.get(v) ?? '') === this.sink) return
    this.routed.set(v, this.sink)
    ;(v as SinkElement)
      .setSinkId?.(this.sink)
      .catch((e: unknown) =>
        console.warn('[video] audio device could not be used, playing on the default device:', e)
      )
  }
}
