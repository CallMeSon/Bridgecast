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

/**
 * What one output window does with its sound. Exactly one window plays locally:
 * the HDMI window while it shows, otherwise the OMT window while a network sender runs.
 * `networkRunning` covers any network protocol; route 'omt' means "network".
 */
export function audioPlan(
  role: 'hdmi' | 'omt',
  hdmiShowing: boolean,
  networkRunning: boolean,
  route: AudioRoute
): { local: boolean; tap: boolean } {
  const owner = role === 'hdmi' ? hdmiShowing : !hdmiShowing && networkRunning
  return { local: owner && route !== 'omt', tap: role === 'omt' && route !== 'local' }
}

// UI copy, shared by the components and their tests.
// Error messages arrive in OmtStatus.message from main; this is the fallback.
export const OMT_START_FAILED =
  'OMT could not start. Close other apps that send OMT, then turn OMT off and on.'
export const OMT_DROPS = 'OMT is dropping frames. Set the frame rate to 30.'
export const OMT_NO_RECEIVERS =
  "No receiver yet. If vMix or OBS can't find PPT Share, allow PPT Share in Windows Firewall (Private networks) or add the address manually."
export const OMT_NO_SOUND = 'OMT sound is unavailable; sound plays on this PC only.'
export const OMT_RECEIVERS_CONFIRM =
  'Receivers will lose the OMT picture for about a second. Change it now?'

export interface OmtBadge {
  text: string
  /** ok = receivers connected, neutral = on but nobody connected, off = gray, error = problem. */
  tone: 'off' | 'neutral' | 'ok' | 'error'
}

/** Header OMT status: text always carries the state (the tone is only a second cue). */
export function omtBadge(s: OmtStatus | null): OmtBadge {
  if (!s || s.state === 'off') return { text: 'OMT off', tone: 'off' }
  if (s.state === 'error') return { text: 'OMT error', tone: 'error' }
  if (s.state === 'running' && s.connections > 0) {
    return {
      text: `OMT · ${s.connections} receiver${s.connections === 1 ? '' : 's'}`,
      tone: 'ok'
    }
  }
  if (s.state === 'starting') return { text: 'OMT starting…', tone: 'neutral' }
  return { text: 'OMT · no receivers', tone: 'neutral' }
}

export const NO_RECEIVERS_AFTER_MS = 15_000

/**
 * True once a running sender has had no receiver for 15 s. `since` is when the
 * current spell of "running with 0 connections" began (null when not in one).
 */
export function noReceiversHint(
  state: OmtStatus['state'],
  connections: number,
  since: number | null,
  now: number
): boolean {
  return (
    state === 'running' &&
    connections === 0 &&
    since !== null &&
    now - since >= NO_RECEIVERS_AFTER_MS
  )
}
