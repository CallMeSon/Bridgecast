import { describe, it, expect } from 'vitest'
import { layerFor } from './components/layers'
import type { OutputMedia } from './model'

const video = (take: number): OutputMedia => ({
  kind: 'video',
  url: 'slide://d/001.mp4',
  poster: 'slide://d/001.png',
  take
})
const poster = { id: 'slide://d/001.png', kind: 'image', url: 'slide://d/001.png' }

describe('layerFor', () => {
  it('a new take gives a video layer', () => {
    expect(layerFor(video(4), new Set(), null)).toEqual({
      id: 'v:slide://d/001.mp4#4',
      kind: 'video',
      url: 'slide://d/001.mp4',
      poster: 'slide://d/001.png',
      take: 4
    })
  })
  it('a take already played and not on top (back from black or KV) gives the poster', () => {
    expect(layerFor(video(4), new Set([4]), null)).toEqual(poster)
    expect(layerFor(video(4), new Set([4]), 'slide://kv/k.png')).toEqual(poster)
  })
  it('the take on top stays a video (no swap after it ended)', () => {
    expect(layerFor(video(4), new Set([4]), 'v:slide://d/001.mp4#4')?.kind).toBe('video')
  })
  it('the next take on the same slide is a video again', () => {
    const l = layerFor(video(5), new Set([4]), 'slide://d/001.png')
    expect(l?.kind).toBe('video')
    expect(l?.id).toBe('v:slide://d/001.mp4#5')
  })
  it('an image is its url; null is null', () => {
    expect(layerFor({ kind: 'image', url: 'slide://d/002.png' }, new Set(), null)).toEqual({
      id: 'slide://d/002.png',
      kind: 'image',
      url: 'slide://d/002.png'
    })
    expect(layerFor(null, new Set([1]), 'x')).toBeNull()
  })
})
