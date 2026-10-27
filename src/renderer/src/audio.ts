import { useEffect, useState } from 'react'

/**
 * The sink for a saved audio output. `''` is the default device for
 * `HTMLMediaElement.setSinkId`. A saved device that is no longer connected
 * falls back to the default and is reported `missing`, so the UI can say so.
 */
export function pickSink(
  saved: string | null,
  devices: { deviceId: string }[]
): { sinkId: string; missing: boolean } {
  if (saved === null) return { sinkId: '', missing: false }
  return devices.some((d) => d.deviceId === saved)
    ? { sinkId: saved, missing: false }
    : { sinkId: '', missing: true }
}

/** How long the output waits for its audio setup before it shows slides anyway. */
export const AUDIO_SETUP_MS = 1500

/**
 * Whether the output may render slides. Audio setup must never block them: the
 * gate opens once the settings (and, for a saved device, the device list) are
 * known, or at the latest when `timedOut`.
 */
export function outputGateOpen(
  audio: { deviceId: string | null } | null,
  outputs: unknown[] | null,
  timedOut: boolean
): boolean {
  if (timedOut) return true
  if (audio === null) return false
  return audio.deviceId === null || outputs !== null
}

/** Audio outputs for the device picker; null until the first listing arrives. */
export function useAudioOutputs(): { deviceId: string; label: string }[] | null {
  // No media API at all: an empty list, never an error.
  const [outputs, setOutputs] = useState<{ deviceId: string; label: string }[] | null>(() =>
    navigator.mediaDevices ? null : []
  )
  useEffect(() => {
    const md: MediaDevices | undefined = navigator.mediaDevices
    if (!md) return
    let alive = true
    const refresh = (): void => {
      md.enumerateDevices()
        .then((all) => {
          if (alive) setOutputs(audioOutputs(all))
        })
        .catch((e: unknown) => {
          console.warn('[audio] could not list audio devices:', e)
          if (alive) setOutputs([])
        })
    }
    refresh()
    md.addEventListener('devicechange', refresh)
    return () => {
      alive = false
      md.removeEventListener('devicechange', refresh)
    }
  }, [])
  return outputs
}

/**
 * The real audio outputs of an `enumerateDevices` listing. Chromium adds the
 * virtual 'default' and 'communications' entries on Windows; they are the same
 * devices as the real ones, so they are left out ("Default (Windows)" covers them).
 */
export function audioOutputs(all: MediaDeviceInfo[]): { deviceId: string; label: string }[] {
  return all
    .filter(
      (d) => d.kind === 'audiooutput' && d.deviceId !== 'default' && d.deviceId !== 'communications'
    )
    .map((d) => ({ deviceId: d.deviceId, label: d.label }))
}
