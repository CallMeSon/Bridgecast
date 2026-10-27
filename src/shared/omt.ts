/** OMT network output (video + sound over the LAN), configured in settings. */
export interface OmtSettings {
  enabled: boolean
  /** Source name receivers see (1–64 printable characters). */
  name: string
  fps: 30 | 60
}

/** Where the program sound goes: this PC, the OMT stream, or both. */
export type AudioRoute = 'local' | 'omt' | 'both'

export const DEFAULT_OMT: Readonly<OmtSettings> = Object.freeze({
  enabled: false,
  name: 'PPT Share',
  fps: 30
})

const MAX_NAME = 64
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u001f\u007f-\u009f]/g

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

/** Any parsed JSON → valid OmtSettings (bad fps → 30, empty name → default, control characters removed). */
export function sanitizeOmt(raw: unknown): OmtSettings {
  const o = isObject(raw) ? raw : {}
  const name =
    typeof o.name === 'string'
      ? o.name.replace(CONTROL_CHARS, '').trim().slice(0, MAX_NAME).trim()
      : ''
  return {
    enabled: typeof o.enabled === 'boolean' ? o.enabled : DEFAULT_OMT.enabled,
    name: name.length > 0 ? name : DEFAULT_OMT.name,
    fps: o.fps === 60 ? 60 : 30
  }
}

/** Live state of the OMT sender, shown in the UI. */
export interface OmtStatus {
  state: 'off' | 'starting' | 'running' | 'error'
  connections: number
  address: string | null
  message?: string
  warning?: 'drops' | 'no-receivers' | 'no-sound'
}

const RESTART_WINDOW_MS = 60_000
const MAX_FAILURES = 3

/** False when 3 failures happened within the last 60 s (stop restarting). */
export function restartAllowed(failures: number[], now: number): boolean {
  return failures.filter((t) => now - t < RESTART_WINDOW_MS && t <= now).length < MAX_FAILURES
}

const DROP_WINDOW_MS = 10_000
const DROP_RATIO = 0.1

/**
 * True at 60 fps when more than 10 % of frames were dropped over the last 10 s.
 * Samples hold per-interval counts of frames sent and dropped.
 */
export function dropWarning(
  samples: { sent: number; dropped: number; at: number }[],
  fps: 30 | 60,
  now: number
): boolean {
  if (fps !== 60) return false
  let sent = 0
  let dropped = 0
  for (const s of samples) {
    if (now - s.at > DROP_WINDOW_MS || s.at > now) continue
    sent += s.sent
    dropped += s.dropped
  }
  const total = sent + dropped
  return total > 0 && dropped / total > DROP_RATIO
}
