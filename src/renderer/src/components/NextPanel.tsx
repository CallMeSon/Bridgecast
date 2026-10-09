import type { DeckMeta } from '../../../shared/types'
import type { Action, ProgramState } from '../../../shared/program'
import { slideUrl } from '../../../shared/ipc'
import { currentDeck, nextView } from '../model'
import { EndCard, VideoMark } from './Slide'
import { SlideLayers } from './SlideLayers'
import { Switch } from './Switch'

export function NextPanel({
  decks,
  state,
  onAction
}: {
  decks: DeckMeta[]
  state: ProgramState
  onAction(a: Action): void
}): React.JSX.Element {
  const deck = currentDeck(decks, state)
  const nx = nextView(decks, state)
  // Notes of the slide on the panel: the preview while frozen, else the operator position.
  const notes = nx.kind === 'slide' && nx.held ? nx.notes : (deck?.slides[state.index]?.notes ?? '')

  const held = nx.kind === 'slide' && nx.held === true
  let card: React.JSX.Element
  let cap: React.ReactNode = ''
  // Position of the slide Next takes, e.g. "3 / 9"; empty at the end of a deck.
  let nextPos = ''
  if (nx.kind === 'slide') {
    // Layers keep the previous slide on screen until the new image has decoded (no black frame).
    // A video slide shows its poster only; the card never plays video.
    card = (
      <div className="slide next-slide">
        <SlideLayers
          media={{ kind: 'image', url: slideUrl(nx.deckId, nx.file) }}
          fade={false}
          muted
          layerClass="next-layer"
          imgAttrs={() => ({ alt: `Slide ${nx.index + 1}` })}
        />
        {nx.video && <VideoMark />}
      </div>
    )
    cap = `Slide ${nx.index + 1}`
    nextPos = deck ? `${nx.index + 1} / ${deck.slides.length}` : ''
  } else if (nx.kind === 'end') {
    card = <EndCard title="End of deck" />
    if (!nx.nextDeck) cap = 'No next deck'
    else if (nx.auto) cap = `Next deck: ${nx.nextDeck}`
    // Auto advance off: Next stops here; the operator picks the next deck.
    else
      cap = (
        <>
          Next stops here. Choose <strong>{nx.nextDeck}</strong> to continue.
        </>
      )
  } else {
    card = <EndCard title="No slides yet" />
  }

  return (
    <aside className="right" aria-label="Up next">
      <div className="colhead">
        <h2>{held ? 'Preview' : 'Up next'}</h2>
        <span className="next-pos" data-testid="next-pos">
          {nextPos}
        </span>
      </div>
      <div className="next-body">
        <div
          className="next-card"
          data-testid="next-card"
          data-kind={nx.kind}
          data-held={held || undefined}
          data-video={(nx.kind === 'slide' && nx.video) || undefined}
        >
          {card}
          <div className="cap">
            <span>{cap}</span>
          </div>
        </div>
        <div className="auto-adv">
          <label id="auto-advance-label" htmlFor="auto-advance">
            Continue to next deck
          </label>
          <Switch
            id="auto-advance"
            labelledBy="auto-advance-label"
            checked={state.autoAdvance}
            testId="auto-advance"
            onChange={(on) => onAction({ type: 'setAutoAdvance', on })}
          />
        </div>
        <div className="notes">
          <h2>Notes</h2>
          <p>{deck ? notes : ''}</p>
        </div>
      </div>
    </aside>
  )
}
