import { CLICKER_KEYS, shouldRegisterClicker, type ClickerStatus } from '../shared/clicker'
import type { Action } from '../shared/program'

export interface ClickerDeps {
  /** Electron `globalShortcut.register`: false when another app keeps the key. */
  register(accelerator: string, cb: () => void): boolean
  unregister(accelerator: string): void
  /** The same path as the operator window's own Next/Prev (AppState.dispatch). */
  dispatch(action: Action): void
  enabled(): boolean
  operatorOpen(): boolean
  /** Any Bridgecast window has focus (it then handles the keys itself). */
  bridgecastFocused(): boolean
  wayland: boolean
  onChange(status: ClickerStatus): void
  warn(message: string): void
}

/**
 * Claims PageUp/PageDown and the arrows system-wide while Bridgecast is in the background, so a
 * presentation clicker works from another app. Call `sync()` whenever focus, windows or the
 * setting change; it registers or releases the keys. Never throws.
 */
export class GlobalClicker {
  private claimed = new Map<string, () => void>()
  private failed: string[] = []

  constructor(private d: ClickerDeps) {}

  status(): ClickerStatus {
    return {
      enabled: this.d.enabled(),
      active: this.claimed.size > 0,
      failed: [...this.failed],
      wayland: this.d.wayland
    }
  }

  sync(): void {
    const before = JSON.stringify(this.status())
    const want = shouldRegisterClicker({
      enabled: this.d.enabled(),
      operatorOpen: this.d.operatorOpen(),
      bridgecastFocused: this.d.bridgecastFocused()
    })
    if (want) this.claim()
    else this.release()
    if (JSON.stringify(this.status()) !== before) this.d.onChange(this.status())
  }

  /** App quit: release only our own keys. */
  dispose(): void {
    this.release()
  }

  /** e2e hook: runs the callback registered for an accelerator, as a key press would. */
  press(accelerator: string): boolean {
    const cb = this.claimed.get(accelerator)
    cb?.()
    return !!cb
  }

  private claim(): void {
    const failed: string[] = []
    for (const k of CLICKER_KEYS) {
      if (this.claimed.has(k.accelerator)) continue
      const cb = (): void => {
        try {
          this.d.dispatch(k.action)
        } catch (err) {
          this.d.warn(`[clicker] ${k.label} could not step the Program: ${String(err)}`)
        }
      }
      let ok = false
      try {
        ok = this.d.register(k.accelerator, cb)
      } catch (err) {
        this.d.warn(`[clicker] ${k.label} could not be registered: ${String(err)}`)
      }
      if (ok) this.claimed.set(k.accelerator, cb)
      else failed.push(k.label)
    }
    if (failed.length && failed.join() !== this.failed.join()) {
      this.d.warn(`[clicker] keys kept by another app or the system: ${failed.join(', ')}`)
    }
    this.failed = failed
  }

  private release(): void {
    for (const accelerator of this.claimed.keys()) {
      try {
        this.d.unregister(accelerator)
      } catch (err) {
        this.d.warn(`[clicker] ${accelerator} could not be released: ${String(err)}`)
      }
    }
    this.claimed.clear()
    this.failed = []
  }
}
