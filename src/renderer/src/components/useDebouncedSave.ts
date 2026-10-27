import { useCallback, useEffect, useRef } from 'react'

/**
 * Debounced saver for a control that previews at once (a volume slider): `schedule`
 * keeps only the latest value and saves it `ms` after the last change, `flush`
 * saves a pending value now, and unmounting flushes too, so closing a popover
 * never drops the last change. `pending` tells whether a value is still waiting.
 */
export function useDebouncedSave<T>(
  save: (value: T) => void,
  ms = 150
): { schedule(value: T): void; flush(): void; pending(): boolean } {
  const saveRef = useRef(save)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const waiting = useRef<{ value: T } | null>(null)

  useEffect(() => {
    saveRef.current = save
  })

  const flush = useCallback((): void => {
    clearTimeout(timer.current)
    const w = waiting.current
    waiting.current = null
    if (w) saveRef.current(w.value)
  }, [])

  const schedule = useCallback(
    (value: T): void => {
      waiting.current = { value }
      clearTimeout(timer.current)
      timer.current = setTimeout(flush, ms)
    },
    [flush, ms]
  )

  const pending = useCallback((): boolean => waiting.current !== null, [])

  useEffect(() => flush, [flush])

  return { schedule, flush, pending }
}
