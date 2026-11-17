import type { Canvas } from './canvas'

/**
 * Which outputs an event wants on. Applied to this PC's output settings when the event becomes
 * the output's event (the air event); absent on an event = the outputs stay as they are.
 */
export interface EventOutputs {
  hdmi: boolean
  omt: boolean
  ndi: boolean
}

export const EVENT_OUTPUT_KEYS = ['hdmi', 'omt', 'ndi'] as const

/** What the New event dialog may set besides the name. */
export interface NewEventOptions {
  /** The event's own canvas; null or absent = the machine default. */
  canvas?: Canvas | null
  /** The event's outputs; null or absent = none saved. */
  outputs?: EventOutputs | null
}

/** Any value → valid EventOutputs, or null unless all three are true or false. */
export function sanitizeEventOutputs(raw: unknown): EventOutputs | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null
  const r = raw as Record<string, unknown>
  if (EVENT_OUTPUT_KEYS.some((k) => typeof r[k] !== 'boolean')) return null
  return { hdmi: r.hdmi as boolean, omt: r.omt as boolean, ndi: r.ndi as boolean }
}

/** The outputs an event wants that differ from what is on now; empty = nothing to change. */
export function outputChanges(wanted: EventOutputs, now: EventOutputs): Partial<EventOutputs> {
  const out: Partial<EventOutputs> = {}
  for (const k of EVENT_OUTPUT_KEYS) if (wanted[k] !== now[k]) out[k] = wanted[k]
  return out
}
