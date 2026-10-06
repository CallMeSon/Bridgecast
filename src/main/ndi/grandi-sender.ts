import * as fs from 'fs'
import { delimiter } from 'path'
import type { NdiStatus } from '../../shared/ipc'
import type { NdiFormat, NdiSender } from './sender'

/*
 * NdiSender on top of `grandi` (N-API bindings for the NDI 6 SDK, prebuilt
 * for win32-x64, with Processing.NDI.Lib.x64.dll shipped beside the addon).
 * See docs/superpowers/notes/ndi-spike.md for why and for the send details.
 *
 * - grandi's sender.video() runs the *synchronous* NDIlib_send_send_video_v2
 *   on a libuv worker thread and holds a reference to the Buffer until it
 *   resolves. So the main thread never blocks on NDI, and we keep at most one
 *   send in flight: frames arriving meanwhile are dropped (counted), never
 *   queued, and a buffer is never handed to NDI twice at the same time.
 * - Frames are passed without copying. They come from the offscreen window's
 *   paint (a fresh Buffer per paint) and the FrameRepeater re-sends the same
 *   Buffer; nobody mutates a frame after creating it.
 * - clockVideo is off: the FrameRepeater already paces frames at fps; NDI
 *   clocking on top would double-pace and stall the single in-flight slot.
 * - Timecode is left out, so grandi passes NDIlib_send_timecode_synthesize.
 */

/** The subset of grandi this module uses (lets tests inject a fake). */
export interface NativeVideoFrame {
  xres: number
  yres: number
  frameRateN: number
  frameRateD: number
  pictureAspectRatio: number
  fourCC: number
  frameFormatType: number
  lineStrideBytes: number
  data: Buffer
}
export interface NativeSender {
  video(frame: NativeVideoFrame): Promise<void>
  sourceName(): string
  connections(): number
  destroy(): boolean
}
export interface GrandiLike {
  send(o: { name: string; clockVideo: boolean; clockAudio: boolean }): Promise<NativeSender>
  FourCC: { BGRX: number }
  FrameType: { Progressive: number }
}

export const NDI_RUNTIME_MISSING =
  'Runtime NDI tidak ditemukan. Pasang NDI Tools dari ndi.video lalu mulai ulang aplikasi.'
export const NDI_CPU_UNSUPPORTED =
  'Prosesor komputer ini tidak didukung NDI. Jalankan PPT Share di komputer lain.'
export const NDI_NAME_IN_USE = (name: string): string =>
  `Nama source "${name}" sudah dipakai di komputer ini (mungkin PPT Share lain masih terbuka). ` +
  'Tutup aplikasi itu atau ganti nama source, lalu klik Terapkan.'

/** NDI_send_create can fail briefly while a destroyed source finishes its last send. */
const CREATE_ATTEMPTS = 5
const CREATE_RETRY_MS = 200

class NdiError extends Error {}

/** Installed NDI runtime folders (NDI Tools sets these), newest first. */
export function runtimeDirs(env: Record<string, string | undefined>): string[] {
  return ['NDI_RUNTIME_DIR_V6', 'NDI_RUNTIME_DIR_V5', 'NDILIB_REDIST_FOLDER']
    .map((k) => env[k])
    .filter((v): v is string => !!v)
}

let loading: Promise<GrandiLike> | null = null

/**
 * Loads grandi once. The DLL next to the addon is found first; if it is
 * missing (broken install), an installed NDI runtime (NDI Tools) on the
 * environment's folders is the fallback, so "install NDI Tools" really fixes it.
 */
export function loadGrandi(): Promise<GrandiLike> {
  loading ??= (async () => {
    const extra = runtimeDirs(process.env).filter((d) => fs.existsSync(d))
    if (extra.length) process.env['PATH'] = [process.env['PATH'] ?? '', ...extra].join(delimiter)
    let g: typeof import('grandi').default
    try {
      g = (await import('grandi')).default
    } catch (err) {
      console.error('[ndi] grandi gagal dimuat:', err)
      throw new NdiError(NDI_RUNTIME_MISSING)
    }
    if (!g.isSupportedCPU()) throw new NdiError(NDI_CPU_UNSUPPORTED)
    if (!g.initialize()) throw new NdiError(NDI_RUNTIME_MISSING)
    console.log(`[ndi] ${g.version()}`)
    return g as unknown as GrandiLike
  })()
  return loading
}

