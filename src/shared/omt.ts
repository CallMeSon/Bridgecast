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
  name: 'Bridgecast',
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

/** NDI network output, configured in settings. */
export interface NdiSettings {
  enabled: boolean
  /** Source name receivers see (1–64 printable characters). */
  name: string
}

export const DEFAULT_NDI: Readonly<NdiSettings> = Object.freeze({
  enabled: false,
  name: 'Bridgecast'
})

/** Any parsed JSON → valid NdiSettings (empty name → default, control characters removed, 64 characters at most). */
export function sanitizeNdi(raw: unknown): NdiSettings {
  const o = isObject(raw) ? raw : {}
  const name =
    typeof o.name === 'string'
      ? o.name.replace(CONTROL_CHARS, '').trim().slice(0, MAX_NAME).trim()
      : ''
  return {
    enabled: typeof o.enabled === 'boolean' ? o.enabled : DEFAULT_NDI.enabled,
    name: name.length > 0 ? name : DEFAULT_NDI.name
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

/** Live state of a network sender; NDI uses the same shape (warning 'drops' never occurs for NDI). */
export type NetStatus = OmtStatus
export type NdiStatus = NetStatus

/** True when any network output is switched on. */
export function networkOn(s: { omt: OmtSettings; ndi: NdiSettings }): boolean {
  return s.omt.enabled || s.ndi.enabled
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

/**
 * Whether the operator window plays the Program sound. Automatic: no output window owns the
 * sound (HDMI not showing, no network sender running), so the operator is the one window that
 * plays it. Manual (`monitor`): it plays too, for headphones, even while an output does.
 * Route 'omt' with a sender running is on purpose silent here, so only Monitor plays it then.
 */
export function operatorPlays(
  hdmiShowing: boolean,
  networkRunning: boolean,
  monitor: boolean
): { local: boolean; auto: boolean } {
  const auto = !hdmiShowing && !networkRunning
  return { local: auto || monitor, auto }
}

import { CANVAS_CHANGE_LIVE, CANVAS_LIVE_NOTICE } from './canvas'

// UI copy, shared by the components and their tests.
// Error messages arrive in OmtStatus.message from main; this is the fallback.
export const OMT_START_FAILED =
  'OMT could not start. Close other apps that send OMT, then turn OMT off and on.'
export const OMT_DROPS = 'OMT is dropping frames. Set the frame rate to 30.'
export const OMT_NO_RECEIVERS =
  "No receiver yet. If vMix or OBS can't find Bridgecast, allow Bridgecast in Windows Firewall (Private networks) or add the address manually."
export const OMT_NO_SOUND = 'OMT sound is unavailable; sound plays on this PC only.'

export const NDI_COPY = {
  missing:
    'NDI could not start: the NDI Runtime is not installed. Install it from ndi.video, then turn NDI off and on.',
  tooOld:
    'NDI could not start: the installed NDI Runtime is too old. Install NDI 6 from ndi.video.',
  createFailed:
    'NDI could not start. The source name may already be in use, or the network is unavailable. Change the name or turn NDI off and on.',
  noReceivers: 'No receiver yet. In vMix or OBS, pick the NDI source shown above.',
  noSound: 'NDI sound is unavailable; sound plays on this PC only.'
} as const

export const NETWORK_CHANGE_NOTICE = 'Receivers will lose the network picture for about a second.'
export const NETWORK_CHANGE_CONFIRM = `${NETWORK_CHANGE_NOTICE} Change it now?`

/** True when either network target has a receiver connected. */
export function hasConnections(omt: NetStatus | null, ndi: NetStatus | null): boolean {
  return (omt?.connections ?? 0) > 0 || (ndi?.connections ?? 0) > 0
}

/** True when either network sender is running (sound can then play in the network window). */
export function networkRunning(omt: NetStatus | null, ndi: NetStatus | null): boolean {
  return omt?.state === 'running' || ndi?.state === 'running'
}

/** The one question for a canvas change, or null when nothing on air or on the network is affected. */
export function canvasChangeConfirm(onAir: boolean, receivers: boolean): string | null {
  if (onAir && receivers) return `${CANVAS_LIVE_NOTICE} ${NETWORK_CHANGE_NOTICE} Change it now?`
  if (onAir) return CANVAS_CHANGE_LIVE
  return receivers ? NETWORK_CHANGE_CONFIRM : null
}

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

/** Header NDI status: same rules as omtBadge. */
export function ndiBadge(s: NdiStatus | null): OmtBadge {
  if (!s || s.state === 'off') return { text: 'NDI off', tone: 'off' }
  if (s.state === 'error') return { text: 'NDI error', tone: 'error' }
  if (s.state === 'running' && s.connections > 0) {
    return {
      text: `NDI · ${s.connections} receiver${s.connections === 1 ? '' : 's'}`,
      tone: 'ok'
    }
  }
  if (s.state === 'starting') return { text: 'NDI starting…', tone: 'neutral' }
  return { text: 'NDI · no receivers', tone: 'neutral' }
}

/**
 * The short header word for a network output when the header is tight: `OMT off`, `OMT 0`
 * (on, no receivers), `OMT 2` (receivers), `OMT …` (starting). An error keeps only the name;
 * its warning icon says the rest. State is never colour alone.
 */
export function netShortText(name: 'OMT' | 'NDI', s: NetStatus | null): string {
  if (!s || s.state === 'off') return `${name} off`
  if (s.state === 'error') return name
  if (s.state === 'starting') return `${name} …`
  return `${name} ${s.connections}`
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
