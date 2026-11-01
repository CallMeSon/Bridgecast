import { pathToFileURL } from 'url'
import { DECK_NAME_MAX } from '../../shared/types'
import {
  webDomain,
  type CaptureKind,
  type WebCaptureWarning,
  type WebNavState
} from '../../shared/web'

/** Pure decisions of WebHost, kept apart so they can be unit tested without Electron. */

type DeckLike = { id: string; source: string; web?: { url: string } }

/**
 * Which pages to open and close for the active event. Every web deck of `decks`
 * gets a page; a page whose deck is no longer listed closes, except the one on
 * air (`shownDeckId`): switching events never changes the output, so it closes
 * only once it has left air.
 */
export function syncPlan(
  openIds: Iterable<string>,
  decks: DeckLike[],
  shownDeckId: string | null
): { open: { deckId: string; url: string }[]; close: string[] } {
  const open = new Set(openIds)
  const wanted = decks.filter((d) => d.source === 'web' && typeof d.web?.url === 'string')
  const keep = new Set(wanted.map((d) => d.id))
  return {
    open: wanted.filter((d) => !open.has(d.id)).map((d) => ({ deckId: d.id, url: d.web!.url })),
    close: [...open].filter((id) => !keep.has(id) && id !== shownDeckId)
  }
}

/** Default name of a new web deck: the page title, else the domain. */
export function webDeckName(title: string, url: string): string {
  const clean = title
    .replace(/[\p{Cc}\p{Cf}]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (!clean) return webDomain(url)
  return [...clean].slice(0, DECK_NAME_MAX).join('').trim()
}

/** A `--disable-features` value with `feature` added once to what is already there. */
export function mergeDisableFeatures(existing: string, feature: string): string {
  const list = existing
    .split(',')
    .map((f) => f.trim())
    .filter((f) => f !== '')
  if (!list.includes(feature)) list.push(feature)
  return list.join(',')
}

/**
 * True for the app's own renderer page (operator, HDMI, OMT, Prepare): the built
 * `index.html` (`file`), or in dev the dev server origin. Web pages never match.
 */
export function isAppPageUrl(url: string, app: { file: string; dev?: string }): boolean {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return false
  }
  if (app.dev) {
    try {
      if (parsed.origin === new URL(app.dev).origin && parsed.protocol.startsWith('http')) {
        return true
      }
    } catch {
      // A bad dev URL never matches.
    }
  }
  if (parsed.protocol !== 'file:') return false
  return parsed.pathname === pathToFileURL(app.file).pathname
}

/** Chromium's ERR_ABORTED: a load replaced by another navigation, not a failure. */
const ERR_ABORTED = -3

/** A `did-fail-load` that means the page failed (main frame, not an aborted load). */
export function failLoadIsError(errorCode: number, isMainFrame: boolean): boolean {
  return isMainFrame && errorCode !== ERR_ABORTED
}

/** Which app window a web IPC call comes from. */
export type AppWindowRole = 'hdmi' | 'omt' | 'operator' | 'prepare'

/**
 * Ready gate and capture-ended reports: they count only from a window that puts
 * the page on air, i.e. the active HDMI or OMT output, or the operator preview
 * when no output is active. A Prepare preview never counts.
 */
export function frameSenderAllowed(
  role: AppWindowRole,
  outputsActive: { hdmi: boolean; omt: boolean }
): boolean {
  switch (role) {
    case 'hdmi':
      return outputsActive.hdmi
    case 'omt':
      return outputsActive.omt
    case 'operator':
      return !outputsActive.hdmi && !outputsActive.omt
    default:
      return false
  }
}

/**
 * Capture warnings after an output's report (`output` null = only re-check):
 * at most one per output (its live page), cleared when that page works again,
 * and dropped for an output that is no longer active (its picture is not on air).
 */
export function updateCaptureWarnings(
  list: readonly WebCaptureWarning[],
  output: 'hdmi' | 'omt' | null,
  deckId: string,
  failed: boolean,
  outputsActive: { hdmi: boolean; omt: boolean },
  kind: CaptureKind = 'web'
): WebCaptureWarning[] {
  let next = [...list]
  if (output) {
    if (failed) {
      const w: WebCaptureWarning = kind === 'slides' ? { output, deckId, kind } : { output, deckId }
      next = [...next.filter((x) => x.output !== output), w]
    } else next = next.filter((w) => !(w.output === output && w.deckId === deckId))
  }
  return next.filter((w) => outputsActive[w.output])
}

