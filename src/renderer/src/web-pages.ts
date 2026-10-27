import { useEffect, useState } from 'react'
import type { WebOutputs, WebStatus } from '../../shared/web'
import { recaptureNeeded } from './stream'

export interface WebPages {
  /** Load state of every open web deck page. */
  statuses: Record<string, WebStatus>
  /** Per page: counts its status events (a snapshot may have been rewritten: reload the poster). */
  versions: Record<string, number>
  /** Per page: bumped when it comes back from an error (capture again with a new source id). */
  generations: Record<string, number>
}

/**
 * The open web deck pages (`web:statuses`, then `web:status`). `refresh` reads
 * the list again (a closed page sends no status of its own).
 */
export function useWebPages(): WebPages & { refresh(): void } {
  const [pages, setPages] = useState<WebPages>({ statuses: {}, versions: {}, generations: {} })
  const [tick, setTick] = useState(0)
  useEffect(() => {
    const api = window.api
    let fresh = true
    const off = api.onWebStatus((e) => {
      fresh = false
      setPages((p) => ({
        statuses: { ...p.statuses, [e.deckId]: e.status },
        versions: { ...p.versions, [e.deckId]: (p.versions[e.deckId] ?? 0) + 1 },
        generations: recaptureNeeded(p.statuses[e.deckId], e.status)
          ? { ...p.generations, [e.deckId]: (p.generations[e.deckId] ?? 0) + 1 }
          : p.generations
      }))
    })
    api
      .webStatuses()
      .then((list) => {
        // A full list replaces the statuses (closed pages drop out) unless an event came first.
        if (!fresh && tick === 0) return
        setPages((p) => ({
          ...p,
          statuses: Object.fromEntries(list.map((e) => [e.deckId, e.status]))
        }))
      })
      .catch((e: unknown) => console.warn('[web] page statuses failed to load:', e))
    return off
  }, [tick])
  return { ...pages, refresh: () => setTick((t) => t + 1) }
}

/** Which outputs main counts for the ready gate (`web:outputs`); null until known. */
export function useWebOutputs(): WebOutputs | null {
  const [outputs, setOutputs] = useState<WebOutputs | null>(null)
  useEffect(() => {
    const api = window.api
    let fresh = true
    const off = api.onWebOutputs((o) => {
      fresh = false
      setOutputs(o)
    })
    api
      .webOutputs()
      .then((o) => {
        if (fresh) setOutputs(o)
      })
      .catch((e: unknown) => console.warn('[web] output state failed to load:', e))
    return off
  }, [])
  return outputs
}
