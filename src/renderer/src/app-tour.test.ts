import { describe, expect, it } from 'vitest'
import {
  TOUR_KEY,
  TOUR_STEPS,
  isLastStep,
  markTourDone,
  nextStep,
  previousStep,
  shouldOpenTour,
  spotNumber,
  tourDone
} from './app-tour'
import type { KeyValueStore } from './panel-sections'

function memory(
  initial: Record<string, string> = {}
): KeyValueStore & { data: Record<string, string> } {
  const data = { ...initial }
  return {
    data,
    getItem: (k) => (k in data ? data[k] : null),
    setItem: (k, v) => {
      data[k] = v
    }
  }
}

describe('tour done flag', () => {
  it('is not done until marked, and survives a store that throws', () => {
    expect(tourDone(memory())).toBe(false)
    const s = memory()
    markTourDone(s)
    expect(s.data[TOUR_KEY]).toBe('done')
    expect(tourDone(s)).toBe(true)
    const bad: KeyValueStore = {
      getItem: () => {
        throw new Error('blocked')
      },
      setItem: () => {
        throw new Error('blocked')
      }
    }
    expect(tourDone(bad)).toBe(false)
    expect(() => markTourDone(bad)).not.toThrow()
  })
})

describe('when the tour opens', () => {
  it('opens on first run only: no events, not done, not suppressed', () => {
    expect(shouldOpenTour({ done: false, eventCount: 0, suppressed: false })).toBe(true)
    expect(shouldOpenTour({ done: true, eventCount: 0, suppressed: false })).toBe(false)
    expect(shouldOpenTour({ done: false, eventCount: 2, suppressed: false })).toBe(false)
    expect(shouldOpenTour({ done: false, eventCount: 0, suppressed: true })).toBe(false)
  })
})

describe('steps', () => {
  it('runs three cards, then three spotlights, in order', () => {
    expect(TOUR_STEPS.map((s) => `${s.kind}:${s.id}`)).toEqual([
      'card:welcome',
      'card:why',
      'card:start',
      'spot:home',
      'spot:console',
      'spot:browser'
    ])
  })
  it('moves forward and back, clamped at both ends', () => {
    expect(nextStep(0)).toBe(1)
    expect(nextStep(TOUR_STEPS.length - 1)).toBe(TOUR_STEPS.length - 1)
    expect(previousStep(0)).toBe(0)
    expect(previousStep(3)).toBe(2)
    expect(isLastStep(TOUR_STEPS.length - 1)).toBe(true)
    expect(isLastStep(0)).toBe(false)
  })
  it('has no Next on a spotlight: two wait for a click, the dialog step for the dialog to close', () => {
    const spots = TOUR_STEPS.filter((s) => s.kind === 'spot')
    expect(spots.map((s) => (s.kind === 'spot' ? s.advanceOn : null))).toEqual([
      'click',
      'click',
      'gone'
    ])
    const last = spots[spots.length - 1]
    // Until the dialog opens, the ring sits on the button that opens it.
    expect(last.kind === 'spot' && last.lead).toBe('[data-testid=add-web]')
  })
  it('numbers the spotlights 1 to 3 and gives no number to cards', () => {
    expect(spotNumber(0)).toBeNull()
    expect(spotNumber(3)).toEqual({ n: 1, total: 3 })
    expect(spotNumber(5)).toEqual({ n: 3, total: 3 })
  })
})
