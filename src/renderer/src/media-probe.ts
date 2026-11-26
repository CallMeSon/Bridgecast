import { MEDIA_UNPLAYABLE } from '../../shared/media'

export interface VideoProbe {
  duration: number
  width: number
  height: number
  /** PNG of a frame near the start. */
  poster: Uint8Array
}

const PROBE_TIMEOUT_MS = 15000

/** Loads `file` in a muted <video>: size, length and a poster frame. Rejects with MEDIA_UNPLAYABLE. */
export function probeVideo(file: File): Promise<VideoProbe> {
  const url = URL.createObjectURL(file)
  const v = document.createElement('video')
  let timer: ReturnType<typeof setTimeout> | undefined
  return new Promise<VideoProbe>((resolve, reject) => {
    const bad = (): void => reject(new Error(MEDIA_UNPLAYABLE))
    timer = setTimeout(bad, PROBE_TIMEOUT_MS)
    v.muted = true
    v.preload = 'metadata'
    v.onerror = bad
    v.onloadedmetadata = () => {
      if (!v.videoWidth || !Number.isFinite(v.duration) || v.duration <= 0) return bad()
      v.onseeked = () => {
        const c = document.createElement('canvas')
        c.width = v.videoWidth
        c.height = v.videoHeight
        c.getContext('2d')?.drawImage(v, 0, 0)
        c.toBlob(async (b) => {
          if (!b) return bad()
          resolve({
            duration: v.duration,
            width: v.videoWidth,
            height: v.videoHeight,
            poster: new Uint8Array(await b.arrayBuffer())
          })
        }, 'image/png')
      }
      v.currentTime = Math.min(1, v.duration * 0.1)
    }
    v.src = url
  }).finally(() => {
    clearTimeout(timer)
    v.removeAttribute('src')
    v.load()
    URL.revokeObjectURL(url)
  })
}
