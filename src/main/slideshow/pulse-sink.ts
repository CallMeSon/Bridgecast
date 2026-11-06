import { execFile } from 'node:child_process'

/** The private sink LibreOffice plays into, and the capturable source made from its monitor. */
export const SINK_NAME = 'pptshare_lo'
export const SOURCE_NAME = 'pptshare_lo_input'

/** Runs `pactl` (a fake in tests). Rejects with the `ENOENT` error when pactl is missing. */
type PactlExec = (args: string[]) => Promise<string>

const defaultExec: PactlExec = (args) =>
  new Promise((resolve, reject) => {
    execFile('pactl', args, { timeout: 8000 }, (err, stdout) => {
      if (err) reject(err)
      else resolve(String(stdout))
    })
  })

/** Names (second column) of `pactl list short sinks|sources`. */
export function parseSinks(pactlListShort: string): string[] {
  return pactlListShort
    .split(/\r?\n/)
    .map((l) => l.split('\t')[1]?.trim() ?? '')
    .filter(Boolean)
}

/**
 * LibreOffice's sound: a private PulseAudio/PipeWire null sink (`pptshare_lo`) that `soffice`
 * plays into (`PULSE_SINK`), so nothing reaches the speakers. Chromium does not list monitor
 * sources as inputs, so a remap source (`pptshare_lo_input`) on the monitor is what the output
 * window captures (see the spike notes). A sink or source left by a crashed run is reused and
 * never unloaded by us; only the modules this instance loaded are unloaded, by id.
 */
export class PulseSink {
  private loaded: string[] = []

  constructor(private readonly pactl: PactlExec = defaultExec) {}

  /** True when sink and capture source exist; false (nothing left loaded) when pactl is missing or fails. */
  async ensure(): Promise<boolean> {
    try {
      const sinks = parseSinks(await this.pactl(['list', 'short', 'sinks']))
      if (!sinks.includes(SINK_NAME)) {
        this.loaded.push(
          await this.load([
            'module-null-sink',
            `sink_name=${SINK_NAME}`,
            `sink_properties=device.description=${SINK_NAME}`
          ])
        )
      }
      const sources = parseSinks(await this.pactl(['list', 'short', 'sources']))
      if (!sources.includes(SOURCE_NAME)) {
        this.loaded.push(
          await this.load([
            'module-remap-source',
            `master=${SINK_NAME}.monitor`,
            `source_name=${SOURCE_NAME}`,
            `source_properties=device.description=${SOURCE_NAME}`
          ])
        )
      }
      return true
    } catch (e) {
      console.warn(
        '[slideshow] LibreOffice sound sink not available:',
        e instanceof Error ? e.message : e
      )
      await this.remove()
      return false
    }
  }

  private async load(args: string[]): Promise<string> {
    const id = (await this.pactl(['load-module', ...args])).trim()
    if (!/^\d+$/.test(id)) throw new Error(`pactl load-module returned "${id}"`)
    return id
  }

  /** Unloads only what this instance loaded (the source first, it sits on the sink). */
  async remove(): Promise<void> {
    const ids = [...this.loaded].reverse()
    this.loaded = []
    for (const id of ids) {
      try {
        await this.pactl(['unload-module', id])
      } catch (e) {
        console.warn(
          '[slideshow] sound sink module not unloaded:',
          e instanceof Error ? e.message : e
        )
      }
    }
  }
}
