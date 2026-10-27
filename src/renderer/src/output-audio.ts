/** AudioContext.setSinkId is not in every lib.dom version. */
type SinkContext = AudioContext & { setSinkId?: (id: string) => Promise<void> }
type SinkElement = HTMLVideoElement & { setSinkId?: (id: string) => Promise<void> }

/** The tap's sample rate: OMT carries 48 kHz sound. */
export const TAP_SAMPLE_RATE = 48000

export interface OutputAudioOptions {
  /** URL of the bundled `omt-tap.worklet` module. */
  tapModuleUrl?: string
  /** Builds the tap node; tests pass a fake. */
  makeTapNode?: (ctx: AudioContext) => AudioWorkletNode
  /** Reports a problem the operator should see (once per kind). */
  onWarning?: (w: 'no-sound') => void
}

/** What this window does with the sound: play it here, and/or tap it for OMT. */
export interface SoundPlan {
  local: boolean
  tap: boolean
}

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
  private readonly streams = new Map<MediaStream, MediaStreamAudioSourceNode>()

  private plan: SoundPlan = { local: true, tap: false }
  private port: MessagePort | null = null
  private localOn = false
  private tapNode: AudioWorkletNode | null = null
  private tapSink: GainNode | null = null
  private tapLoad: Promise<boolean> | null = null
  private tapFailed = false

  constructor(
    private readonly create: () => AudioContext = () =>
      new AudioContext({ sampleRate: TAP_SAMPLE_RATE }),
    private readonly opts: OutputAudioOptions = {}
  ) {}

  /**
   * Sets where the sound goes. `local` connects the gain to the speakers,
   * `tap` sends 10 ms planar blocks `{ data, samples: 480 }` to `port` for OMT.
   * A failing worklet only loses the tap (warning 'no-sound' once); local sound
   * is unaffected.
   */
  async setPlan(p: SoundPlan, port: MessagePort | null): Promise<void> {
    this.plan = p
    this.port = port
    if (!this.ctx && !this.fallback && p.tap) this.open()
    this.applyLocal()
    if (!p.tap) {
      this.removeTap()
      return
    }
    if (!this.ctx || !this.node || this.tapFailed) return
    this.resume()
    if (this.tapNode) return
    this.tapLoad ??= this.loadTap()
    if (await this.tapLoad) this.addTap()
  }

  private applyLocal(): void {
    if (this.ctx && this.node) {
      if (this.plan.local && !this.localOn) {
        this.node.connect(this.ctx.destination)
        this.localOn = true
      } else if (!this.plan.local && this.localOn) {
        try {
          this.node.disconnect(this.ctx.destination)
        } catch {
          // Already disconnected.
        }
        this.localOn = false
      }
    }
    // Elements outside the graph follow the plan through their volume.
    for (const [v, src] of this.sources) if (src === null) v.volume = this.elementVolume()
  }

  private elementVolume(): number {
    return this.plan.local ? this.gain : 0
  }

  private async loadTap(): Promise<boolean> {
    try {
      if (!this.ctx) return false
      if (!this.opts.tapModuleUrl) throw new Error('no tap module')
      await this.ctx.audioWorklet.addModule(this.opts.tapModuleUrl)
      return true
    } catch (e) {
      this.tapFailed = true
      console.warn('[audio] OMT sound tap could not be loaded:', e)
      this.opts.onWarning?.('no-sound')
      return false
    }
  }

  private addTap(): void {
    if (!this.plan.tap || this.tapNode || !this.ctx || !this.node) return
    try {
      const node =
        this.opts.makeTapNode?.(this.ctx) ??
        new AudioWorkletNode(this.ctx, 'omt-tap', {
          numberOfInputs: 1,
          numberOfOutputs: 1,
          outputChannelCount: [2],
          channelCount: 2,
          channelCountMode: 'explicit'
        })
      node.port.onmessage = (e: MessageEvent): void => {
        const m = e.data as { data: Float32Array; samples: number }
        try {
          // Copied, not transferred: Electron's main process receives a
          // transferred buffer as null (verified in the packaged app).
          this.port?.postMessage(m)
        } catch {
          // The port is gone: this block is dropped, the next port gets the next ones.
        }
      }
      // A node nothing pulls on never runs: end it in a silent sink to the destination.
      const sink = this.ctx.createGain()
      sink.gain.value = 0
      this.node.connect(node)
      node.connect(sink)
      sink.connect(this.ctx.destination)
      this.tapNode = node
      this.tapSink = sink
    } catch (e) {
      this.tapFailed = true
      console.warn('[audio] OMT sound tap could not be started:', e)
      this.opts.onWarning?.('no-sound')
    }
  }

  private removeTap(): void {
    const node = this.tapNode
    if (!node) return
    this.tapNode = null
    try {
      this.node?.disconnect(node)
      node.disconnect()
      this.tapSink?.disconnect()
    } catch {
      // Already disconnected.
    }
    node.port.onmessage = null
    this.tapSink = null
  }

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
    if (this.sources.get(v) === null) v.volume = this.elementVolume()
    this.sinkElement(v)
  }

  /**
   * Routes a captured stream's sound (a web deck's page) into the same gain.
   * False when Web Audio is not usable: the stream then has no sound here (a
   * captured page is never played locally by Chromium either).
   */
  attachStream(stream: MediaStream): boolean {
    if (this.streams.has(stream)) return true
    if (!this.fallback && !this.ctx) this.open()
    if (!this.ctx || !this.node) return false
    try {
      const src = this.ctx.createMediaStreamSource(stream)
      src.connect(this.node)
      this.streams.set(stream, src)
      this.resume()
      return true
    } catch (e) {
      console.warn('[audio] web page sound could not be connected:', e)
      return false
    }
  }

  /** Disconnects a stream's sound (its layer is going away or muted). */
  detachStream(stream: MediaStream): void {
    try {
      this.streams.get(stream)?.disconnect()
    } catch {
      // Already disconnected.
    }
    this.streams.delete(stream)
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
    for (const [v, src] of this.sources) if (src === null) v.volume = this.elementVolume()
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
    for (const st of [...this.streams.keys()]) this.detachStream(st)
    this.removeTap()
    const ctx = this.ctx
    this.ctx = null
    this.node = null
    this.localOn = false
    ctx?.close().catch(() => undefined)
  }

  private open(): void {
    try {
      const ctx: SinkContext = this.create()
      const node = ctx.createGain()
      node.gain.value = this.gain
      this.ctx = ctx
      this.node = node
      this.localOn = false
      this.applyLocal()
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
