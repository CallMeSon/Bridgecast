import type { Action } from './program'

/**
 * Presentation clicker while Bridgecast is in the background: these keys are claimed globally
 * (Electron accelerators) and do what the same keys do in the operator window.
 */
export const CLICKER_KEYS: readonly { accelerator: string; label: string; action: Action }[] = [
  { accelerator: 'PageDown', label: 'PageDown', action: { type: 'next' } },
  { accelerator: 'Right', label: 'Right arrow', action: { type: 'next' } },
  { accelerator: 'PageUp', label: 'PageUp', action: { type: 'prev' } },
  { accelerator: 'Left', label: 'Left arrow', action: { type: 'prev' } }
]

/** Settings > Clicker works when Bridgecast is in the background. On by default. */
export const DEFAULT_GLOBAL_CLICKER = true

export function sanitizeGlobalClicker(raw: unknown): boolean {
  return typeof raw === 'boolean' ? raw : DEFAULT_GLOBAL_CLICKER
}

/**
 * The keys are claimed only while the setting is on, the operator window exists and no Bridgecast
 * window has focus (a focused window handles the keys itself, so a step never happens twice).
 */
export function shouldRegisterClicker(i: {
  enabled: boolean
  operatorOpen: boolean
  bridgecastFocused: boolean
}): boolean {
  return i.enabled && i.operatorOpen && !i.bridgecastFocused
}

export interface ClickerStatus {
  enabled: boolean
  /** The keys are claimed right now (Bridgecast is in the background). */
  active: boolean
  /** Labels of the keys another app (or the system) kept; empty when all were claimed. */
  failed: string[]
  /** Linux Wayland: the system may refuse global keys. */
  wayland: boolean
}

/** The note under the switch: which keys another app kept, or why global keys may not work. */
export function clickerNote(s: ClickerStatus): string | null {
  if (!s.enabled) return null
  if (s.failed.length > 0) {
    const keys = s.failed.join(', ')
    return s.wayland
      ? `${keys} could not be claimed. This Linux session (Wayland) may not allow keys outside Bridgecast. The clicker still works while Bridgecast is focused.`
      : `${keys} could not be claimed: another app is using ${s.failed.length === 1 ? 'it' : 'them'}. The clicker still works while Bridgecast is focused.`
  }
  return null
}
