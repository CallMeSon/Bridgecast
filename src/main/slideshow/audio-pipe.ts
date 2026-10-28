import nodeNet from 'node:net'
import { effectiveGain, DEFAULT_DECK_AUDIO } from '../../shared/audio-levels'
import { kvOnAir, type ProgramState } from '../../shared/program'
import type { AudioSettings } from '../../shared/settings'
import { DEFAULT_DEVICE_SOUND } from './powerpoint-engine'

/** Frames in one block sent to the output windows: 10 ms at 48 kHz (same as the OMT tap). */
export const PCM_FRAMES = 480
const BYTES_PER_FRAME = 8 // 2 channels x float32

/** A planar block: `samples` left values, then `samples` right values. */
export interface PcmBlock {
  data: Float32Array
  samples: number
}

/**
 * Turns the bridge's raw PCM (interleaved float32 little-endian, 48 kHz, stereo, no
 * header) into planar 10 ms blocks. Chunks can split a sample anywhere.
 */
export class PcmBlocker {
  private buf = new Uint8Array(PCM_FRAMES * BYTES_PER_FRAME)
  private filled = 0

  push(chunk: Uint8Array): PcmBlock[] {
    const out: PcmBlock[] = []
    let at = 0
    while (at < chunk.length) {
      const n = Math.min(chunk.length - at, this.buf.length - this.filled)
      this.buf.set(chunk.subarray(at, at + n), this.filled)
      this.filled += n
      at += n
      if (this.filled === this.buf.length) {
        out.push(this.toBlock())
        this.filled = 0
      }
    }
    return out
  }

  /** Forget a half block (a new connection starts on a frame boundary). */
  reset(): void {
    this.filled = 0
  }

  private toBlock(): PcmBlock {
    const view = new DataView(this.buf.buffer, this.buf.byteOffset, this.buf.byteLength)
    const data = new Float32Array(PCM_FRAMES * 2)
    for (let i = 0; i < PCM_FRAMES; i++) {
      data[i] = view.getFloat32(i * BYTES_PER_FRAME, true)
      data[PCM_FRAMES + i] = view.getFloat32(i * BYTES_PER_FRAME + 4, true)
    }
    return { data, samples: PCM_FRAMES }
  }
}

/** The part of a socket the pipe reader uses. */
export interface PipeSocket {
  on(ev: 'data', cb: (chunk: Uint8Array) => void): this
  on(ev: 'error', cb: (err: Error) => void): this
  on(ev: 'close', cb: () => void): this
  destroy(): void
}

/** Windows only: connects to `\\.\pipe\pptshare-audio-<pid>` (a Node socket on a named pipe). */
export const connectNamedPipe = (path: string): PipeSocket =>
  nodeNet.connect(path) as unknown as PipeSocket

export interface PcmPipeOptions {
  connect: (path: string) => PipeSocket
  onBlock: (b: PcmBlock) => void
  /** Wait before connecting again after the pipe fails or closes. */
  retryMs?: number
}

/**
 * Reads the bridge's audio pipe and calls `onBlock` for every 10 ms. The bridge serves
 * one reader and serves again after a disconnect, so a closed or missing pipe is
 * retried until `open(null)`.
 */
export class PcmPipe {
  private path: string | null = null
  private sock: PipeSocket | null = null
  private gen = 0
  private timer: ReturnType<typeof setTimeout> | null = null
  private readonly blocker = new PcmBlocker()

  constructor(private readonly opts: PcmPipeOptions) {}

  /** Reads `path` (null = stop). The same path keeps the connection. */
  open(path: string | null): void {
    if (path === this.path) return
    this.teardown()
    this.path = path
    if (path) this.connect()
  }

  private teardown(): void {
    this.gen++
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    try {
      this.sock?.destroy()
    } catch {
      // Already closed.
    }
    this.sock = null
    this.blocker.reset()
  }

  private connect(): void {
    const path = this.path
    if (!path) return
    const gen = ++this.gen
    this.blocker.reset()
    let sock: PipeSocket
    try {
      sock = this.opts.connect(path)
    } catch (e) {
      console.warn('[slideshow] audio pipe:', e instanceof Error ? e.message : e)
      this.retry()
      return
    }
    this.sock = sock
    sock.on('data', (chunk) => {
      if (gen !== this.gen) return
      for (const b of this.blocker.push(chunk)) this.opts.onBlock(b)
    })
    // Connection errors (no server yet, pipe closed) are not fatal; one retry per failure.
    const lost = (): void => {
      if (gen !== this.gen) return
      this.gen++
      try {
        sock.destroy()
      } catch {
        // Already closed.
      }
      this.sock = null
      this.retry()
    }
    sock.on('error', lost)
    sock.on('close', lost)
  }

  private retry(): void {
    if (this.timer || !this.path) return
    this.timer = setTimeout(() => {
      this.timer = null
      this.connect()
    }, this.opts.retryMs ?? 500)
    this.timer.unref?.()
  }
}

/** The part of a MessagePort the fan-out uses (Electron's MessagePortMain). */
export interface PortLike {
  postMessage(m: PcmBlock): void
  close(): void
}

