import { useEffect, useRef } from 'react'
import { openStream, playFirstFrame, stopStream } from '../stream'

/** Small and slow: this capture only proves a frame arrives (ready gate), nobody sees it. */
const PRECAPTURE_SIZE = { width: 320, height: 180 }
const PRECAPTURE_FPS = 5
const RETRY_MS = 2000
/** No first frame within this time: capture again (a new source id). */
const FRAME_WAIT_MS = 3000

const withTimeout = (p: Promise<void>, ms: number): Promise<void> =>
  new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`no frame within ${ms} ms`)), ms)
    p.then(
      () => {
        clearTimeout(t)
        resolve()
      },
      (e: unknown) => {
        clearTimeout(t)
        reject(e)
      }
    )
  })

/**
 * Captures one page off screen (video only, tiny, 1 px, invisible) and reports its
 * first frame for the ready gate. requestVideoFrameCallback is registered before
 * play(): a still page sends a single frame. A failure, or no frame in time,
 * captures again after a while.
 */
function Precapture({ deckId, onGone }: { deckId: string; onGone(): void }): React.JSX.Element {
  const ref = useRef<HTMLVideoElement>(null)
  const gone = useRef(onGone)
  useEffect(() => {
    gone.current = onGone
  })
  useEffect(() => {
    let alive = true
    let stream: MediaStream | null = null
    let timer: ReturnType<typeof setTimeout> | null = null
    const run = (): void => {
      openStream('tab', deckId, PRECAPTURE_SIZE, PRECAPTURE_FPS, false)
        .then(async (s) => {
          if (!alive || !ref.current) {
            stopStream(s)
            return
          }
          stream = s
          await withTimeout(playFirstFrame(ref.current, s), FRAME_WAIT_MS)
          if (alive) await window.api.webFrame(deckId)
        })
        .catch((e: unknown) => {
          if (!alive) return
          console.warn(`[web] pre-capture of ${deckId} failed:`, e)
          stopStream(stream)
          stream = null
          // The page may be closed: read the list again.
          gone.current()
          timer = setTimeout(run, RETRY_MS)
        })
    }
    run()
    const v = ref.current
    return () => {
      alive = false
      if (timer) clearTimeout(timer)
      stopStream(stream)
      if (v) v.srcObject = null
    }
  }, [deckId])
  return <video ref={ref} muted playsInline aria-hidden="true" />
}

/**
 * Off-screen captures of pages that are not on air yet, so main's ready gate can
 * open (main only takes the first frame from an active output window, or from
 * the operator window while no output is active).
 */
export function WebPrecapture({
  deckIds,
  onGone
}: {
  deckIds: string[]
  onGone(): void
}): React.JSX.Element | null {
  if (deckIds.length === 0) return null
  return (
    <div className="web-precapture" aria-hidden="true">
      {deckIds.map((id) => (
        <Precapture key={id} deckId={id} onGone={onGone} />
      ))}
    </div>
  )
}
