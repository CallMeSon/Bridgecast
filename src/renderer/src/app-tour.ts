// First-run tour: its steps, the done flag and when it opens. Pure: the store is passed in
// (localStorage in the app, a map in tests). Plan: docs/superpowers/plans/2026-11-06-app-tour.md.

import type { KeyValueStore } from './panel-sections'

export interface TourCard {
  kind: 'card'
  id: 'welcome' | 'why' | 'start'
  title: string
  body: string
  /** The primary button: moves on (the last card hands over to the spotlights). */
  action: string
}

export interface TourSpot {
  kind: 'spot'
  id: 'home' | 'console' | 'browser'
  /** CSS selector of the real control the ring sits on (testid). */
  target: string
  title: string
  body: string
  /** false when the target is a dialog: the ring then does not dim the page over it. */
  dim?: false
  /**
   * How the tour moves on. There is no Next button on a spotlight: 'click' waits for the
   * operator to click the highlighted control; 'gone' (the last step, whose target is a dialog)
   * finishes once the dialog has been on screen and is closed again.
   */
  advanceOn: 'click' | 'gone'
  /** While the target is not on screen, the ring sits on the control that opens it. */
  lead?: string
}

export type TourStep = TourCard | TourSpot

export const TOUR_STEPS: readonly TourStep[] = [
  {
    kind: 'card',
    id: 'welcome',
    title: 'Welcome to Bridgecast',
    body: 'Keep every deck of an event in one library and show the live slide fullscreen on a second display.',
    action: 'Next'
  },
  {
    kind: 'card',
    id: 'why',
    title: 'Built for running the show',
    body: 'Events hold the decks for one show. The audience always sees a slide, a held frame or the standby card, never the desktop. Live, Frozen, Black and KV are states, not extra colours.',
    action: 'Next'
  },
  {
    kind: 'card',
    id: 'start',
    title: 'Ready when you are',
    body: 'Create your first event, add a deck and take it on air.',
    action: 'Get started'
  },
  {
    kind: 'spot',
    id: 'home',
    target: '[data-testid=home-new]',
    title: 'Create your first event',
    body: 'An event holds the decks for one show.',
    advanceOn: 'click'
  },
  {
    kind: 'spot',
    id: 'console',
    target: '[data-testid=add-files]',
    title: 'Add your first deck',
    body: 'Slides, PDF, video or a web page.',
    advanceOn: 'click'
  },
  {
    kind: 'spot',
    id: 'browser',
    target: '[data-testid=add-web-dialog]',
    title: 'Bring in a web page',
    body: 'Add the address. The Prepare window opens next: sign in and pick the slide there.',
    dim: false,
    advanceOn: 'gone',
    lead: '[data-testid=add-web]'
  }
]

export const TOUR_KEY = 'app-tour'

/** Whether the tour has been finished or skipped on this machine. */
export function tourDone(store: KeyValueStore): boolean {
  try {
    return store.getItem(TOUR_KEY) === 'done'
  } catch {
    return false
  }
}

export function markTourDone(store: KeyValueStore): void {
  try {
    store.setItem(TOUR_KEY, 'done')
  } catch {
    // Storage can be unavailable; the tour then shows again next launch, which is harmless.
  }
}

/**
 * Opens on first run: no event yet and the tour not finished. An install that already has
 * events is not surprised by it (the caller marks it done). Off under the e2e flag.
 */
export function shouldOpenTour(opts: {
  done: boolean
  eventCount: number
  suppressed: boolean
}): boolean {
  return !opts.suppressed && !opts.done && opts.eventCount === 0
}

export function isLastStep(index: number): boolean {
  return index >= TOUR_STEPS.length - 1
}

export function nextStep(index: number): number {
  return Math.min(index + 1, TOUR_STEPS.length - 1)
}

export function previousStep(index: number): number {
  return Math.max(index - 1, 0)
}

/** Spotlight steps are numbered 1 to 3 among themselves ("1 / 3"). */
export function spotNumber(index: number): { n: number; total: number } | null {
  const spots = TOUR_STEPS.filter((s) => s.kind === 'spot')
  const step = TOUR_STEPS[index]
  if (step?.kind !== 'spot') return null
  return { n: spots.indexOf(step) + 1, total: spots.length }
}
