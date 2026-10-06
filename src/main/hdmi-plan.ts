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
import { pickDisplay, type DisplayInfo } from '../shared/displays'
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
  'Layar HDMI yang dipilih sekarang menjadi layar utama Windows, jadi output disembunyikan. Pilih layar lain untuk output HDMI.'

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

export function planHdmi(
  hdmi: HdmiSettings,
  displays: ScreenDisplay[],
  memo: TargetMemo | null,
  win: WindowView
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
  const { bounds } = target
  const preparing: HdmiStatus = { state: 'hidden', message: 'Menyiapkan output HDMI…' }
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
