import type { DeckMeta } from '../../../shared/types'
import type { Action, ProgramState } from '../../../shared/program'
import { slideUrl } from '../../../shared/ipc'
import { currentDeck, nextView } from '../model'
import { EndCard, SlideImage } from './Slide'
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
    card = <SlideImage src={slideUrl(nx.deckId, nx.file)} alt={`Slide ${nx.index + 1}`} />
    cap = `Slide ${nx.index + 1}`
    nextPos = deck ? `${nx.index + 1} / ${deck.slides.length}` : ''
  } else if (nx.kind === 'end') {
    card = <EndCard title="Akhir deck" />
    if (!nx.nextDeck) cap = 'Tidak ada deck berikutnya'
    else if (nx.auto) cap = `Berikutnya: ${nx.nextDeck}`
    // Auto advance off: Next stops here; the operator picks the next deck.
    else
      cap = (
        <>
          Next berhenti di sini. Pilih <strong>{nx.nextDeck}</strong> untuk lanjut.
        </>
      )
  } else {
    card = <EndCard title="Belum ada slide" />
  }

  return (
    <aside className="right" aria-label="Slide berikutnya">
      <div className="colhead">
        <h2>{held ? 'Tayang saat Unfreeze' : 'Slide berikutnya'}</h2>
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
        >
          {card}
          <div className="cap">
            <span>{cap}</span>
          </div>
        </div>
        <div className="auto-adv">
          <label id="auto-advance-label" htmlFor="auto-advance">
            Lanjut otomatis ke deck berikutnya
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
          <h2>Catatan</h2>
          <p>{deck ? notes : ''}</p>
        </div>
      </div>
    </aside>
  )
}
