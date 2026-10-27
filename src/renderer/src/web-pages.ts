import { useCallback, useEffect, useRef, useState } from 'react'
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
 * The list from `web:statuses` merged with what events already said: entries of
 * `touched` (pages that sent a `web:status` since the list was requested) keep
 * their event status, which is newer; other pages follow the list, so a closed
 * page drops out.
 */
export function mergeStatuses(
  prev: Record<string, WebStatus>,
  list: { deckId: string; status: WebStatus }[],
  touched: ReadonlySet<string>
): Record<string, WebStatus> {
  const out: Record<string, WebStatus> = Object.fromEntries(list.map((e) => [e.deckId, e.status]))
  for (const id of touched) if (id in prev) out[id] = prev[id]
  return out
}

/**
 * The open web deck pages (`web:statuses`, then `web:status`). `refresh` reads
 * the list again (a closed page sends no status of its own).
 */
export function useWebPages(): WebPages & { refresh(): void; bump(deckId: string): void } {
  const [pages, setPages] = useState<WebPages>({ statuses: {}, versions: {}, generations: {} })
  const [tick, setTick] = useState(0)
  // Pages that sent a status event since the current list request began.
  const touched = useRef(new Set<string>())
  useEffect(() => {
    const api = window.api
    touched.current = new Set()
    const off = api.onWebStatus((e) => {
      touched.current.add(e.deckId)
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
        // Newer event entries win over the list; pages the list lacks (closed) drop out.
        setPages((p) => ({ ...p, statuses: mergeStatuses(p.statuses, list, touched.current) }))
      })
      .catch((e: unknown) => console.warn('[web] page statuses failed to load:', e))
    return off
  }, [tick])
  const bump = useCallback(
    (deckId: string) =>
      setPages((p) => ({
        ...p,
        versions: { ...p.versions, [deckId]: (p.versions[deckId] ?? 0) + 1 }
      })),
    []
  )
  return { ...pages, refresh: () => setTick((t) => t + 1), bump }
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
