import { useState } from 'react'
import { CheckCircleIcon, CircleIcon } from '@phosphor-icons/react'
import { currentStep, type GuideMode, type TutorialStep } from '../tutorial'

/**
 * Getting started on Home. Steps are ticked from the app's own state; only the first step that is
 * not done shows its hint. Done is an icon and a hidden word, never colour alone. `full` is the
 * whole checklist (no events yet); `compact` is one row that can expand for this view only.
 */
export function GettingStarted({
  steps,
  mode,
  onHide
}: {
  steps: TutorialStep[]
  mode: Exclude<GuideMode, 'off'>
  onHide: () => void
}): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const next = currentStep(steps)
  const done = steps.filter((s) => s.done).length
  const compact = mode === 'compact'

  return (
    <section
      className={compact ? 'guide compact' : 'guide'}
      aria-labelledby="guide-title"
      data-testid="guide"
    >
      <div className="guide-head">
        <h2 id="guide-title">Getting started</h2>
        <span className="guide-count">
          {done} of {steps.length} done
        </span>
        {compact && next && <span className="guide-next">Next: {next.title}</span>}
        {compact && (
          <>
            <button
              className="btn sm"
              aria-expanded={open}
              onClick={() => setOpen((o) => !o)}
              data-testid="guide-steps-toggle"
            >
              {open ? 'Hide steps' : 'Show steps'}
            </button>
            <button className="btn sm" onClick={onHide} data-testid="guide-hide">
              Hide
            </button>
          </>
        )}
      </div>
      {(!compact || open) && (
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
      )}
    </section>
  )
}
