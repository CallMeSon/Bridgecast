import type { DeckMeta } from '../../../shared/types'
import type { ProgramState } from '../../../shared/program'
import { slideUrl } from '../../../shared/ipc'
import { currentDeck, nextView } from '../model'
import { EndCard, SlideImage } from './Slide'

export function NextPanel({
  decks,
  state
}: {
  decks: DeckMeta[]
  state: ProgramState
}): React.JSX.Element {
  const deck = currentDeck(decks, state)
  const nx = nextView(decks, state)
  const notes = deck?.slides[state.index]?.notes ?? ''

  let card: React.JSX.Element
  let cap = ''
  // Position of the slide Next takes, e.g. "3 / 9"; empty at the end of a deck.
  let nextPos = ''
  if (nx.kind === 'slide') {
    card = <SlideImage src={slideUrl(nx.deckId, nx.file)} alt={`Slide ${nx.index + 1}`} />
    cap = `Slide ${nx.index + 1}`
    nextPos = deck ? `${nx.index + 1} / ${deck.slides.length}` : ''
  } else if (nx.kind === 'end') {
    card = <EndCard title="Akhir deck" />
    cap = nx.nextDeck ? `Berikutnya: ${nx.nextDeck}` : 'Tidak ada deck berikutnya'
  } else {
    card = <EndCard title="Belum ada slide" />
  }

  return (
    <aside className="right" aria-label="Slide berikutnya">
      <div className="colhead">
        <h2>Slide berikutnya</h2>
        <span className="next-pos" data-testid="next-pos">
          {nextPos}
        </span>
      </div>
      <div className="next-body">
        <div className="next-card" data-testid="next-card" data-kind={nx.kind}>
          {card}
          <div className="cap">
            <span>{cap}</span>
          </div>
        </div>
        <div className="notes">
          <h2>Catatan</h2>
          <p>{deck ? notes : ''}</p>
        </div>
      </div>
    </aside>
  )
}
