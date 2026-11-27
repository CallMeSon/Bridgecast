import { describe, expect, it } from 'vitest'
import { syncMedia, type MediaSyncState, type SyncVideo } from './media-sync'
import type { MediaClock } from '../../shared/media'

const clock = (p: Partial<MediaClock> = {}): MediaClock => ({
  playing: true,
  at: 0,
  since: 1000,
  loop: false,
  seek: 0,
  duration: 60,
  ...p
})
const fake = (currentTime = 0): SyncVideo & { plays: number; pauses: number } => {
  const v = {
    currentTime,
    loop: false,
    paused: true,
    plays: 0,
    pauses: 0,
    play() {
      v.plays++
      return Promise.resolve()
    },
    pause() {
      v.pauses++
    }
  }
  return v
}
const fresh = (): MediaSyncState => ({ seek: null })

describe('syncMedia', () => {
  it('first sync near the start keeps 0 and plays', () => {
    const v = fake(0)
    syncMedia(v, clock(), fresh(), 1300)
    expect(v.currentTime).toBe(0)
    expect(v.plays).toBe(1)
  })
  it('first sync late in the clip jumps to the clock position', () => {
    const v = fake(0)
    syncMedia(v, clock(), fresh(), 11000)
    expect(v.currentTime).toBeCloseTo(10)
  })
  it('a new seek counter jumps, same counter within drift does not', () => {
    const v = fake(0)
    const st = fresh()
    syncMedia(v, clock(), st, 1000)
    v.currentTime = 5
    syncMedia(v, clock({ at: 5.2, since: 1000 }), st, 1000)
    expect(v.currentTime).toBe(5)
    syncMedia(v, clock({ at: 5.2, since: 1000, seek: 1 }), st, 1000)
    expect(v.currentTime).toBeCloseTo(5.2)
  })
  it('drift over 0.5 s jumps', () => {
    const v = fake(0)
    const st = fresh()
    syncMedia(v, clock(), st, 1000)
    v.currentTime = 2
    syncMedia(v, clock(), st, 4000)
    expect(v.currentTime).toBeCloseTo(3)
  })
  it('paused clock pauses and sets loop', () => {
    const v = fake(0)
    syncMedia(v, clock({ playing: false, loop: true, at: 3 }), fresh(), 9000)
    expect(v.pauses).toBe(1)
    expect(v.plays).toBe(0)
    expect(v.loop).toBe(true)
    expect(v.currentTime).toBe(3)
  })
  it('ended holds the last frame', () => {
    const v = fake(0)
    syncMedia(v, clock({ duration: 10 }), fresh(), 99000)
    expect(v.currentTime).toBe(10)
    expect(v.pauses).toBe(1)
    expect(v.plays).toBe(0)
  })
})