export interface NdiStats {
  sent: number
  /** Frames skipped because a send was in flight, or of the wrong size. */
  dropped: number
  failed: number
  sendMsTotal: number
  sendMsMax: number
  source: string | null
  connections(): number
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

export class GrandiNdiSender implements NdiSender {
  private fmt: NdiFormat | null = null
  private native: NativeSender | null = null
  private nativeName: string | null = null
  private g: GrandiLike | null = null
  private busy = false
  /** Bumped by every start/stop; stale async creations check it and back out. */
  private gen = 0
  private warned = false
  readonly stats: NdiStats = {
    sent: 0,
    dropped: 0,
    failed: 0,
    sendMsTotal: 0,
    sendMsMax: 0,
    source: null,
    connections: () => this.native?.connections() ?? 0
  }

  constructor(
    private onStatus: (s: NdiStatus) => void = () => {},
    private load: () => Promise<GrandiLike> = loadGrandi
  ) {}

  start(o: NdiFormat): void {
    this.fmt = { ...o }
    if (this.native && this.nativeName === o.name) {
      // Same source, new format: NDI receivers follow format changes, so the
      // source stays up (no gap in vMix/Resolume).
      this.gen++
      this.onStatus({ state: 'running', source: this.native.sourceName() })
      return
    }
    if (this.native) {
      // The old source disappears now; green again only once the new one exists.
      this.destroyNative()
      this.onStatus({ state: 'stopped' })
    }
    const gen = ++this.gen
    void this.create(gen, o.name)
  }

  sendBgra(frame: Buffer): void {
    const native = this.native
    const f = this.fmt
    if (!native || !f || !this.g) return
    if (this.busy || frame.length !== f.width * f.height * 4) {
      this.stats.dropped++
      return
    }
    this.busy = true
    const t0 = performance.now()
    native
      .video({
        xres: f.width,
        yres: f.height,
        frameRateN: f.fps,
        frameRateD: 1,
        pictureAspectRatio: f.width / f.height,
        // Chromium paints opaque pixels: BGRX tells NDI to ignore alpha (no
        // alpha plane to encode, and receivers do not treat it as a key).
        fourCC: this.g.FourCC.BGRX,
        frameFormatType: this.g.FrameType.Progressive,
        lineStrideBytes: f.width * 4,
        data: frame
      })
      .then(
        () => {
          const ms = performance.now() - t0
          this.stats.sent++
          this.stats.sendMsTotal += ms
          this.stats.sendMsMax = Math.max(this.stats.sendMsMax, ms)
        },
        (err) => {
          this.stats.failed++
          if (!this.warned) {
            this.warned = true
            console.warn('[ndi] frame gagal dikirim:', err)
          }
        }
      )
      .finally(() => {
        if (this.native === native) this.busy = false
      })
  }

  stop(): void {
    this.gen++
    this.fmt = null
    this.destroyNative()
    this.onStatus({ state: 'stopped' })
  }

  private async create(gen: number, name: string): Promise<void> {
    try {
      const g = await this.load()
      for (let attempt = 1; ; attempt++) {
        if (gen !== this.gen) return
        try {
          const native = await g.send({ name, clockVideo: false, clockAudio: false })
          if (gen !== this.gen) {
            native.destroy()
            return
          }
          this.g = g
          this.native = native
          this.nativeName = name
          this.busy = false
          this.stats.source = native.sourceName()
          this.onStatus({ state: 'running', source: this.stats.source })
          return
        } catch (err) {
          if (attempt >= CREATE_ATTEMPTS) {
            console.error('[ndi] source gagal dibuat:', err)
            throw new NdiError(NDI_NAME_IN_USE(name))
          }
          await sleep(CREATE_RETRY_MS)
        }
      }
    } catch (err) {
      if (gen !== this.gen) return
      const message = err instanceof NdiError ? err.message : NDI_RUNTIME_MISSING
      this.onStatus({ state: 'error', message })
    }
  }

  private destroyNative(): void {
    // grandi defers NDIlib_send_destroy until an in-flight send has finished.
    this.native?.destroy()
    this.native = null
    this.nativeName = null
    this.stats.source = null
    this.busy = false
  }
}
