import type { HdmiSettings } from './settings'

/** A connected screen, as main reports it to the renderer (`displays:list`). */
export interface DisplayInfo {
  /** Electron `Display.id`. */
  id: number
  label: string
  /** Native resolution in device pixels. */
  width: number
  height: number
  /** The Windows main display: the operator's screen, never used for HDMI output. */
  primary: boolean
}

/** Shown when HDMI cannot be enabled because Windows reports a single screen. */
export const NO_SECOND_DISPLAY =
  'Layar kedua tidak terdeteksi. Sambungkan HDMI lalu atur Windows ke mode Extend (Win+P → Extend).'

/**
 * The display for HDMI output: the saved one if it is connected and not the
 * primary; with nothing saved, the first non-primary display; otherwise null.
 * A saved display that is missing gives null, never another display, so the
 * output can never jump to the wrong projector.
 */
export function pickDisplay(displays: DisplayInfo[], savedId: number | null): DisplayInfo | null {
  if (savedId === null) return displays.find((d) => !d.primary) ?? null
  const saved = displays.find((d) => d.id === savedId)
  return saved && !saved.primary ? saved : null
}

/** The fields of Electron's `Display` that DisplayInfo is built from. */
export interface DisplayLike {
  id: number
  label: string
  size: { width: number; height: number }
  scaleFactor: number
}

/**
 * Pixel length of a display side from its DIP length. Windows rounds the DIP
 * size up (1920 px at 112 % → 1715 DIP), so the pixels lie in
 * ((dip − 1) × sf, dip × sf]; when two lengths fit, the even one is the
 * real resolution (1098 DIP at 175 % is 1920, not 1921).
 */
export function nativeLength(dip: number, scaleFactor: number): number {
  const sf = Number.isFinite(scaleFactor) && scaleFactor > 0 ? scaleFactor : 1
  const max = Math.floor(dip * sf + 1e-6)
  const min = Math.floor((dip - 1) * sf + 1e-6) + 1
  for (let px = max; px >= min; px--) if (px % 2 === 0) return px
  return max
}

export function toDisplayInfo(d: DisplayLike, primaryId: number, index: number): DisplayInfo {
  const sf = Number.isFinite(d.scaleFactor) && d.scaleFactor > 0 ? d.scaleFactor : 1
  return {
    id: d.id,
    label: d.label?.trim() || `Layar ${index + 1}`,
    width: nativeLength(d.size.width, sf),
    height: nativeLength(d.size.height, sf),
    primary: d.id === primaryId
  }
}

/** "EPSON PJ · 1920×1080", the primary marked as the operator's screen. */
export function displayText(d: DisplayInfo): string {
  const text = `${d.label} · ${d.width}×${d.height}`
  return d.primary ? `${text} — Layar utama (operator)` : text
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

/**
 * Indonesian error (with the fix) for HDMI settings coming from the renderer,
 * checked against the displays that are connected right now; null when valid.
 * `savedId` (the current setting) may be missing so HDMI can be turned off
 * while its display is unplugged.
 */
export function hdmiSettingsError(
  v: unknown,
  displays: DisplayInfo[],
  savedId: number | null
): string | null {
  if (
    !isObject(v) ||
    typeof v.enabled !== 'boolean' ||
    !(v.displayId === null || Number.isSafeInteger(v.displayId))
  ) {
    return 'Pengaturan HDMI tidak valid. Tutup panel output lalu buka lagi.'
  }
  const id = v.displayId as number | null
  if (id !== null) {
    const d = displays.find((x) => x.id === id)
    if (d?.primary) {
      return 'Layar utama (operator) tidak bisa dipakai untuk output HDMI. Pilih layar kedua.'
    }
    if (!d && (v.enabled || id !== savedId)) {
      return 'Layar yang dipilih tidak tersambung. Sambungkan layarnya lagi, atau pilih layar lain.'
    }
  }
  if (v.enabled && !displays.some((d) => !d.primary)) return NO_SECOND_DISPLAY
  return null
}

/** Valid settings → what is saved: "enabled, no display chosen" gets the first non-primary one. */
export function resolveHdmi(h: HdmiSettings, displays: DisplayInfo[]): HdmiSettings {
  if (!h.enabled || h.displayId !== null) return { ...h }
  return { enabled: true, displayId: pickDisplay(displays, null)?.id ?? null }
}
