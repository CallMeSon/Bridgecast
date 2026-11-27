/**
 * The media player's clock (a video file deck on air). Main stamps every change with its own
 * time; each output window computes the position from it, so all outputs agree without
 * talking to each other.
 */
export interface MediaClock {
  playing: boolean
  /** Position in seconds at `since`. */
  at: number
  /** ms since epoch (main's clock) when `at` was true. */
  since: number
  loop: boolean
  /** Counts operator seeks (and restarts), so every window jumps even to the same spot. */
  seek: number
  /** Length in seconds; 0 = unknown. */
  duration: number
}

/** Video files that can be imported as a media deck (the browser must still decode them). */
export const MEDIA_FILE_RE = /\.(mp4|m4v|mov|webm|mkv|ogv)$/i

/** Content type a stored video is served with: what Chromium's demuxers recognise for it. */
export const MEDIA_MIME: Record<string, string> = {
  mp4: 'video/mp4',
  m4v: 'video/mp4',
  mov: 'video/mp4',
  webm: 'video/webm',
  mkv: 'video/webm',
  ogv: 'video/ogg'
}

export const MEDIA_UNPLAYABLE =
  'This video cannot play here. Convert it to MP4 (H.264), then import it again.'

/** Position in seconds at `now`: wrapped by the duration when looping, else held at the end. */
export function mediaPosition(m: MediaClock, now: number): number {
  const t = Math.max(0, m.playing ? m.at + Math.max(0, now - m.since) / 1000 : m.at)
  if (!(m.duration > 0)) return t
  return m.loop ? t % m.duration : Math.min(t, m.duration)
}

/** Played to the end (never while looping). */
export function mediaEnded(m: MediaClock, now: number): boolean {
  return !m.loop && m.duration > 0 && mediaPosition(m, now) >= m.duration
}

export function startClock(now: number, duration: number, loop = false): MediaClock {
  return { playing: true, at: 0, since: now, loop, seek: 0, duration }
}

/** '1:05' or '1:02:05'. */
export function formatTime(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const ss = String(s % 60).padStart(2, '0')
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`
}
