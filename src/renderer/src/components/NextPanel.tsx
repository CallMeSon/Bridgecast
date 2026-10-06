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
  if (nx.kind === 'slide') {
    card = <SlideImage src={slideUrl(nx.deckId, nx.index)} alt={`Slide ${nx.index + 1}`} />
    cap = `Slide ${nx.index + 1}`
  } else if (nx.kind === 'end') {
    card = <EndCard title="Akhir deck" />
    cap = nx.nextDeck ? `Berikutnya: ${nx.nextDeck}` : 'Tidak ada deck berikutnya'
  } else {
    card = <EndCard title="Belum ada slide" />
  }

  return (
    <aside className="right">
      <div className="panel-h">
        Slide berikutnya <span className="grow" />
        <span className="count" data-testid="pos">
          {deck ? `${state.index + 1} / ${deck.slides.length}` : ''}
        </span>
      </div>
      <div className="next-card" data-testid="next-card">
        {card}
        <div className="cap">
          <span>{cap}</span>
        </div>
      </div>
      <div className="notes">
        <div className="panel-h">Catatan</div>
        <p>{deck ? notes : ''}</p>
      </div>
    </aside>
  )
}
