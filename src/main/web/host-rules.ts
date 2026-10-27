import { pathToFileURL } from 'url'
import { DECK_NAME_MAX } from '../../shared/types'
import { webDomain, type WebCaptureWarning } from '../../shared/web'

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
  outputsActive: { hdmi: boolean; omt: boolean }
): WebCaptureWarning[] {
  let next = [...list]
  if (output) {
    if (failed) next = [...next.filter((w) => w.output !== output), { output, deckId }]
    else next = next.filter((w) => !(w.output === output && w.deckId === deckId))
  }
  return next.filter((w) => outputsActive[w.output])
}
