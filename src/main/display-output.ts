import { BrowserWindow, screen } from 'electron'
import { join } from 'path'
import { is } from '@electron-toolkit/utils'
import { toDisplayInfo, type DisplayInfo } from '../shared/displays'
import { Send, type HdmiStatus } from '../shared/ipc'
import type { HdmiSettings } from '../shared/settings'
import {
  placeRect,
  planHdmi,
  type Bounds,
  type HdmiPlan,
  type ScreenDisplay,
  type TargetMemo
} from './hdmi-plan'

const RESTART_DELAY_MS = 1000

/** Connected displays with their DIP bounds and exact-cover rect, primary marked. */
export function screenDisplays(): ScreenDisplay[] {
  const primaryId = screen.getPrimaryDisplay().id
  return screen.getAllDisplays().map((d, i) => {
    const info = { ...toDisplayInfo(d, primaryId, i), bounds: { ...d.bounds } }
    return { ...info, place: placeRect(info, d.scaleFactor) }
  })
}

/** Displays for the renderer; the one holding the operator window is marked. */
export const displayInfos = (
  ds: ScreenDisplay[],
  operatorId: number | null = null
): DisplayInfo[] =>
  ds.map(({ id, label, width, height, primary }) => ({
    id,
    label,
    width,
    height,
    primary,
    ...(id === operatorId ? { operator: true } : {})
  }))

/** Operator window moves/resizes are coalesced before HDMI is re-planned. */
const OPERATOR_MOVE_DEBOUNCE_MS = 150

/** Read by the dev/e2e debug hook (globalThis.__pptHdmi, only with PPT_OUTPUT_DUMP). */
export interface HdmiDebug {
  status: HdmiStatus
  exists: boolean
  ready: boolean
  visible: boolean
  focusable: boolean
  bounds: Bounds | null
  creates: number
  plans: string[]
  /** Displays as HDMI sees them (with the exact-cover rect). */
  displays: ScreenDisplay[]
  /** The display holding the operator window (never used for HDMI). */
  operatorId: number | null
}

/**
 * The HDMI output: one visible, frameless window covering the chosen second
 * display and rendering the same `#/output` route as the NDI output (it
 * receives the same `program:state` broadcasts). It never feeds NDI.
 *
 * - Built when HDMI is enabled, destroyed when disabled or on app quit.
 * - Shown only after its renderer sent `output:ready` (first layer on screen),
 *   so it never flashes white or black when it appears.
 * - Never takes focus (focusable: false, showInactive): the operator window
 *   keeps the keyboard and its shortcuts. Not in the taskbar; cannot be closed
 *   by the user (it cannot be focused for Alt+F4, and `close` is refused).
 * - Follows `screen` events through planHdmi (see hdmi-plan.ts): unplugged →
 *   hidden (never moved onto another screen), re-plugged → shown again,
 *   resolution/scale change → bounds re-applied.
 * - Never on the display holding the operator window (it can differ from the
 *   primary after a primary swap, or when the operator window is dragged
 *   across): hidden there with an error, re-planned when that window moves.
 */
export class HdmiOutput {
  private win: BrowserWindow | null = null
  private ready = false
  private memo: TargetMemo | null = null
  private status: HdmiStatus = { state: 'off' }
  private started = false
  private quitting = false
  private restartTimer: ReturnType<typeof setTimeout> | null = null
  private creates = 0
  private plans: string[] = []
  private operatorWin: BrowserWindow | null = null
  private operatorTimer: ReturnType<typeof setTimeout> | null = null
  private lastOperatorId: number | null = null

  /**
   * @param onRetarget called when the output display was re-matched under a
   *   new id (Windows renumbered a re-plugged screen) so the id is saved.
   */
  constructor(
    private hdmi: HdmiSettings,
    private onStatus: (s: HdmiStatus) => void,
    private onDisplays: (d: DisplayInfo[]) => void,
    private onRetarget: (displayId: number) => void,
    private getDisplays: () => ScreenDisplay[] = screenDisplays
  ) {}

