import { useState } from 'react'
import { CheckCircleIcon, CircleIcon } from '@phosphor-icons/react'
import {
  currentStep,
  loadGuideHidden,
  saveGuideHidden,
  tutorialSteps,
  type TutorialFacts
} from '../tutorial'

/**
 * First-run checklist on Home. Steps are ticked from the app's own state; only the first step
 * that is not done shows its hint. Done is an icon and a hidden word, never colour alone.
 */
export function GettingStarted({ facts }: { facts: TutorialFacts }): React.JSX.Element {
  const [hidden, setHidden] = useState(() => loadGuideHidden(localStorage))
  const hide = (next: boolean): void => {
    setHidden(next)
    saveGuideHidden(localStorage, next)
  }

  if (hidden) {
    return (
      <div className="guide-off" data-testid="guide-off">
        <button className="btn sm" onClick={() => hide(false)} data-testid="guide-show">
          Show the guide again
        </button>
      </div>
    )
  }

  const steps = tutorialSteps(facts)
  const next = currentStep(steps)
  const done = steps.filter((s) => s.done).length
  return (
    <section className="guide" aria-labelledby="guide-title" data-testid="guide">
      <div className="guide-head">
        <h2 id="guide-title">Getting started</h2>
        <span className="guide-count">
          {done} of {steps.length} done
        </span>
        <button className="btn sm" onClick={() => hide(true)} data-testid="guide-hide">
          Hide this guide
        </button>
      </div>
      <ol className="guide-steps">
        {steps.map((s) => (
          <li key={s.id} className="guide-step" data-done={s.done} data-testid="guide-step">
            <span className="guide-icon" aria-hidden="true">
              {s.done ? <CheckCircleIcon size={16} weight="fill" /> : <CircleIcon size={16} />}
            </span>
            <span className="visually-hidden">{s.done ? 'Done: ' : 'To do: '}</span>
            <div className="guide-body">
              <p className="guide-name">{s.title}</p>
              {next?.id === s.id && <p className="guide-hint">{s.hint}</p>}
            </div>
          </li>
        ))}
      </ol>
    </section>
  )
}
