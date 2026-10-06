import { useEffect, useRef } from 'react'
import type { DeckMeta } from '../../../shared/types'
import type { ProgramState } from '../../../shared/program'
import { slideUrl } from '../../../shared/ipc'
import { currentDeck, nextIndex } from '../model'
import { SlideImage } from './Slide'

interface Props {
  decks: DeckMeta[]
  state: ProgramState
  onGoto(index: number): void
}

export function Strip({ decks, state, onGoto }: Props): React.JSX.Element {
  const ref = useRef<HTMLElement>(null)
  const deck = currentDeck(decks, state)

  useEffect(() => {
    ref.current
      ?.querySelector('[aria-current="true"]')
      ?.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' })
  }, [deck?.id, state.index])

  if (!deck) {
    return (
      <footer ref={ref}>
        <span className="empty">
          {decks.length ? 'Pilih deck di Library.' : 'Belum ada slide.'}
        </span>
      </footer>
    )
  }

  const nxt = nextIndex(decks, state)
  const role = (i: number): string | undefined => {
    const live = state.shown && state.shown.deckId === deck.id && state.shown.index === i
    if (live) return 'live'
    if (i === nxt) return 'next'
    if (i === state.index) return 'pos'
    return undefined
  }

  return (
    <footer ref={ref} data-testid="strip">
      {deck.slides.map((s, i) => (
        <button
          key={s.file}
          className="th"
          data-role={role(i)}
          aria-current={i === state.index ? 'true' : undefined}
          aria-label={`Slide ${i + 1}`}
          onClick={() => onGoto(i)}
        >
          <SlideImage src={slideUrl(deck.id, i)} alt="" lazy />
          <span className="n">{i + 1}</span>
        </button>
      ))}
    </footer>
  )
}
