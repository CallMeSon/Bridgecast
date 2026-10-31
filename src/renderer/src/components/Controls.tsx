import { useRef } from 'react'
import type { Action, ProgramState } from '../../../shared/program'

interface Props {
  state: ProgramState
  /** The event has sections: the section buttons show. */
  hasSections: boolean
  canPrevSection: boolean
  canNextSection: boolean
  /** D and Shift+D: another deck exists in that direction. */
  canPrevDeck: boolean
  canNextDeck: boolean
  onAction(a: Action): void
}

/**
 * What the transport bar does not hold: section and deck buttons and the transition.
 * Prev/Next/Freeze/KV/Black live in TransportBar. Transition moves to the Controls tab later.
 */
export function Controls({
  state,
  hasSections,
  canPrevSection,
  canNextSection,
  canPrevDeck,
  canNextDeck,
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
    <div className="controls-extra" data-testid="controls-extra">
      {hasSections && (
        <div>
          <button
            className="cbtn"
            disabled={!canPrevSection}
            onClick={() => onAction({ type: 'prevSection' })}
          >
            Prev section <kbd>⇧N</kbd>
          </button>
          <button
            className="cbtn"
            disabled={!canNextSection}
            onClick={() => onAction({ type: 'nextSection' })}
          >
            Next section <kbd>N</kbd>
          </button>
        </div>
      )}
      <div className="trans">
        <span className="cl">Transition</span>
        <div
          ref={seg}
          className="seg"
          role="radiogroup"
          aria-label="Transition"
          onKeyDown={onSegKey}
        >
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
      <div className="decks-nav">
        <button
          className="cbtn"
          disabled={!canPrevDeck}
          onClick={() => onAction({ type: 'prevDeck' })}
        >
          Prev deck <kbd>Shift+D</kbd>
        </button>
        <button
          className="cbtn"
          disabled={!canNextDeck}
          onClick={() => onAction({ type: 'nextDeck' })}
        >
          Next deck <kbd>D</kbd>
        </button>
      </div>
    </div>
  )
}
