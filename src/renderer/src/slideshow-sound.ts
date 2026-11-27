import { useEffect } from 'react'
import type { OutputAudio } from './output-audio'

/**
 * PowerPoint's and a web-bridge page's sound: main sends it over a MessagePort to every window
 * that asks (the outputs and the operator), which play it through the same gain as a video.
 * A new port replaces the old one.
 */
export function useSlideshowSound(out: OutputAudio): void {
  useEffect(() => {
    let current: MessagePort | null = null
    const onMessage = (e: MessageEvent): void => {
      if (e.data !== 'slideshow:audio-port' || !e.ports[0]) return
      const port = e.ports[0]
      if (current && current !== port) current.close()
      current = port
      out
        .setPcmPort(port)
        .then((ok) => {
          // No sound path here: close the port so main's blocks are not queued unread.
          if (!ok && current === port) port.close()
        })
        .catch((err: unknown) => console.warn('[audio] PowerPoint sound failed:', err))
    }
    window.addEventListener('message', onMessage)
    window.api.requestSlideshowAudioPort()
    return () => {
      window.removeEventListener('message', onMessage)
      current?.close()
      current = null
      void out.setPcmPort(null)
    }
  }, [out])
}
