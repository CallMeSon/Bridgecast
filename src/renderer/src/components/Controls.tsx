import { CaretLeftIcon, EyeSlashIcon, PauseIcon } from '@phosphor-icons/react'
import type { Action, ProgramState } from '../../../shared/program'

interface Props {
  state: ProgramState
  canPrev: boolean
  canNext: boolean
  onAction(a: Action): void
}

/** The control deck under Program: Prev/Next, transition, then the two holds. */
export function Controls({ state, canPrev, canNext, onAction }: Props): React.JSX.Element {
  const transitions = [
    { t: 'cut', label: 'Cut' },
    { t: 'fade', label: 'Fade' }
  ] as const
  return (
    <div className="controls">
      <div>
        <button className="cbtn" disabled={!canPrev} onClick={() => onAction({ type: 'prev' })}>
          <CaretLeftIcon size={16} />
          Prev <kbd className="opt">←</kbd>
        </button>
        <button
          className="cbtn next"
          disabled={!canNext}
          onClick={() => onAction({ type: 'next' })}
        >
          Next
          <span className="keys">
            <kbd>Space</kbd>
            <kbd>→</kbd>
          </span>
        </button>
      </div>
      <div className="trans">
        <span className="cl">Transisi</span>
        <div className="seg" role="radiogroup" aria-label="Transisi">
          {transitions.map((x) => (
            <button
              key={x.t}
              role="radio"
              aria-checked={state.transition === x.t}
              onClick={() => onAction({ type: 'setTransition', transition: x.t })}
            >
              {x.label}
            </button>
          ))}
        </div>
      </div>
      <div />
      <div>
        <button
          className="cbtn hold"
          aria-pressed={state.frozen}
          onClick={() => onAction({ type: 'toggleFreeze' })}
        >
          <PauseIcon size={16} />
          Freeze <kbd className="opt">F</kbd>
        </button>
      </div>
      <div>
        <button
          className="cbtn hold"
          aria-pressed={state.black}
          onClick={() => onAction({ type: 'toggleBlack' })}
        >
          <EyeSlashIcon size={16} />
          Black <kbd className="opt">B</kbd>
        </button>
      </div>
    </div>
  )
}
