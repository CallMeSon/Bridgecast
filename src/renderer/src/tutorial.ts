// Getting started checklist on Home. Pure: every step is read from facts the app already has.

export type StepId = 'event' | 'files' | 'hdmi' | 'air'

export interface TutorialFacts {
  /** At least one event exists. */
  hasEvent: boolean
  /** Some event has at least one deck. */
  hasDecks: boolean
  /** Settings hdmi.enabled; null while the settings are still being read. */
  hdmiEnabled: boolean | null
  /** A slide is on Program (a Key visual or a black screen does not count). */
  slideOnProgram: boolean
}

export interface TutorialStep {
  id: StepId
  title: string
  hint: string
  done: boolean
}

export function tutorialSteps(f: TutorialFacts): TutorialStep[] {
  return [
    {
      id: 'event',
      title: 'Create an event',
      hint: 'Choose New event above. An event holds the decks for one show.',
      done: f.hasEvent
    },
    {
      id: 'files',
      title: 'Add your files',
      hint: 'Open the event, then choose Import slides for PowerPoint, PDF or video, or Add web page.',
      done: f.hasDecks
    },
    {
      id: 'hdmi',
      title: 'Connect the HDMI display',
      hint: 'Plug in the projector or LED screen, then turn on HDMI output from the output status in the header.',
      done: f.hdmiEnabled === true
    },
    {
      id: 'air',
      title: 'Take a slide on air',
      hint: 'Open the event, pick a deck, then press Space or Next to put a slide on Program.',
      done: f.slideOnProgram
    }
  ]
}

/** The first step that is not done yet (the only one that shows its hint), or null when all are done. */
export function currentStep(steps: TutorialStep[]): TutorialStep | null {
  return steps.find((s) => !s.done) ?? null
}

export type GuideMode = 'full' | 'compact' | 'off'

/**
 * How much of the guide Home shows. With no events it is always the full checklist (a first run is
 * never left without it, hidden or not). Otherwise it shrinks to one row, and goes away once the
 * user hid it or every step is done.
 */
export function guideMode(steps: TutorialStep[], hidden: boolean, eventCount: number): GuideMode {
  if (eventCount === 0) return 'full'
  if (hidden || currentStep(steps) === null) return 'off'
  return 'compact'
}

export const GUIDE_KEY = 'home-guide'

/** Whether the user hid the guide. Missing or unreadable storage means shown. */
export function loadGuideHidden(storage: Pick<Storage, 'getItem'> | null): boolean {
  try {
    return storage?.getItem(GUIDE_KEY) === 'hidden'
  } catch {
    return false
  }
}

export function saveGuideHidden(storage: Pick<Storage, 'setItem'> | null, hidden: boolean): void {
  try {
    storage?.setItem(GUIDE_KEY, hidden ? 'hidden' : 'shown')
  } catch {
    // Private mode or blocked storage: the choice just is not kept.
  }
}
