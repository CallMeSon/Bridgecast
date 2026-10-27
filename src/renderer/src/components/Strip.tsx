import { memo, useCallback, useEffect, useRef, useState } from 'react'
import type { DeckMeta, SlideMeta } from '../../../shared/types'
import type { ProgramState } from '../../../shared/program'
import { thumbUrl } from '../../../shared/ipc'
import { posterWithVersion } from '../stream'
import { currentDeck, reorderTarget, slideLabel, slideRole, type SlideRole } from '../model'
import { SlideImage } from './Slide'

const SLIDE_TYPE = 'application/x-ppt-share-slide'

interface Props {
  decks: DeckMeta[]
  state: ProgramState
  onGoto(index: number): void
  /** Per web deck: bumped when its snapshot may have been rewritten under the same name. */
  webVersions?: Record<string, number>
  /** Drag or Alt+Left/Right to reorder: move slide `from` to `to` within the current deck. */
  onMoveSlide(deckId: string, from: number, to: number): void
}

interface ThumbProps {
  deck: DeckMeta
  s: SlideMeta
  i: number
  role: SlideRole | undefined
  current: boolean
  dragging: boolean
  over: boolean
  /** Version of this deck's snapshot (web decks); reloads the thumbnail. */
  version: number
  onGoto(index: number): void
  /** `file` identifies the slide so focus can follow it after the move. */
  onMove(deckId: string, from: number, to: number, file: string): void
  setDragging(i: number | null): void
  setOver(update: (o: number | null) => number | null): void
}

/**
 * One thumbnail. Memoised: all props are primitives or stable references, so a
 * program-state change re-renders only the thumbnails whose role changed.
 */
const Thumb = memo(function Thumb({
  deck,
  s,
  i,
  role,
  current,
  dragging,
  over,
  version,
  onGoto,
  onMove,
  setDragging,
  setOver
}: ThumbProps): React.JSX.Element {
  const end = (): void => {
    setDragging(null)
    setOver(() => null)
  }
  return (
    // Keyed and addressed by the slide's file: after a reorder each image
    // element moves with its slide and keeps the same, still valid URL.
    <button
      className={'th' + (dragging ? ' dragging' : '') + (over ? ' over' : '')}
      data-role={role}
      data-file={s.file}
      data-video={s.video ? 'true' : undefined}
      draggable
      aria-current={current ? 'true' : undefined}
      aria-label={slideLabel(i, role)}
      title="Click to go to this slide. Drag, or press Alt+←/→, to reorder."
      onClick={() => onGoto(i)}
      onKeyDown={(e) => {
        if (!e.altKey) return
        const to = reorderTarget(e.key, 'horizontal', i, deck.slides.length)
        if (to === null) return
        e.preventDefault()
        if (!e.repeat) onMove(deck.id, i, to, s.file)
      }}
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
        setOver((o) => (o === i ? o : i))
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
        onMove(deck.id, Number(from), i, s.file)
      }}
    >
      <SlideImage
        src={posterWithVersion(thumbUrl(deck.id, s.file), version)}
        alt=""
        lazy
        video={!!s.video}
      />
      <span className="tg">
        <span className="n">{i + 1}</span>
        {role === 'live' && <b>LIVE</b>}
        {role === 'frozen' && <b>FROZEN</b>}
        {role === 'next' && <b>NEXT</b>}
      </span>
    </button>
  )
})

export function Strip({
  decks,
  state,
  onGoto,
  onMoveSlide,
  webVersions
}: Props): React.JSX.Element {
  const ref = useRef<HTMLElement>(null)
  const deck = currentDeck(decks, state)
  const [dragging, setDragging] = useState<number | null>(null)
  const [over, setOver] = useState<number | null>(null)
  // File of the slide that takes focus again after a keyboard move.
  const movedFocus = useRef<string | null>(null)

  useEffect(() => {
    ref.current
      ?.querySelector('[aria-current="true"]')
      ?.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' })
  }, [deck?.id, state.index])

  useEffect(() => {
    const file = movedFocus.current
    if (file === null) return
    movedFocus.current = null
    ;[...(ref.current?.querySelectorAll<HTMLElement>('.th') ?? [])]
      .find((el) => el.dataset.file === file)
      ?.focus()
  }, [deck?.slides])

  const move = useCallback(
    (deckId: string, from: number, to: number, file: string) => {
      movedFocus.current = file
      onMoveSlide(deckId, from, to)
    },
    [onMoveSlide]
  )

  if (!deck) {
    return (
      <footer ref={ref} role="region" aria-label="Slide strip">
        <span className="empty">{decks.length ? 'Choose a deck in Decks.' : 'No slides yet.'}</span>
      </footer>
    )
  }

  return (
    // role=region: a <footer> inside the app shell must not announce as page contentinfo.
    <footer ref={ref} role="region" aria-label="Slide strip" data-testid="strip">
      <div className="strip-main">
        <div className="thumbs" role="group" aria-label={`Slides in ${deck.name}`}>
          {deck.slides.map((s, i) => (
            <Thumb
              key={s.file}
              deck={deck}
              s={s}
              i={i}
              role={slideRole(decks, state, deck.id, i)}
              current={i === state.index}
              dragging={dragging === i}
              over={over === i}
              version={deck.source === 'web' ? (webVersions?.[deck.id] ?? 0) : 0}
              onGoto={onGoto}
              onMove={move}
              setDragging={setDragging}
              setOver={setOver}
            />
          ))}
        </div>
        {/* Legend under the thumbnails: what each mark in the strip means. */}
        <div className="lg" aria-hidden="true">
          <span>
            <i className="sk live" />
            Live on Program
          </span>
          <span>
            <i className="sk frozen" />
            Frozen on Program
          </span>
          <span>
            <i className="sk next" />
            Next
          </span>
          <span>
            <i className="sk pos" />
            Position
          </span>
        </div>
      </div>
    </footer>
  )
}