  start(): void {
    if (this.started || this.quitting) return
    this.started = true
    screen.on('display-added', this.onScreen)
    screen.on('display-removed', this.onScreen)
    screen.on('display-metrics-changed', this.onScreen)
    this.reconcile()
  }

  apply(next: HdmiSettings): void {
    this.hdmi = { ...next }
    if (this.started) this.reconcile()
  }

  displays(): DisplayInfo[] {
    return displayInfos(this.getDisplays(), this.operatorDisplayId())
  }

  /** The display holding the operator window, or null when there is none. */
  operatorDisplayId(): number | null {
    const w = this.operatorWin
    if (!w || w.isDestroyed()) return null
    return screen.getDisplayMatching(w.getBounds()).id
  }

  /**
   * Follows the operator window: when it moves to another display (dragged,
   * maximized there, snapped), the display list is re-sent and HDMI re-planned
   * so the output never covers it.
   */
  watchOperator(win: BrowserWindow): void {
    this.operatorWin = win
    this.lastOperatorId = this.operatorDisplayId()
    const changed = (): void => {
      if (this.operatorTimer) clearTimeout(this.operatorTimer)
      this.operatorTimer = setTimeout(() => {
        this.operatorTimer = null
        if (this.quitting || this.operatorWin !== win || win.isDestroyed()) return
        const id = this.operatorDisplayId()
        if (id === this.lastOperatorId) return
        this.onScreen()
      }, OPERATOR_MOVE_DEBOUNCE_MS)
    }
    win.on('move', changed)
    win.on('resize', changed)
    win.on('closed', () => {
      if (this.operatorWin === win) this.operatorWin = null
    })
    if (this.started) this.onScreen()
  }

  getStatus(): HdmiStatus {
    return this.status
  }

  /** A display was added, removed or changed (also used by the e2e fake displays). */
  readonly onScreen = (): void => {
    if (this.quitting) return
    this.lastOperatorId = this.operatorDisplayId()
    this.onDisplays(this.displays())
    this.reconcile()
  }

  get debug(): HdmiDebug {
    const w = this.win && !this.win.isDestroyed() ? this.win : null
    return {
      status: this.status,
      exists: !!w,
      ready: this.ready,
      visible: !!w?.isVisible(),
      focusable: !!w?.isFocusable(),
      bounds: w ? w.getBounds() : null,
      creates: this.creates,
      plans: [...this.plans],
      displays: this.getDisplays(),
      operatorId: this.operatorDisplayId()
    }
  }

  shutdown(): void {
    this.quitting = true
    screen.removeListener('display-added', this.onScreen)
    screen.removeListener('display-removed', this.onScreen)
    screen.removeListener('display-metrics-changed', this.onScreen)
    if (this.restartTimer) clearTimeout(this.restartTimer)
    this.restartTimer = null
    if (this.operatorTimer) clearTimeout(this.operatorTimer)
    this.operatorTimer = null
    this.destroyWindow()
  }

  private reconcile(): void {
    if (this.quitting) return
    const w = this.win && !this.win.isDestroyed() ? this.win : null
    const plan = planHdmi(
      this.hdmi,
      this.getDisplays(),
      this.memo,
      {
        exists: !!w,
        ready: this.ready,
        visible: !!w?.isVisible(),
        bounds: w ? w.getBounds() : null
      },
      this.operatorDisplayId()
    )
    this.memo = plan.memo
    this.run(plan, w)
    this.setStatus(plan.status)
    if (plan.targetId !== null && plan.targetId !== this.hdmi.displayId) {
      this.hdmi = { ...this.hdmi, displayId: plan.targetId }
      this.onRetarget(plan.targetId)
    }
  }

