import { CaretLeftIcon, CaretRightIcon, EyeSlashIcon, PauseIcon } from '@phosphor-icons/react'
import type { Action, ProgramState } from '../../../shared/program'

interface Props {
  state: ProgramState
  canPrev: boolean
  canNext: boolean
  onAction(a: Action): void
}

export function Controls({ state, canPrev, canNext, onAction }: Props): React.JSX.Element {
  const transitions = [
    { t: 'cut', label: 'Cut' },
    { t: 'fade', label: 'Fade' }
  ] as const
  return (
    <div className="controls">
      <button className="btn" disabled={!canPrev} onClick={() => onAction({ type: 'prev' })}>
        <CaretLeftIcon className="ph" size={18} />
        Prev <kbd>←</kbd>
      </button>
      <button
        className="btn primary"
        disabled={!canNext}
        onClick={() => onAction({ type: 'next' })}
      >
        Next <CaretRightIcon className="ph" size={18} />
        <kbd>Space</kbd>
      </button>
      <span className="grow" />
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
      <button
        className="btn toggle"
        aria-pressed={state.frozen}
        onClick={() => onAction({ type: 'toggleFreeze' })}
      >
        <PauseIcon className="ph" size={18} />
        Freeze <kbd>F</kbd>
      </button>
      <button
        className="btn toggle black"
        aria-pressed={state.black}
        onClick={() => onAction({ type: 'toggleBlack' })}
      >
        <EyeSlashIcon className="ph" size={18} />
        Black <kbd>B</kbd>
      </button>
    </div>
  )
}
