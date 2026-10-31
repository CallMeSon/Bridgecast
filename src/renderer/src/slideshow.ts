import { useCallback, useEffect, useState } from 'react'
import { bumpVersion } from './model'
import type { DeckEditErrorEvent } from '../../shared/ipc'
import type { SlideshowStatus } from '../../shared/playback'

const NONE: SlideshowStatus = { decks: {}, resumable: [], helperError: null, engine: 'powerpoint' }

/**
 * What the operator window knows about native decks: each session's state, decks whose edit
 * waits for them to leave air, the last edit failure, and a per-deck version that changes when
 * the deck's files were replaced under the same names (thumbnails reload).
 */
export function useSlideshow(onApplied: (deckId: string) => void): {
  status: SlideshowStatus
  pending: string[]
  editError: DeckEditErrorEvent | null
  clearEditError(): void
  versions: Record<string, number>
} {
  const api = window.api
  const [status, setStatus] = useState<SlideshowStatus>(NONE)
  const [pending, setPending] = useState<string[]>([])
  const [editError, setEditError] = useState<DeckEditErrorEvent | null>(null)
  const [versions, setVersions] = useState<Record<string, number>>({})

  useEffect(() => {
    let fresh = true
    const off = api.onSlideshowStatus((s) => {
      fresh = false
      setStatus(s)
    })
    api
      .slideshowStatus()
      .then((s) => {
        if (fresh) setStatus(s)
      })
      .catch((e: unknown) => console.warn('[slideshow] status failed to load:', e))
    return off
  }, [api])

  useEffect(() => {
    const offPending = api.onDeckPending(({ deckId, pending: on }) => {
      setPending((xs) =>
        on ? (xs.includes(deckId) ? xs : [...xs, deckId]) : xs.filter((x) => x !== deckId)
      )
      if (!on) {
        setVersions((v) => bumpVersion(v, deckId))
        onApplied(deckId)
      } else {
        setEditError((e) => (e?.deckId === deckId ? null : e))
      }
    })
    const offError = api.onDeckEditError(setEditError)
    return () => {
      offPending()
      offError()
    }
  }, [api, onApplied])

  const clearEditError = useCallback(() => setEditError(null), [])
  return { status, pending, editError, clearEditError, versions }
}

/** Output windows: per deck, bumped when its files were replaced under the same names. */
export function useDeckVersions(): Record<string, number> {
  const api = window.api
  const [versions, setVersions] = useState<Record<string, number>>({})
  useEffect(
    () =>
      api.onDeckPending(({ deckId, pending }) => {
        if (!pending) setVersions((v) => bumpVersion(v, deckId))
      }),
    [api]
  )
  return versions
}
