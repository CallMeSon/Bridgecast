import { useRef } from 'react'
import { CaretLeftIcon, EyeSlashIcon, ImageIcon, PauseIcon } from '@phosphor-icons/react'
import { kvOnAir, type Action, type ProgramState } from '../../../shared/program'

interface Props {
  state: ProgramState
  canPrev: boolean
  canNext: boolean
  /** Freezing needs a slide on the output; unfreezing is always possible. */
  canFreeze: boolean
  onAction(a: Action): void
}

/** The control deck under Program: Prev/Next, transition, then Freeze and the KV/Black pair. */
export function Controls({
  state,
  canPrev,
  canNext,
  canFreeze,
  onAction
}: Props): React.JSX.Element {
  const transitions = [
    { t: 'cut', label: 'Cut' },
    { t: 'fade', label: 'Fade' }
  ] as const
  const seg = useRef<HTMLDivElement>(null)
  // Radio group: one tab stop (the checked one); the arrows move and choose inside it.
  const onSegKey = (e: React.KeyboardEvent): void => {
    const dir =
      e.key === 'ArrowRight' || e.key === 'ArrowDown'
        ? 1
        : e.key === 'ArrowLeft' || e.key === 'ArrowUp'
          ? -1
          : 0
    if (!dir) return
    // Handled here: stopping it keeps the window-level Prev/Next shortcut from also firing.
    // (No data-no-shortcuts on the group: after a mouse click on Fade, Space, F, B and K
    // must keep working for the clicker.)
    e.preventDefault()
    e.stopPropagation()
    const at = transitions.findIndex((x) => x.t === state.transition)
    const to = (at + dir + transitions.length) % transitions.length
    onAction({ type: 'setTransition', transition: transitions[to].t })
    seg.current?.querySelectorAll<HTMLElement>('[role=radio]')[to]?.focus()
  }
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
        <div ref={seg} className="seg" role="radiogroup" aria-label="Transisi" onKeyDown={onSegKey}>
          {transitions.map((x) => (
            <button
              key={x.t}
              role="radio"
              aria-checked={state.transition === x.t}
              tabIndex={state.transition === x.t ? 0 : -1}
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
          disabled={!canFreeze}
          onClick={() => onAction({ type: 'toggleFreeze' })}
        >
          <PauseIcon size={16} />
          Freeze <kbd className="opt">F</kbd>
        </button>
      </div>
      <div>
        <button
          className="cbtn hold"
          aria-pressed={kvOnAir(state)}
          disabled={state.kvUrl === null}
          title={
            state.kvUrl === null ? 'Belum ada KV. Tambahkan KV acara di kolom Deck.' : undefined
          }
          onClick={() => onAction({ type: 'toggleKv' })}
        >
          <ImageIcon size={16} />
          KV <kbd className="opt">K</kbd>
        </button>
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