/**
 * The ports of the output windows (HDMI, OMT), one per window. Blocks are posted to all of
 * them while PowerPoint's sound is wanted (a native slide is on air) and dropped otherwise.
 */
export class PcmFanout {
  private ports = new Map<number, PortLike>()
  private wanted = false

  get size(): number {
    return this.ports.size
  }

  /** A new port for a window replaces and closes its old one. */
  add(windowId: number, port: PortLike): void {
    const old = this.ports.get(windowId)
    if (old && old !== port) this.close(old)
    this.ports.set(windowId, port)
  }

  remove(windowId: number): void {
    const p = this.ports.get(windowId)
    this.ports.delete(windowId)
    if (p) this.close(p)
  }

  setWanted(w: boolean): void {
    this.wanted = w
  }

  post(b: PcmBlock): void {
    if (!this.wanted) return
    for (const [id, port] of [...this.ports]) {
      try {
        // Copied, not transferred (the same block goes to every window).
        port.postMessage({ data: b.data, samples: b.samples })
      } catch {
        this.remove(id)
      }
    }
  }

  private close(p: PortLike): void {
    try {
      p.close()
    } catch {
      // Already closed.
    }
  }
}

/** A native deck's slide is the shown slide (it may be hidden by Black or KV). */
export function nativeLive(s: ProgramState): boolean {
  return s.shown?.playback === 'native'
}

/**
 * PowerPoint's sound is wanted in the outputs while a native deck's slide is on air:
 * not while Black or the KV covers it (same predicate as the picture: `black || kvOnAir`),
 * as with the other decks. Freeze does not silence it (frozen picture, sound continues).
 */
export function soundWanted(s: ProgramState): boolean {
  return nativeLive(s) && !(s.black || kvOnAir(s))
}

/**
 * Level (0-1) for PowerPoint's own audio session when the pipe is not available: the live
 * native deck's level times the master, 0 when either is muted or Black/KV covers the
 * slide (restored when they end). Null when no native slide is shown.
 */
export function fallbackVolume(s: ProgramState, audio: AudioSettings): number | null {
  if (!nativeLive(s)) return null
  if (!soundWanted(s)) return 0
  return effectiveGain(s.shown?.audio ?? DEFAULT_DECK_AUDIO, audio)
}

/** What the engine reports about PowerPoint's sound route (see PowerPointEngine.onAudio). */
export interface EngineAudio {
  mode: 'pipe' | 'fallback' | 'device' | 'none'
  pipe: string | null
  note: string | null
}

export interface SlideSoundOptions {
  /** Pipe connection; a Node named-pipe socket on Windows. */
  connect?: (path: string) => PipeSocket
  /** Sets PowerPoint's own session level (the engine's `setVolume`). */
  setVolume: (volume: number) => Promise<void>
  /** The operator copy for a sound the app cannot route changed (null = none). */
  onNote: (note: string | null) => void
}

/**
 * PowerPoint's sound for the outputs. With the loopback pipe, the pipe feeds the output
 * windows and their gain applies the level. Without it (fallback), PowerPoint plays on
 * the PC's default device and the level goes to its audio session; a PowerPoint that was
 * already open (device) is left alone. Both of those show the default-device copy.
 */
export class SlideSound {
  readonly fanout = new PcmFanout()
  private readonly pipe: PcmPipe
  private route: EngineAudio = { mode: 'none', pipe: null, note: null }
  private lastVolume: number | null = null
  private note: string | null = null
  private last: { state: ProgramState; audio: AudioSettings } | null = null

  constructor(private readonly opts: SlideSoundOptions) {
    this.pipe = new PcmPipe({
      connect: opts.connect ?? connectNamedPipe,
      onBlock: (b) => this.fanout.post(b)
    })
  }

  /** The engine's sound route changed (a session opened, the helper stopped, a foreign PowerPoint). */
  engineAudio(a: EngineAudio): void {
    this.route = a
    this.lastVolume = null
    this.pipe.open(a.mode === 'pipe' ? a.pipe : null)
    if (this.last) this.program(this.last.state, this.last.audio)
    else this.setNote(null)
  }

  /** The program state or the sound settings changed. */
  program(state: ProgramState, audio: AudioSettings): void {
    this.last = { state, audio }
    const wanted = soundWanted(state)
    this.fanout.setWanted(wanted && this.route.mode === 'pipe')
    const live = nativeLive(state)
    const degraded =
      this.route.mode === 'fallback' ||
      this.route.mode === 'device' ||
      this.route.note !== null ||
      (this.route.mode === 'pipe' && !this.route.pipe)
    this.setNote(live && degraded ? DEFAULT_DEVICE_SOUND : null)
    if (this.route.mode !== 'fallback') return
    const v = fallbackVolume(state, audio)
    if (v === null || v === this.lastVolume) return
    this.lastVolume = v
    this.opts.setVolume(v).catch((e: unknown) => {
      console.warn(
        '[slideshow] PowerPoint level could not be set:',
        e instanceof Error ? e.message : e
      )
    })
  }

  dispose(): void {
    this.pipe.open(null)
  }

  private setNote(n: string | null): void {
    if (n === this.note) return
    this.note = n
    this.opts.onNote(n)
  }
}