  private run(plan: HdmiPlan, w: BrowserWindow | null): void {
    const a = plan.action
    if (a.type !== 'none') {
      this.plans.push(a.type)
      if (this.plans.length > 50) this.plans.shift()
    }
    switch (a.type) {
      case 'create':
        this.create(this.placeFor(a.bounds))
        return
      case 'show':
        if (!w) return
        place(w, this.placeFor(a.bounds))
        // Above the taskbar of that display; it is the only thing on it.
        w.setAlwaysOnTop(true, 'screen-saver')
        w.showInactive()
        // Windows may rescale on the first show on a display with other DPI.
        place(w, this.placeFor(a.bounds))
        return
      case 'setBounds':
        if (w) place(w, this.placeFor(a.bounds))
        return
      case 'hide':
        w?.hide()
        return
      case 'destroy':
        this.destroyWindow()
        return
      case 'none':
        return
    }
  }

  /** The exact-cover rect of the display with these bounds (see placeRect). */
  private placeFor(bounds: Bounds): Bounds {
    const d = this.getDisplays().find((x) => sameRect(x.bounds, bounds))
    return d?.place ?? bounds
  }

  private setStatus(s: HdmiStatus): void {
    if (s.state === this.status.state && s.message === this.status.message) return
    this.status = s
    if (s.state === 'error') console.error(`[hdmi] ${s.message}`)
    this.onStatus(s)
  }

  private create(bounds: Bounds): void {
    this.creates++
    this.ready = false
    const win = new BrowserWindow({
      show: false,
      ...bounds,
      frame: false,
      thickFrame: false,
      roundedCorners: false,
      hasShadow: false,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      enableLargerThanScreen: true,
      skipTaskbar: true,
      focusable: false,
      backgroundColor: '#000000',
      title: 'PPT Share HDMI',
      paintWhenInitiallyHidden: true,
      webPreferences: {
        preload: join(__dirname, '../preload/index.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
        // Keeps rendering while hidden (display unplugged), so it is current when shown again.
        backgroundThrottling: false,
        spellcheck: false
      }
    })
    this.win = win
    place(win, bounds)
    const wc = win.webContents
    // Only this window's own renderer can make it ready (webContents.ipc).
    wc.ipc.on(Send.outputReady, () => {
      if (this.win !== win || win.isDestroyed()) return
      this.ready = true
      this.reconcile()
    })
    win.on('close', (e) => {
      if (!this.quitting) e.preventDefault()
    })
    // Keep "PPT Share HDMI" (the page's <title> would rename it "PPT Share").
    win.on('page-title-updated', (e) => e.preventDefault())
    wc.on('render-process-gone', (_e, details) => {
      console.error(`[hdmi] renderer berhenti (${details.reason}); dibuat ulang`)
      this.scheduleRestart(win)
    })
    // Output only: no keyboard/mouse input, no navigation, no popups.
    wc.on('before-input-event', (e) => e.preventDefault())
    wc.on('will-navigate', (e) => e.preventDefault())
    wc.setWindowOpenHandler(() => ({ action: 'deny' }))

    if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
      win.loadURL(`${process.env['ELECTRON_RENDERER_URL']}#/output`)
    } else {
      win.loadFile(join(__dirname, '../renderer/index.html'), { hash: '/output' })
    }
  }

  private scheduleRestart(dead: BrowserWindow): void {
    if (this.quitting || this.restartTimer) return
    // Hide the dead window at once (it would show a frozen or sad page).
    if (!dead.isDestroyed()) dead.hide()
    this.restartTimer = setTimeout(() => {
      this.restartTimer = null
      if (this.win === dead) this.destroyWindow()
      this.reconcile()
    }, RESTART_DELAY_MS)
  }

  private destroyWindow(): void {
    const w = this.win
    this.win = null
    this.ready = false
    if (w && !w.isDestroyed()) w.destroy()
  }
}

const sameRect = (a: Bounds, b: Bounds): boolean =>
  a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height

/**
 * Sets the window to `b` (a placeRect). With different scaling on the laptop
 * panel and the HDMI display, Windows can scale the size while it moves the
 * window between them, so the bounds are set again once it is on the target.
 */
function place(w: BrowserWindow, b: Bounds): void {
  w.setBounds(b)
  w.setBounds(b)
}
