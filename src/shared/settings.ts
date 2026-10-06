/** NDI output settings, shared by main (store, sender) and renderer (popover). */
export interface NdiSettings {
  enabled: boolean
  name: string
  width: number
  height: number
  fps: number
}

/**
 * Program fullscreen on a second display (HDMI, Windows "Extend"). `displayId`
 * is Electron's `Display.id` of the chosen screen; null = not chosen yet.
 */
export interface HdmiSettings {
  enabled: boolean
  displayId: number | null
}

export interface Settings {
  ndi: NdiSettings
  hdmi: HdmiSettings
}

export const DEFAULT_NDI: Readonly<NdiSettings> = Object.freeze({
  enabled: true,
  name: 'PPT Share',
  width: 1920,
  height: 1080,
  fps: 30
})

export const DEFAULT_HDMI: Readonly<HdmiSettings> = Object.freeze({
  enabled: false,
  displayId: null
})

/** The only output sizes offered (spec): Full HD and UHD. */
export const RESOLUTIONS = [
  { width: 1920, height: 1080 },
  { width: 3840, height: 2160 }
] as const

export const FPS_OPTIONS = [30, 60] as const

/** Longest source name accepted (NDI adds "HOST (…)" around it). */
export const NAME_MAX = 63

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

const isResolution = (w: unknown, h: unknown): boolean =>
  RESOLUTIONS.some((r) => r.width === w && r.height === h)

const isFps = (v: unknown): v is number => (FPS_OPTIONS as readonly unknown[]).includes(v)

function cleanName(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const name = v.trim()
  return name && name.length <= NAME_MAX ? name : null
}

/**
 * Indonesian error (with the fix) for invalid NDI settings coming from the UI,
 * or null when they are valid.
 */
export function ndiSettingsError(v: unknown): string | null {
  if (!isObject(v) || typeof v.enabled !== 'boolean') {
    return 'Pengaturan NDI tidak valid. Tutup panel NDI lalu buka lagi.'
  }
  if (typeof v.name !== 'string' || !v.name.trim()) {
    return 'Nama source tidak boleh kosong. Isi nama, misalnya "PPT Share".'
  }
  if (v.name.trim().length > NAME_MAX) {
    return `Nama source terlalu panjang. Pakai paling banyak ${NAME_MAX} karakter.`
  }
  if (!isResolution(v.width, v.height)) {
    return 'Resolusi tidak didukung. Pilih 1920×1080 atau 3840×2160.'
  }
  if (!isFps(v.fps)) return 'Frame rate tidak didukung. Pilih 30 atau 60 fps.'
  return null
}

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
 * default. Files from before HDMI output (no `hdmi`) get the HDMI defaults.
 */
export function sanitizeSettings(raw: unknown): Settings {
  const n = isObject(raw) && isObject(raw.ndi) ? raw.ndi : {}
  const res = isResolution(n.width, n.height)
    ? { width: n.width as number, height: n.height as number }
    : { width: DEFAULT_NDI.width, height: DEFAULT_NDI.height }
  return {
    ndi: {
      enabled: typeof n.enabled === 'boolean' ? n.enabled : DEFAULT_NDI.enabled,
      name: cleanName(n.name) ?? DEFAULT_NDI.name,
      ...res,
      fps: isFps(n.fps) ? n.fps : DEFAULT_NDI.fps
    },
    hdmi: sanitizeHdmi(isObject(raw) ? raw.hdmi : null)
  }
}
