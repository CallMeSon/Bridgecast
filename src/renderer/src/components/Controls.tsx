import type { Action } from '../../../shared/program'

interface Props {
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
 * Section and deck buttons, under Up next in the Controls tab. Prev/Next/Freeze/KV/Black
 * live in TransportBar; Transition lives in its own section of the panel.
 */
export function Controls({
  hasSections,
  canPrevSection,
  canNextSection,
  canPrevDeck,
  canNextDeck,
  onAction
}: Props): React.JSX.Element {
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
      <div className="decks-nav">
        <button
          className="cbtn"
          disabled={!canPrevDeck}
          onClick={() => onAction({ type: 'prevDeck' })}
        >
          Prev deck <kbd>⇧D</kbd>
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
