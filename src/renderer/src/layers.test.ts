import { describe, it, expect } from 'vitest'
import { layerFor } from './components/layers'
import type { OutputMedia } from './model'

const video = (take: number): OutputMedia => ({
  kind: 'video',
  url: 'slide://d/001.mp4',
  poster: 'slide://d/001.png',
  take,
  fit: 'fit'
})
const poster = { id: 'slide://d/001.png', kind: 'image', url: 'slide://d/001.png', fit: 'fit' }

describe('layerFor', () => {
  it('a new take gives a video layer', () => {
    expect(layerFor(video(4), new Set(), null)).toEqual({
      id: 'v:slide://d/001.mp4#4',
      kind: 'video',
      url: 'slide://d/001.mp4',
      poster: 'slide://d/001.png',
      take: 4,
      fit: 'fit'
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
    expect(
      layerFor({ kind: 'image', url: 'slide://d/002.png', fit: 'fit' }, new Set(), null)
    ).toEqual({
      id: 'slide://d/002.png',
      kind: 'image',
      url: 'slide://d/002.png',
      fit: 'fit'
    })
    expect(layerFor(null, new Set([1]), 'x')).toBeNull()
  })
  it('keeps the fit, and the fit never changes the layer id', () => {
    const img = (fit: 'fit' | 'fill' | 'stretch'): OutputMedia => ({
      kind: 'image',
      url: 'slide://d/002.png',
      fit
    })
    expect(layerFor(img('fill'), new Set(), null)?.fit).toBe('fill')
    expect(layerFor(img('stretch'), new Set(), null)?.id).toBe(
      layerFor(img('fit'), new Set(), null)?.id
    )
    const v = { ...video(4), fit: 'fill' as const }
    expect(layerFor(v, new Set(), null)?.fit).toBe('fill')
    expect(layerFor(v, new Set(), null)?.id).toBe(layerFor(video(4), new Set(), null)?.id)
  })
  it('a stream has a stable id per deck and take; poster and pause never change it', () => {
    const s = (take: number, paused = false, poster = 'slide://w/001.png'): OutputMedia => ({
      kind: 'stream',
      source: 'tab',
      deckId: 'w',
      poster,
      paused,
      take
    })
    expect(layerFor(s(2), new Set(), null)).toEqual({
      id: 's:tab:w#2',
      kind: 'stream',
      source: 'tab',
      deckId: 'w',
      url: 'slide://w/001.png',
      poster: 'slide://w/001.png',
      paused: false,
      take: 2,
      fit: 'stretch'
    })
    expect(layerFor(s(2, true, 'slide://w/001.png?v=3'), new Set(), null)?.id).toBe('s:tab:w#2')
    // A stream is live: coming back after KV or Black captures again (never a poster swap).
    expect(layerFor(s(2), new Set([2]), 'slide://kv/k.png')?.kind).toBe('stream')
    expect(layerFor(s(3), new Set(), null)?.id).toBe('s:tab:w#3')
  })
  it('a poster for a played take keeps the fit', () => {
    const v = { ...video(4), fit: 'stretch' as const }
    expect(layerFor(v, new Set([4]), null)).toMatchObject({ kind: 'image', fit: 'stretch' })
  })
})
