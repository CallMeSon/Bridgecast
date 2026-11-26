import { mediaEnded, mediaPosition, type MediaClock } from '../../shared/media'

/** The part of an HTMLVideoElement the sync touches (so tests need no DOM). */
export interface SyncVideo {
  currentTime: number
  loop: boolean
  paused: boolean
  play(): Promise<void>
  pause(): void
}

/** What one element last applied: the clock's seek counter (null = not synced yet). */
export interface MediaSyncState {
  seek: number | null
}

/** A jump smaller than this is left to the player (decoder jitter, small clock skew). */
export const DRIFT_S = 0.5

/**
 * Puts a video element on the shared clock. Jumps when the operator seeked (new `seek`
 * counter) or the element drifted; the first sync of a take that starts in its first
 * second keeps the element at 0 so load time never cuts the start of the clip.
 * Returns the play() promise (reject = the caller's failure path), else undefined.
 */
export function syncMedia(
  v: SyncVideo,
  clock: MediaClock,
  st: MediaSyncState,
  now: number = Date.now()
): Promise<void> | undefined {
  const target = mediaPosition(clock, now)
  v.loop = clock.loop
  const first = st.seek === null
  const jump = st.seek !== clock.seek || Math.abs(v.currentTime - target) > DRIFT_S
  if (jump && !(first && target < 1)) v.currentTime = target
  st.seek = clock.seek
  if (clock.playing && !mediaEnded(clock, now)) return v.play()
  v.pause()
  return undefined
}
