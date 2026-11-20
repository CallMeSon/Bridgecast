import { useEffect, useState } from 'react'
import { zoomInstant, type ZoomFrame } from '../../shared/zoom'

/**
 * True for the frame in which the zoom changes as a cut (`zoomInstant`): the zoom layer then
 * renders with its transition off, so a take or KV never animates the zoom on air. It clears
 * two frames later, once that frame has been styled without the transition.
 */
export function useInstantZoom(take: number, applies: boolean): boolean {
  const [seen, setSeen] = useState<ZoomFrame>({ take, applies })
  const instant = zoomInstant(seen, { take, applies })
  useEffect(() => {
    if (!instant) return
    let inner = 0
    const outer = requestAnimationFrame(() => {
      inner = requestAnimationFrame(() => setSeen({ take, applies }))
    })
    return () => {
      cancelAnimationFrame(outer)
      cancelAnimationFrame(inner)
    }
  }, [instant, take, applies])
  return instant
}
