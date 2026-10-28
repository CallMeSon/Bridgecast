import { describe, it, expect } from 'vitest'
import {
  capturesForGate,
  desktopConstraints,
  posterWithVersion,
  precaptureIds,
  recaptureNeeded,
  streamFps,
  tabConstraints
} from './stream'

const canvas = { width: 1920, height: 1080 }

describe('tabConstraints', () => {
  it('video and audio both name the tab source and the same id (spike shape)', () => {
    expect(tabConstraints('id-1', canvas, 30, true)).toEqual({
      video: {
        mandatory: {
          chromeMediaSource: 'tab',
          chromeMediaSourceId: 'id-1',
          maxWidth: 1920,
          maxHeight: 1080,
          maxFrameRate: 30
        }
      },
      audio: { mandatory: { chromeMediaSource: 'tab', chromeMediaSourceId: 'id-1' } }
    })
  })
  it('video only has no audio key at all', () => {
    const c = tabConstraints('id-2', { width: 3840, height: 1080 }, 60, false)
    expect('audio' in c).toBe(false)
    expect(c.video).toEqual({
      mandatory: {
        chromeMediaSource: 'tab',
        chromeMediaSourceId: 'id-2',
        maxWidth: 3840,
        maxHeight: 1080,
        maxFrameRate: 60
      }
    })
  })
  it('keeps the size and frame rate in range', () => {
    const v = (c: MediaStreamConstraints): Record<string, unknown> =>
      (c.video as { mandatory: Record<string, unknown> }).mandatory
    expect(v(tabConstraints('x', { width: 0, height: -5 }, 0, false))).toMatchObject({
      maxWidth: 1,
      maxHeight: 1,
      maxFrameRate: 1
    })
    expect(v(tabConstraints('x', { width: 99999, height: 1080.6 }, 240, false))).toMatchObject({
      maxWidth: 7680,
      maxHeight: 1081,
      maxFrameRate: 60
    })
    expect(v(tabConstraints('x', canvas, Number.NaN, false)).maxFrameRate).toBe(30)
  })
})

describe('desktopConstraints', () => {
  it('video only, from the desktop source, capped at the canvas and fps', () => {
    const c = desktopConstraints('window:1324:0', canvas, 30)
    expect('audio' in c).toBe(false)
    expect(c).toEqual({
      video: {
        mandatory: {
          chromeMediaSource: 'desktop',
          chromeMediaSourceId: 'window:1324:0',
          maxWidth: 1920,
          maxHeight: 1080,
          maxFrameRate: 30
        }
      }
    })
  })
  it('keeps the size and frame rate in range', () => {
    const m = (c: MediaStreamConstraints): Record<string, unknown> =>
      (c.video as { mandatory: Record<string, unknown> }).mandatory
    expect(m(desktopConstraints('x', { width: 0, height: 99999 }, 240))).toMatchObject({
      maxWidth: 1,
      maxHeight: 7680,
      maxFrameRate: 60
    })
    expect(m(desktopConstraints('x', canvas, Number.NaN)).maxFrameRate).toBe(30)
  })
})

describe('streamFps', () => {
  it('is the network frame rate while a network output runs, else 30', () => {
    expect(streamFps(60, true)).toBe(60)
    expect(streamFps(60, false)).toBe(30)
    expect(streamFps(30, true)).toBe(30)
    expect(streamFps(undefined, true)).toBe(30)
  })
})

describe('capturesForGate', () => {
  it('an output window captures for the gate only while it is active', () => {
    expect(capturesForGate('hdmi', { hdmi: true, omt: false })).toBe(true)
    expect(capturesForGate('hdmi', { hdmi: false, omt: true })).toBe(false)
    expect(capturesForGate('omt', { hdmi: true, omt: true })).toBe(true)
    expect(capturesForGate('omt', { hdmi: true, omt: false })).toBe(false)
  })
  it('the operator window captures only while no output is active', () => {
    expect(capturesForGate('operator', { hdmi: false, omt: false })).toBe(true)
    expect(capturesForGate('operator', { hdmi: true, omt: false })).toBe(false)
    expect(capturesForGate('operator', { hdmi: false, omt: true })).toBe(false)
  })
  it('unknown output state counts as no output (the operator captures)', () => {
    expect(capturesForGate('operator', null)).toBe(true)
    expect(capturesForGate('hdmi', null)).toBe(false)
  })
})

describe('precaptureIds', () => {
  it('pages still loading, except the one this window already streams, sorted', () => {
    expect(
      precaptureIds({ b: 'loading', a: 'loading', c: 'ready', d: 'error', e: 'loading' }, 'e')
    ).toEqual(['a', 'b'])
    expect(precaptureIds({}, null)).toEqual([])
  })
})

describe('recaptureNeeded', () => {
  it('a page coming back from an error (crash reload, Reload) needs a new capture', () => {
    expect(recaptureNeeded('error', 'loading')).toBe(true)
    expect(recaptureNeeded('error', 'ready')).toBe(true)
  })
  it('anything else keeps the capture', () => {
    expect(recaptureNeeded(undefined, 'loading')).toBe(false)
    expect(recaptureNeeded('loading', 'ready')).toBe(false)
    expect(recaptureNeeded('ready', 'loading')).toBe(false)
    expect(recaptureNeeded('ready', 'error')).toBe(false)
    expect(recaptureNeeded('error', 'error')).toBe(false)
  })
})

describe('posterWithVersion', () => {
  it('adds ?v=<n> so the same file name loads again', () => {
    expect(posterWithVersion('slide://d/001.png', 3)).toBe('slide://d/001.png?v=3')
    expect(posterWithVersion('slide://d/001.png', 0)).toBe('slide://d/001.png')
  })
})
