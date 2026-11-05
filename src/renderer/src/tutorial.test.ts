import { describe, expect, it } from 'vitest'
import {
  currentStep,
  guideMode,
  GUIDE_KEY,
  loadGuideHidden,
  saveGuideHidden,
  tutorialSteps,
  type TutorialFacts,
  type TutorialStep
} from './tutorial'

const none: TutorialFacts = {
  hasEvent: false,
  hasDecks: false,
  hdmiEnabled: false,
  slideOnProgram: false
}

describe('tutorialSteps', () => {
  it('lists the four steps in order with their titles', () => {
    expect(tutorialSteps(none).map((s) => [s.id, s.title])).toEqual([
      ['event', 'Create an event'],
      ['files', 'Add your files'],
      ['hdmi', 'Connect the HDMI display'],
      ['air', 'Take a slide on air']
    ])
  })

  it('marks each step done from its own fact', () => {
    const steps = tutorialSteps({
      hasEvent: true,
      hasDecks: false,
      hdmiEnabled: true,
      slideOnProgram: false
    })
    expect(steps.map((s) => s.done)).toEqual([true, false, true, false])
  })

  it('treats HDMI as not connected while the settings are unread (null)', () => {
    const steps = tutorialSteps({ ...none, hdmiEnabled: null })
    expect(steps.find((s) => s.id === 'hdmi')?.done).toBe(false)
  })

  it('has a hint for every step', () => {
    for (const s of tutorialSteps(none)) expect(s.hint.length).toBeGreaterThan(10)
  })
})

describe('currentStep', () => {
  it('is the first step that is not done', () => {
    const steps = tutorialSteps({
      hasEvent: true,
      hasDecks: false,
      hdmiEnabled: true,
      slideOnProgram: true
    })
    expect(currentStep(steps)?.id).toBe('files')
  })

  it('is the first step when nothing is done', () => {
    expect(currentStep(tutorialSteps(none))?.id).toBe('event')
  })

  it('does not skip back to an earlier open step once a later one is done', () => {
    const steps = tutorialSteps({ ...none, slideOnProgram: true })
    expect(currentStep(steps)?.id).toBe('event')
  })

  it('is null when every step is done', () => {
    const steps = tutorialSteps({
      hasEvent: true,
      hasDecks: true,
      hdmiEnabled: true,
      slideOnProgram: true
    })
    expect(currentStep(steps)).toBeNull()
  })
})

function memory(initial: Record<string, string> = {}): Storage {
  const m = new Map(Object.entries(initial))
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
    clear: () => m.clear(),
    key: () => null,
    get length() {
      return m.size
    }
  } as Storage
}

describe('guide visibility storage', () => {
  it('shows the guide when nothing is saved', () => {
    expect(loadGuideHidden(memory())).toBe(false)
  })

  it('remembers a hidden guide across loads', () => {
    const s = memory()
    saveGuideHidden(s, true)
    expect(s.getItem(GUIDE_KEY)).toBe('hidden')
    expect(loadGuideHidden(s)).toBe(true)
    saveGuideHidden(s, false)
    expect(loadGuideHidden(s)).toBe(false)
  })

  it('falls back to shown when storage is missing or throws', () => {
    const broken = {
      getItem: () => {
        throw new Error('blocked')
      },
      setItem: () => {
        throw new Error('blocked')
      }
    }
    expect(loadGuideHidden(null)).toBe(false)
    expect(loadGuideHidden(broken)).toBe(false)
    expect(() => saveGuideHidden(broken, true)).not.toThrow()
    expect(() => saveGuideHidden(null, true)).not.toThrow()
  })
})

describe('guideMode', () => {
  const steps = (done: number): TutorialStep[] =>
    tutorialSteps(none).map((s, i) => ({ ...s, done: i < done }))
  it('no events: full, even if hidden', () => expect(guideMode(steps(0), true, 0)).toBe('full'))
  it('some events, not finished: compact', () =>
    expect(guideMode(steps(2), false, 3)).toBe('compact'))
  it('hidden stays off', () => expect(guideMode(steps(2), true, 3)).toBe('off'))
  it('all done: off', () => expect(guideMode(steps(4), false, 3)).toBe('off'))
})
