import { useEffect } from 'react'
import { findMonitor, type OutputAudio } from './output-audio'

/**
 * LibreOffice's sound: while `wanted`, captures the private sink's monitor and plays it through
 * the output's gain (deck level x master, Local/OMT/Both like any video). Not found or refused:
 * nothing is connected (main already told the operator the sound plays on the default device).
 */
export function useLibreOfficeSound(out: OutputAudio, wanted: boolean): void {
  useEffect(() => {
    if (!wanted) return
    let stream: MediaStream | null = null
    let cancelled = false
    ;(async () => {
      const md = navigator.mediaDevices
      if (!md) return
      let devices = await md.enumerateDevices()
      let id = findMonitor(devices)
      if (!id) {
        // Labels are empty until the window has had one capture permission.
        const probe = await md.getUserMedia({ audio: true }).catch(() => null)
        probe?.getTracks().forEach((t) => t.stop())
        devices = await md.enumerateDevices()
        id = findMonitor(devices)
      }
      if (!id || cancelled) return
      const s = await md.getUserMedia({
        audio: {
          deviceId: { exact: id },
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false
        }
      })
      if (cancelled) {
        s.getTracks().forEach((t) => t.stop())
        return
      }
      if (out.attachStream(s)) stream = s
      else s.getTracks().forEach((t) => t.stop())
    })().catch((e: unknown) => console.warn('[audio] LibreOffice sound failed:', e))
    return () => {
      cancelled = true
      if (stream) {
        out.detachStream(stream)
        stream.getTracks().forEach((t) => t.stop())
      }
    }
  }, [out, wanted])
}
