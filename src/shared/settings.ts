/**
 * Program fullscreen on a second display (HDMI, Windows "Extend"). `displayId`
 * is Electron's `Display.id` of the chosen screen; null = not chosen yet.
 */
export interface HdmiSettings {
  enabled: boolean
  displayId: number | null
}

export interface Settings {
  hdmi: HdmiSettings
  /** Next/Prev may leave the live deck (see ProgramState.autoAdvance). Default off. */
  autoAdvance: boolean
}

export const DEFAULT_HDMI: Readonly<HdmiSettings> = Object.freeze({
  enabled: false,
  displayId: null
})

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

/** Any parsed JSON → valid HdmiSettings (a non-integer displayId becomes null). */
export function sanitizeHdmi(raw: unknown): HdmiSettings {
  const h = isObject(raw) ? raw : {}
  return {
    enabled: typeof h.enabled === 'boolean' ? h.enabled : DEFAULT_HDMI.enabled,
    displayId: Number.isSafeInteger(h.displayId) ? (h.displayId as number) : null
  }
}

/**
 * Any parsed JSON → valid Settings; each invalid field falls back to its
 * default. Unknown keys (e.g. `ndi` from older versions) are dropped.
 */
export function sanitizeSettings(raw: unknown): Settings {
  const r = isObject(raw) ? raw : {}
  return {
    hdmi: sanitizeHdmi(r.hdmi),
    autoAdvance: typeof r.autoAdvance === 'boolean' ? r.autoAdvance : false
  }
}
