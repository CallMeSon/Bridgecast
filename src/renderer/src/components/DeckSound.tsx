import { useEffect, useId, useRef, useState } from 'react'
import { sanitizeDeckAudio, type DeckAudio } from '../../../shared/audio-levels'
import type { DeckMeta } from '../../../shared/types'
import { Switch } from './Switch'
import { VolumeSlider } from './VolumeSlider'
import { useDebouncedSave } from './useDebouncedSave'

interface Props {
  deck: DeckMeta
  /** Where the deck menu was (viewport pixels); the popover opens there. */
  at: { x: number; y: number }
  /** Saves the level (App updates the deck and the output). Resolves on its own errors. */
  onSave(audio: DeckAudio): void
  /** Close; `restoreFocus` when the keyboard closed it and the deck's row should take focus. */
  onClose(restoreFocus: boolean): void
}

const WIDTH = 340

/**
 * Sound of one deck (volume and mute), opened from "Sound…" in the deck menu. It
 * previews at once, saves 150 ms after the last change and flushes when it closes,
 * so a take of this deck's video slide always plays at the level shown here.
 * Focus goes to the volume slider; Escape, a click outside or Tab out closes it.
 */
export function DeckSound({ deck, at, onSave, onClose }: Props): React.JSX.Element {
  const [audio, setAudio] = useState<DeckAudio>(() => sanitizeDeckAudio(deck.audio))
  const ref = useRef<HTMLDivElement>(null)
  const id = useId()
  const save = useDebouncedSave<DeckAudio>(onSave)

  const change = (next: DeckAudio): void => {
    setAudio(next)
    save.schedule(next)
  }

  useEffect(() => {
    ref.current?.querySelector<HTMLElement>('input[type=range]')?.focus()
    const outside = (e: PointerEvent): void => {
      if (!ref.current?.contains(e.target as Node)) onClose(false)
    }
    // Leaving the window must not leave a stray popover behind.
    const blur = (): void => onClose(false)
    addEventListener('pointerdown', outside, true)
    addEventListener('blur', blur)
    addEventListener('resize', blur)
    return () => {
      removeEventListener('pointerdown', outside, true)
      removeEventListener('blur', blur)
      removeEventListener('resize', blur)
    }
    // Registered once for the life of the popover.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const left = Math.max(8, Math.min(at.x, innerWidth - WIDTH - 8))
  const top = Math.max(8, Math.min(at.y, innerHeight - 220))

  return (
    <div
      ref={ref}
      className="popover deck-sound"
      role="dialog"
      aria-label={`Sound of ${deck.name}`}
      data-no-shortcuts
      data-testid="deck-sound"
      style={{ left, top, width: WIDTH }}
      onKeyDown={(e) => {
        if (e.key !== 'Escape') return
        e.stopPropagation()
        onClose(true)
      }}
      onBlur={(e) => {
        // Tab (or a click) to something outside the popover closes it, like the menu.
        const to = e.relatedTarget as Node | null
        if (to && !e.currentTarget.contains(to)) onClose(false)
      }}
    >
      <div>
        <h2 className="pop-title">Deck sound</h2>
        <p className="hint deck-sound-name" title={deck.name}>
          {deck.name}
        </p>
      </div>
      <VolumeSlider
        id={`${id}-volume`}
        label="Volume"
        value={audio.volume}
        testId="deck-volume"
        onChange={(volume) => change({ ...audio, volume })}
      />
      <div className="pop-head">
        <label className="row-label" id={`${id}-mute-title`} htmlFor={`${id}-mute`}>
          Mute deck
        </label>
        <Switch
          id={`${id}-mute`}
          labelledBy={`${id}-mute-title`}
          checked={audio.muted}
          testId="deck-mute"
          onChange={(muted) => change({ ...audio, muted })}
        />
      </div>
    </div>
  )
}
