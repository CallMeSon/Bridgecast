import { memo, useCallback, useEffect, useRef, useState } from 'react'
import type { DeckMeta, SlideMeta } from '../../../shared/types'
import type { ProgramState } from '../../../shared/program'
import { thumbUrl } from '../../../shared/ipc'
import { posterWithVersion } from '../stream'
import { currentDeck, reorderTarget, slideLabel, slideRole, type SlideRole } from '../model'
import { SlideImage } from './Slide'
import { StatusTag } from './StatusTag'

/** '3 clicks': the animation steps the slide has when it plays natively. */
const clicksText = (n: number): string => `${n} ${n === 1 ? 'click' : 'clicks'}`

const SLIDE_TYPE = 'application/x-ppt-share-slide'

interface Props {
  decks: DeckMeta[]
  state: ProgramState
  onGoto(index: number): void
  /** Per deck: bumped when its images may have been rewritten under the same names (web snapshot, edit, revert). */
  versions?: Record<string, number>
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
  /** Version of this deck's images; reloads the thumbnail. */
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
      data-hidden={s.hidden ? 'true' : undefined}
      draggable
      aria-current={current ? 'true' : undefined}
      aria-label={
        slideLabel(i, role) +
        (s.hidden ? ', hidden' : '') +
        (s.clicks ? `, ${clicksText(s.clicks)}` : '')
      }
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
      <div className="im">
        <SlideImage
          src={posterWithVersion(thumbUrl(deck.id, s.file), version)}
          alt=""
          lazy
          video={!!s.video}
        />
        <span className="no">{i + 1}</span>
        {(role === 'live' || role === 'frozen' || role === 'next') && (
          <span className="tag">
            <StatusTag kind={role} size="sm" variant="icon" />
          </span>
        )}
        {(s.hidden || !!s.clicks) && (
          <span className="tg">
            {s.hidden && <i className="hid">Hidden</i>}
            {!!s.clicks && !s.hidden && <i className="clk">{clicksText(s.clicks)}</i>}
          </span>
        )}
      </div>
    </button>
  )
})

export function Strip({ decks, state, onGoto, onMoveSlide, versions }: Props): React.JSX.Element {
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
              version={versions?.[deck.id] ?? 0}
              onGoto={onGoto}
              onMove={move}
              setDragging={setDragging}
              setOver={setOver}
            />
          ))}
        </div>
      </div>
      <div className="sbar">
        <span className="dn" title={deck.name}>
          {deck.name}
        </span>
        <span className="count">
          {deck.slides.length} {deck.slides.length === 1 ? 'slide' : 'slides'}
        </span>
        {/* What each ring in the strip means. */}
        <span className="legend" aria-hidden="true">
          <span className="l">
            <i />
            Live on Program
          </span>
          <span className="n">
            <i />
            Next
          </span>
        </span>
      </div>
    </footer>
  )
}