/**
 * Reload, Back, Forward or a new URL for a web page: hold the output first (HOLD,
 * so no frame of the page's next document reaches the audience before the ready
 * gate) when the page is on air, not frozen and not held yet. Otherwise navigate.
 */
export function holdBeforeNavigate(s: { live: boolean; frozen: boolean; held: boolean }): boolean {
  return s.live && !s.frozen && !s.held
}

/** The windows whose pause a HOLD before navigating waits for: active outputs, else the operator. */
export function heldAckRoles(outputsActive: { hdmi: boolean; omt: boolean }): AppWindowRole[] {
  return (['hdmi', 'omt', 'operator'] as const).filter((r) => frameSenderAllowed(r, outputsActive))
}

/**
 * Waits until the given windows report that they paused a deck's stream
 * (`web:held`), or until a timeout (a window that shows no stream never answers).
 */
export class HeldAcks {
  private waits: { deckId: string; left: Set<AppWindowRole>; done(): void }[] = []

  wait(deckId: string, roles: AppWindowRole[], timeoutMs: number): Promise<'paused' | 'timeout'> {
    return new Promise((resolve) => {
      if (roles.length === 0) {
        resolve('paused')
        return
      }
      const entry = {
        deckId,
        left: new Set(roles),
        done: () => {
          clearTimeout(timer)
          this.waits = this.waits.filter((w) => w !== entry)
          resolve('paused')
        }
      }
      const timer = setTimeout(() => {
        this.waits = this.waits.filter((w) => w !== entry)
        resolve('timeout')
      }, timeoutMs)
      this.waits.push(entry)
    })
  }

  ack(deckId: string, role: AppWindowRole): void {
    for (const w of [...this.waits]) {
      if (w.deckId !== deckId) continue
      w.left.delete(role)
      if (w.left.size === 0) w.done()
    }
  }
}

/** Operator warning when a page window could not get the canvas size (clamped to the screen). */
export function pageSizeWarning(
  actual: number[],
  canvas: { width: number; height: number }
): string | undefined {
  const [w, h] = actual
  if (w === canvas.width && h === canvas.height) return undefined
  return `The web page is ${w}x${h} on this PC, not the canvas size ${canvas.width}x${canvas.height}. The output shows it stretched. Use a smaller canvas, or check the display settings.`
}

/**
 * Coalesces `web:navState` sends per deck: a change of `loading` goes at once (with the
 * newest fields); anything else (cursor, title) at most once per `ms`, newest state wins.
 * The clock is injected so the timing is testable.
 */
export class NavCoalescer {
  private last = new Map<string, WebNavState>()
  private pending = new Map<string, { s: WebNavState; handle: unknown }>()

  constructor(
    private send: (s: WebNavState) => void,
    private schedule: (fn: () => void, ms: number) => unknown,
    private cancel: (h: unknown) => void,
    private ms = 50
  ) {}

  push(s: WebNavState): void {
    const prev = this.last.get(s.deckId)
    const pend = this.pending.get(s.deckId)
    if (!prev || prev.loading !== s.loading) {
      this.emit(s)
      return
    }
    if (pend) {
      pend.s = s
      return
    }
    if (JSON.stringify(prev) === JSON.stringify(s)) return
    const entry = { s, handle: undefined as unknown }
    entry.handle = this.schedule(() => this.flush(s.deckId), this.ms)
    this.pending.set(s.deckId, entry)
  }

  /** Sends the pending state of a deck now. */
  flush(deckId: string): void {
    const pend = this.pending.get(deckId)
    if (!pend) return
    this.emit(pend.s)
  }

  drop(deckId: string): void {
    const pend = this.pending.get(deckId)
    if (pend) this.cancel(pend.handle)
    this.pending.delete(deckId)
    this.last.delete(deckId)
  }

  private emit(s: WebNavState): void {
    const pend = this.pending.get(s.deckId)
    if (pend) this.cancel(pend.handle)
    this.pending.delete(s.deckId)
    this.last.set(s.deckId, s)
    this.send(s)
  }
}
