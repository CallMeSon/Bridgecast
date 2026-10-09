/**
 * Program fullscreen on a second display (HDMI, Windows "Extend"). `displayId`
 * is Electron's `Display.id` of the chosen screen; null = not chosen yet.
 */
export interface HdmiSettings {
  enabled: boolean
  displayId: number | null
}

/**
 * Sound of video slides, played by the HDMI output window only. `deviceId` is a
 * `MediaDeviceInfo.deviceId` of an audio output; null = the Windows default.
 */
export interface AudioSettings {
  deviceId: string | null
  muted: boolean
}

export interface Settings {
  hdmi: HdmiSettings
  /** Next/Prev may leave the live deck (see ProgramState.autoAdvance). Default off. */
  autoAdvance: boolean
  audio: AudioSettings
}

export const DEFAULT_HDMI: Readonly<HdmiSettings> = Object.freeze({
  enabled: false,
  displayId: null
})

export const DEFAULT_AUDIO: Readonly<AudioSettings> = Object.freeze({
  deviceId: null,
  muted: false
})

/** Longest device id kept (real ids are about 64 characters). */
const MAX_DEVICE_ID = 512

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

/** Any parsed JSON → valid AudioSettings (an empty or over-long deviceId becomes null). */
export function sanitizeAudio(raw: unknown): AudioSettings {
  const a = isObject(raw) ? raw : {}
  return {
    deviceId:
      typeof a.deviceId === 'string' && a.deviceId.length > 0 && a.deviceId.length <= MAX_DEVICE_ID
        ? a.deviceId
        : DEFAULT_AUDIO.deviceId,
    muted: typeof a.muted === 'boolean' ? a.muted : DEFAULT_AUDIO.muted
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
    autoAdvance: typeof r.autoAdvance === 'boolean' ? r.autoAdvance : false,
    audio: sanitizeAudio(r.audio)
  }
}
