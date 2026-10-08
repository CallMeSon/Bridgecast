import { useEffect, useRef, useState } from 'react'
import type { DeckMeta } from '../../../shared/types'
import type { ProgramState } from '../../../shared/program'
import { slideUrl } from '../../../shared/ipc'
import { currentDeck, nextIndex, tally } from '../model'
import { SlideImage } from './Slide'

const SLIDE_TYPE = 'application/x-ppt-share-slide'

interface Props {
  decks: DeckMeta[]
  state: ProgramState
  onGoto(index: number): void
  /** Drag to reorder: move slide `from` to `to` within the current deck. */
  onMoveSlide(deckId: string, from: number, to: number): void
}

export function Strip({ decks, state, onGoto, onMoveSlide }: Props): React.JSX.Element {
  const ref = useRef<HTMLElement>(null)
  const deck = currentDeck(decks, state)
  const [dragging, setDragging] = useState<number | null>(null)
  const [over, setOver] = useState<number | null>(null)

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
    // Same rule as the Library: LIVE only while the slide is really on air (not frozen or black).
    const live =
      tally(state) === 'live' &&
      state.shown &&
      state.shown.deckId === deck.id &&
      state.shown.index === i
    if (live) return 'live'
    if (i === nxt) return 'next'
    if (i === state.index) return 'pos'
    return undefined
  }
  const end = (): void => {
    setDragging(null)
    setOver(null)
  }

  return (
    <footer ref={ref} data-testid="strip">
      <div className="lab">
        <span className="nm" title={deck.name}>
          {deck.name}
        </span>
        <span className="m">{deck.slides.length} slide</span>
        <div className="lg">
          <span>
            <i className="sk live" />
            Tayang di Program
          </span>
          <span>
            <i className="sk next" />
            Berikutnya
          </span>
        </div>
      </div>
      <div className="thumbs">
        {deck.slides.map((s, i) => (
          // Keyed and addressed by the slide's file: after a reorder each image
          // element moves with its slide and keeps the same, still valid URL.
          <button
            key={s.file}
            className={'th' + (dragging === i ? ' dragging' : '') + (over === i ? ' over' : '')}
            data-role={role(i)}
            data-file={s.file}
            draggable
            aria-current={i === state.index ? 'true' : undefined}
            aria-label={`Slide ${i + 1}`}
            title="Klik untuk menampilkan · seret untuk mengurutkan"
            onClick={() => onGoto(i)}
            onDragStart={(e) => {
              e.dataTransfer.setData(SLIDE_TYPE, `${deck.id}:${i}`)
              e.dataTransfer.effectAllowed = 'move'
              setDragging(i)
            }}
            onDragEnd={end}
            onDragOver={(e) => {
              if (!e.dataTransfer.types.includes(SLIDE_TYPE)) return
              e.preventDefault()
              e.dataTransfer.dropEffect = 'move'
              if (over !== i) setOver(i)
            }}
            onDragLeave={() => setOver((o) => (o === i ? null : o))}
            onDrop={(e) => {
              const data = e.dataTransfer.getData(SLIDE_TYPE)
              if (!data) return
              e.preventDefault()
              e.stopPropagation()
              end()
              const [fromDeck, from] = data.split(':')
              if (fromDeck !== deck.id) return // a drag from another deck's strip
              onMoveSlide(deck.id, Number(from), i)
            }}
          >
            <SlideImage src={slideUrl(deck.id, s.file)} alt="" lazy />
            <span className="tg">
              <span className="n">{i + 1}</span>
              {role(i) === 'live' && <b>LIVE</b>}
              {role(i) === 'next' && <b>NEXT</b>}
            </span>
          </button>
        ))}
      </div>
    </footer>
  )
}
