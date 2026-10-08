import type { HdmiSettings } from './settings'

/** A connected screen, as main reports it to the renderer (`displays:list`). */
export interface DisplayInfo {
  /** Electron `Display.id`. */
  id: number
  label: string
  /** Native resolution in device pixels. */
  width: number
  height: number
  /** The Windows main display: never used for HDMI output. */
  primary: boolean
  /**
   * Holds the operator window (it may differ from the primary after a primary
   * swap, or when the operator window was dragged): never used for HDMI output.
   */
  operator?: boolean
}

/** Shown when HDMI cannot be enabled because Windows reports a single screen. */
export const NO_SECOND_DISPLAY =
  'Layar kedua tidak terdeteksi. Sambungkan HDMI lalu atur Windows ke mode Extend (Win+P → Extend).'

/** Shown when the chosen display holds the operator window. */
export const OPERATOR_DISPLAY =
  'Layar ini dipakai jendela operator. Pindahkan jendela operator ke layar lain atau pilih layar HDMI yang lain.'

/** May carry the HDMI output: neither the primary nor the operator window's display. */
export const isHdmiCandidate = (d: DisplayInfo, operatorId: number | null): boolean =>
  !d.primary && d.id !== operatorId

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

/** "EPSON PJ · 1920×1080"; the primary and the operator window's display are marked. */
export function displayText(d: DisplayInfo): string {
  const text = `${d.label} · ${d.width}×${d.height}`
  if (d.primary) return `${text} (layar utama, operator)`
  return d.operator ? `${text} (layar operator)` : text
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

/**
 * Indonesian error (with the fix) for HDMI settings coming from the renderer,
 * checked against the displays connected right now and the display holding
 * the operator window (`operatorId`); null when valid. Turning HDMI off is
 * always accepted (whatever became of its display), so the operator can
 * never be stuck with an output that will not switch off.
 */
export function hdmiSettingsError(
  v: unknown,
  displays: DisplayInfo[],
  operatorId: number | null
): string | null {
  if (
    !isObject(v) ||
    typeof v.enabled !== 'boolean' ||
    !(v.displayId === null || Number.isSafeInteger(v.displayId))
  ) {
    return 'Pengaturan HDMI tidak valid. Tutup panel output lalu buka lagi.'
  }
  if (!v.enabled) return null
  const id = v.displayId as number | null
  if (id !== null) {
    const d = displays.find((x) => x.id === id)
    if (d?.primary) {
      return 'Layar utama (operator) tidak bisa dipakai untuk output HDMI. Pilih layar kedua.'
    }
    if (!d) {
      return 'Layar yang dipilih tidak tersambung. Sambungkan layarnya lagi, atau pilih layar lain.'
    }
    return id === operatorId ? OPERATOR_DISPLAY : null
  }
  if (!displays.some((d) => !d.primary)) return NO_SECOND_DISPLAY
  if (!displays.some((d) => isHdmiCandidate(d, operatorId))) return OPERATOR_DISPLAY
  return null
}

/**
 * Valid settings → what is saved: "enabled, no display chosen" gets the first
 * display that is neither primary nor the operator window's.
 */
export function resolveHdmi(
  h: HdmiSettings,
  displays: DisplayInfo[],
  operatorId: number | null = null
): HdmiSettings {
  if (!h.enabled || h.displayId !== null) return { ...h }
  const d = displays.find((x) => isHdmiCandidate(x, operatorId))
  return { enabled: true, displayId: d?.id ?? null }
}
