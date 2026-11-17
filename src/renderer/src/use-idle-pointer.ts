import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * Hides the mouse pointer over a preview while it rests, and brings it back on the next
 * movement. Used over the page image (Prepare stage, Program monitor) so a still pointer is
 * not left lying on the picture the operator is watching.
 */
export function useIdlePointer(ms = 1200): { hidden: boolean; poke: () => void } {
  const [hidden, setHidden] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const poke = useCallback(() => {
    setHidden(false)
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => setHidden(true), ms)
  }, [ms])
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current)
    },
    []
  )
  return { hidden, poke }
}
