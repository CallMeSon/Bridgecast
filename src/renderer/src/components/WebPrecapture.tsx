import { useEffect, useRef } from 'react'
import { openStream, playFirstFrame, precaptureFormat, stopStream } from '../stream'

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
 * Captures one page off screen (video only, 1 px, invisible) and reports its first
 * frame for the ready gate. requestVideoFrameCallback is registered before play(): a
 * still page sends a single frame. A failure, or no frame in time, captures again
 * after a while. Nobody sees it, but it asks for the Canvas at the monitor's rate
 * (`precaptureFormat`): the monitor and Prepare share its capture while it runs.
 */
function Precapture({
  deckId,
  canvas,
  onGone
}: {
  deckId: string
  canvas: { width: number; height: number }
  onGone(): void
}): React.JSX.Element {
  const ref = useRef<HTMLVideoElement>(null)
  const gone = useRef(onGone)
  const size = useRef(canvas)
  useEffect(() => {
    gone.current = onGone
    size.current = canvas
  })
  useEffect(() => {
    let alive = true
    let stream: MediaStream | null = null
    let timer: ReturnType<typeof setTimeout> | null = null
    const run = (): void => {
      const f = precaptureFormat(size.current)
      openStream('tab', deckId, f.canvas, f.fps, false)
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
  canvas,
  onGone
}: {
  deckIds: string[]
  /** The Canvas; no pre-capture until it is known. */
  canvas: { width: number; height: number } | undefined
  onGone(): void
}): React.JSX.Element | null {
  if (deckIds.length === 0 || !canvas) return null
  return (
    <div className="web-precapture" aria-hidden="true">
      {deckIds.map((id) => (
        <Precapture key={id} deckId={id} canvas={canvas} onGone={onGone} />
      ))}
    </div>
  )
}
