import { useRef, useState } from 'react'
import { canvasLabel, DECK_FITS, sanitizeFit, type DeckFit } from '../../../shared/canvas'
import type { DeckAudio } from '../../../shared/audio-levels'
import type { DeckMeta, EventMeta } from '../../../shared/types'
import type { ProgramState } from '../../../shared/program'
import { DeckSoundFields } from './DeckSound'
import { EventCanvasDialog } from './EventCanvasDialog'
import { FIT_NAMES } from './deck-fit'
import { Segmented } from './Segmented'

interface Props {
  /** The deck at the operator position; none in an empty event. */
  deck: DeckMeta | undefined
  event: EventMeta | undefined
  program: ProgramState
  onSetDeckFit(deckId: string, fit: DeckFit): void
  onSetDeckAudio(deckId: string, audio: DeckAudio): void
  onEventUpdated(ev: EventMeta): void
}

const FIT_OPTIONS = DECK_FITS.map((f) => ({ value: f, label: FIT_NAMES[f].name }))

/**
 * Body of the "Deck settings" section: Display mode and Sound of the deck at the operator
 * position (the same handlers as the deck menu) and the canvas of the event.
 */
export function DeckSettings({
  deck,
  event,
  program,
  onSetDeckFit,
  onSetDeckAudio,
  onEventUpdated
}: Props): React.JSX.Element {
  const [canvasOpen, setCanvasOpen] = useState(false)
  const change = useRef<HTMLButtonElement>(null)
  const fit = sanitizeFit(deck?.fit)
  return (
    <>
      {!deck && <p className="note">Pick a deck to set its display mode and sound.</p>}
      {deck && deck.source !== 'web' && (
        <div className="field">
          <span className="lbl">Display mode</span>
          <Segmented<DeckFit>
            label="Display mode"
            value={fit}
            options={FIT_OPTIONS}
            testId="deck-fit"
            onChange={(f) => onSetDeckFit(deck.id, f)}
          />
          <span className="hint">{FIT_NAMES[fit].hint}</span>
        </div>
      )}
      {deck && (
        <div className="pop-section" data-testid="deck-sound-fields">
          <DeckSoundFields
            key={deck.id}
            deck={deck}
            onSave={(audio) => onSetDeckAudio(deck.id, audio)}
          />
        </div>
      )}
      <div className="row deck-canvas">
        <span className="k">Canvas</span>
        <span className="v mono" data-testid="panel-canvas">
          {canvasLabel(program.canvas)}
        </span>
        <button
          ref={change}
          type="button"
          className="btn sm"
          disabled={!event}
          aria-haspopup="dialog"
          aria-expanded={canvasOpen}
          onClick={() => setCanvasOpen(!canvasOpen)}
        >
          Change
        </button>
        {canvasOpen && event && (
          <EventCanvasDialog
            event={event}
            program={program}
            onSaved={onEventUpdated}
            onClose={(restoreFocus) => {
              setCanvasOpen(false)
              // The app behind the dialog is inert until it unmounts: focus after that.
              if (restoreFocus) requestAnimationFrame(() => change.current?.focus())
            }}
          />
        )}
      </div>
    </>
  )
}
