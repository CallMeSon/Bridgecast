/**
 * Pure decisions for the HDMI output window (no Electron imports, unit tested).
 *
 * Every trigger — settings applied, `display-added`, `display-removed`,
 * `display-metrics-changed`, the window's renderer becoming ready — recomputes
 * one plan from the current displays and window state:
 *
 * - removed  → hide (the window stays alive and keeps rendering, but never
 *              moves to another screen, least of all the operator's)
 * - added    → show again on that display (matched by id, else label + size)
 * - metrics  → setBounds to the display's new bounds
 */
import { OPERATOR_DISPLAY, pickDisplay, type DisplayInfo } from '../shared/displays'
import type { HdmiSettings } from '../shared/settings'
import type { HdmiStatus } from '../shared/ipc'

export interface Bounds {
  x: number
  y: number
  width: number
  height: number
}

/** DisplayInfo plus its bounds in DIP screen coordinates (Electron `Display.bounds`). */
export interface ScreenDisplay extends DisplayInfo {
  bounds: Bounds
  /** setBounds rect covering it exactly (see placeRect); `bounds` when absent. */
  place?: Bounds
}

/** The display the output was last on, to recognise it when it comes back with a new id. */
export interface TargetMemo {
  id: number
  label: string
  width: number
  height: number
}

export interface WindowView {
  exists: boolean
  /** Its renderer sent `output:ready`: the first layer of the program is on screen. */
  ready: boolean
  visible: boolean
  bounds: Bounds | null
}

export type HdmiAction =
  | { type: 'none' }
  /** Build the window at `bounds`, hidden; a later plan shows it once ready. */
  | { type: 'create'; bounds: Bounds }
  /** Place at `bounds`, then show without taking focus. */
  | { type: 'show'; bounds: Bounds }
  | { type: 'setBounds'; bounds: Bounds }
  | { type: 'hide' }
  | { type: 'destroy' }

export interface HdmiPlan {
  action: HdmiAction
  status: HdmiStatus
  memo: TargetMemo | null
  /** Id of the display the output is on (differs from the saved id after a re-match); null if none. */
  targetId: number | null
}

export const PRIMARY_TARGET_MESSAGE =
  'The selected HDMI display is now the Windows main display, so the output is hidden. Choose another display for HDMI output.'

const sameBounds = (a: Bounds | null, b: Bounds): boolean =>
  !!a && a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height

function findTarget(
  displays: ScreenDisplay[],
  savedId: number | null,
  memo: TargetMemo | null
): ScreenDisplay | 'primary' | null {
  const byId = savedId === null ? undefined : displays.find((d) => d.id === savedId)
  if (byId?.primary) return 'primary'
  const picked = pickDisplay(displays, savedId) as ScreenDisplay | null
  if (picked) return picked
  if (!memo) return null
  // Windows can give a re-plugged screen a new id: same model and size is the same screen.
  return (
    displays.find(
      (d) =>
        !d.primary && d.label === memo.label && d.width === memo.width && d.height === memo.height
    ) ?? null
  )
}

/**
 * @param operatorId the display holding the operator window (null when
 *   unknown). The output never goes there, even when it is not the primary
 *   (primary swapped in Windows, or the operator window dragged across).
 */
export function planHdmi(
  hdmi: HdmiSettings,
  displays: ScreenDisplay[],
  memo: TargetMemo | null,
  win: WindowView,
  operatorId: number | null = null
): HdmiPlan {
  if (!hdmi.enabled) {
    return {
      action: win.exists ? { type: 'destroy' } : { type: 'none' },
      status: { state: 'off' },
      memo,
      targetId: null
    }
  }

  const target = findTarget(displays, hdmi.displayId, memo)
  if (target === null || target === 'primary') {
    return {
      action: win.exists && win.visible ? { type: 'hide' } : { type: 'none' },
      status:
        target === 'primary'
          ? { state: 'error', message: PRIMARY_TARGET_MESSAGE }
          : { state: 'hidden' },
      memo,
      targetId: null
    }
  }

  const next: TargetMemo = {
    id: target.id,
    label: target.label,
    width: target.width,
    height: target.height
  }
  if (target.id === operatorId) {
    // Remembered: shown again once the operator window moves away.
    return {
      action: win.exists && win.visible ? { type: 'hide' } : { type: 'none' },
      status: { state: 'error', message: OPERATOR_DISPLAY },
      memo: next,
      targetId: null
    }
  }
  const { bounds } = target
  const preparing: HdmiStatus = { state: 'hidden', message: 'Preparing HDMI output…' }
  let action: HdmiAction
  let status: HdmiStatus = { state: 'showing' }
  if (!win.exists) {
    action = { type: 'create', bounds }
    status = preparing
  } else if (!win.ready) {
    action = sameBounds(win.bounds, bounds) ? { type: 'none' } : { type: 'setBounds', bounds }
    status = preparing
  } else if (!win.visible) {
    action = { type: 'show', bounds }
  } else {
    action = sameBounds(win.bounds, bounds) ? { type: 'none' } : { type: 'setBounds', bounds }
  }
  return { action, status, memo: next, targetId: target.id }
}

/**
 * DIP length whose device-pixel size is exactly `native` px at scale `sf`.
 * Windows sizes a window as ceil(dip × sf): at 112 % a 1920 px display is
 * 1715 DIP wide, but a 1715 DIP window is 1921 px and spills 1 px onto the
 * neighbouring screen; 1714 DIP is exactly 1920 px. When no DIP length is
 * exact (possible above 200 %), the one just covering is used: never a gap.
 */
export function fitDip(native: number, sf: number): number {
  const s = Number.isFinite(sf) && sf > 0 ? sf : 1
  const px = (dip: number): number => Math.ceil(dip * s - 1e-6)
  const dip = Math.floor(native / s + 1e-6)
  return px(dip) === native ? dip : dip + 1
}

/** The setBounds rect that covers the display exactly (its origin, size fitted to its pixels). */
export function placeRect(d: ScreenDisplay, sf: number): Bounds {
  return { x: d.bounds.x, y: d.bounds.y, width: fitDip(d.width, sf), height: fitDip(d.height, sf) }
}
