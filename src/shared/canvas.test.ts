import { describe, expect, it } from 'vitest'
import {
  CANVAS_CHANGE_LIVE,
  CANVAS_INVALID,
  CANVAS_NO_HDMI,
  CANVAS_DISPLAY_TOO_LARGE,
  CANVAS_PRESETS,
  DEFAULT_CANVAS,
  DECK_FITS,
  canvasLabel,
  contentRect,
  displayCanvas,
  isDeckFit,
  resolveCanvas,
  sanitizeCanvas,
  sanitizeFit,
  type Canvas
} from './canvas'

describe('sanitizeCanvas', () => {
  it('keeps valid even sizes', () => {
    expect(sanitizeCanvas({ width: 1920, height: 1080 })).toEqual({ width: 1920, height: 1080 })
    expect(sanitizeCanvas({ width: 3840, height: 1080 })).toEqual({ width: 3840, height: 1080 })
  })

  it('rounds each side down to an even number', () => {
    expect(sanitizeCanvas({ width: 1921, height: 1081 })).toEqual({ width: 1920, height: 1080 })
    expect(sanitizeCanvas({ width: 1920.9, height: 1080.5 })).toEqual({ width: 1920, height: 1080 })
  })

  it('rounds down before the range check, so an over-limit side is capped at the maximum', () => {
    expect(sanitizeCanvas({ width: 7681, height: 400 })).toEqual({ width: 7680, height: 400 })
    expect(sanitizeCanvas({ width: 3840, height: 2161 })).toEqual({ width: 3840, height: 2160 })
  })

  it('rejects a canvas over 3840×2160 in total', () => {
    expect(sanitizeCanvas({ width: 3842, height: 2160 })).toBeNull()
  })

  it('rejects a side under 320 (also after rounding down)', () => {
    expect(sanitizeCanvas({ width: 318, height: 1080 })).toBeNull()
    expect(sanitizeCanvas({ width: 321, height: 1080 })).toEqual({ width: 320, height: 1080 })
    expect(sanitizeCanvas({ width: 1920, height: 319 })).toBeNull()
  })

  it('rejects zero, negative, non-numeric and non-finite sizes', () => {
    expect(sanitizeCanvas({ width: 0, height: 1080 })).toBeNull()
    expect(sanitizeCanvas({ width: -5, height: 1080 })).toBeNull()
    expect(sanitizeCanvas({ width: 'abc', height: 1080 })).toBeNull()
    expect(sanitizeCanvas({ width: NaN, height: 1080 })).toBeNull()
    expect(sanitizeCanvas({ width: Infinity, height: 1080 })).toBeNull()
    expect(sanitizeCanvas({ width: 1920 })).toBeNull()
  })

  it('rejects things that are not a canvas object', () => {
    for (const raw of [null, undefined, [], 'x', 7, true]) expect(sanitizeCanvas(raw)).toBeNull()
  })
})

describe('resolveCanvas', () => {
  const machine: Canvas = { width: 1920, height: 1080 }

  it('uses the machine canvas when the event has no override', () => {
    expect(resolveCanvas(undefined, machine)).toEqual({
      width: 1920,
      height: 1080,
      origin: 'default'
    })
    expect(resolveCanvas(null, machine)).toEqual({ width: 1920, height: 1080, origin: 'default' })
  })

  it('uses the event override when valid', () => {
    expect(resolveCanvas({ width: 3840, height: 1080 }, machine)).toEqual({
      width: 3840,
      height: 1080,
      origin: 'event'
    })
  })

  it('ignores an invalid override', () => {
    expect(resolveCanvas({ width: 1, height: 1 } as Canvas, machine)).toEqual({
      width: 1920,
      height: 1080,
      origin: 'default'
    })
  })

  it('sanitizes the override itself (odd sizes are rounded down)', () => {
    expect(resolveCanvas({ width: 3841, height: 1081 }, machine)).toEqual({
      width: 3840,
      height: 1080,
      origin: 'event'
    })
  })
})

describe('canvasLabel / displayCanvas', () => {
  it('labels both origins with the multiplication sign', () => {
    expect(canvasLabel({ width: 3840, height: 1080, origin: 'event' })).toBe('3840×1080 (event)')
    expect(canvasLabel({ width: 1920, height: 1080, origin: 'default' })).toBe(
      '1920×1080 (default)'
    )
  })

  it('displayCanvas sanitizes a display size and passes null through', () => {
    expect(displayCanvas({ width: 5760, height: 1080 })).toEqual({ width: 5760, height: 1080 })
    expect(displayCanvas({ width: 1921, height: 1081 })).toEqual({ width: 1920, height: 1080 })
    expect(displayCanvas(null)).toBeNull()
    // A connected display over the pixel budget has no matching canvas either.
    expect(displayCanvas({ width: 5120, height: 2880 })).toBeNull()
  })
})

describe('constants', () => {
  it('has the default, presets and exact messages', () => {
    expect(DEFAULT_CANVAS).toEqual({ width: 1920, height: 1080 })
    expect(CANVAS_PRESETS).toEqual([
      { width: 1920, height: 1080 },
      { width: 3840, height: 2160 },
      { width: 1280, height: 720 }
    ])
    expect(CANVAS_INVALID).toBe(
      'Use a width and height from 320 to 7680 pixels, at most 3840×2160 in total.'
    )
    expect(CANVAS_NO_HDMI).toBe('Connect the HDMI display first.')
    expect(CANVAS_DISPLAY_TOO_LARGE).toBe(
      'This display is larger than 3840×2160 in total. Use Custom instead.'
    )
    expect(CANVAS_CHANGE_LIVE).toBe(
      'Changing the canvas changes what the audience sees. Change it now?'
    )
  })
})

describe('deck fit', () => {
  it('sanitizeFit keeps a valid fit and falls back to fit', () => {
    expect(sanitizeFit('fill')).toBe('fill')
    expect(sanitizeFit('stretch')).toBe('stretch')
    expect(sanitizeFit('cover')).toBe('fit')
    expect(sanitizeFit(undefined)).toBe('fit')
  })

  it('isDeckFit is a type guard over DECK_FITS', () => {
    expect(DECK_FITS).toEqual(['fit', 'fill', 'stretch'])
    expect(isDeckFit('stretch')).toBe(true)
    expect(isDeckFit('x')).toBe(false)
  })
})

describe('contentRect', () => {
  const HD: Canvas = { width: 1920, height: 1080 }
  const whole = { x: 0, y: 0, width: 1920, height: 1080 }

  it('centres a 4:3 slide with black bars left and right', () => {
    expect(contentRect(HD, { width: 4000, height: 3000 }, 'fit')).toEqual({
      x: 240,
      y: 0,
      width: 1440,
      height: 1080
    })
  })

  it('gives the whole canvas for a 16:9 slide', () => {
    expect(contentRect(HD, { width: 1600, height: 900 }, 'fit')).toEqual(whole)
  })

  it('gives full width and bars top and bottom for a 2:1 slide, with even numbers', () => {
    expect(contentRect(HD, { width: 2000, height: 1000 }, 'fit')).toEqual({
      x: 0,
      y: 60,
      width: 1920,
      height: 960
    })
  })

  it('gives the whole canvas for fill and stretch', () => {
    expect(contentRect(HD, { width: 4000, height: 3000 }, 'fill')).toEqual(whole)
    expect(contentRect(HD, { width: 4000, height: 3000 }, 'stretch')).toEqual(whole)
  })

  it('gives the whole canvas for null content (KV, Black, web, streams)', () => {
    expect(contentRect(HD, null, 'fit')).toEqual(whole)
  })

  it('gives the whole canvas for zero, negative, NaN or infinite content sizes', () => {
    const bad = [
      { width: 0, height: 3000 },
      { width: 4000, height: 0 },
      { width: -4000, height: 3000 },
      { width: NaN, height: 1080 },
      { width: 4000, height: Infinity }
    ]
    for (const content of bad) expect(contentRect(HD, content, 'fit')).toEqual(whole)
  })

  it('centres a 4:3 slide on an ultrawide canvas', () => {
    expect(
      contentRect({ width: 3840, height: 1080 }, { width: 4000, height: 3000 }, 'fit')
    ).toEqual({ x: 1200, y: 0, width: 1440, height: 1080 })
  })

  it('keeps every side and offset even and inside the canvas', () => {
    const canvases: Canvas[] = [
      { width: 1920, height: 1080 },
      { width: 1280, height: 720 },
      { width: 3840, height: 2160 },
      { width: 3840, height: 1080 },
      { width: 320, height: 1080 },
      { width: 1080, height: 1920 },
      { width: 1000, height: 750 }
    ]
    const decks = [
      { width: 4000, height: 3000 },
      { width: 2000, height: 1000 },
      { width: 1600, height: 900 },
      { width: 1, height: 10000 },
      { width: 10000, height: 1 },
      { width: 1080, height: 1920 },
      { width: 1234, height: 567 },
      { width: 3, height: 7 }
    ]
    for (const canvas of canvases) {
      for (const deck of decks) {
        const r = contentRect(canvas, deck, 'fit')
        expect(r.width % 2).toBe(0)
        expect(r.height % 2).toBe(0)
        expect(r.x % 2).toBe(0)
        expect(r.y % 2).toBe(0)
        expect(r.width).toBeGreaterThanOrEqual(2)
        expect(r.height).toBeGreaterThanOrEqual(2)
        expect(r.x).toBeGreaterThanOrEqual(0)
        expect(r.y).toBeGreaterThanOrEqual(0)
        expect(r.x + r.width).toBeLessThanOrEqual(canvas.width)
        expect(r.y + r.height).toBeLessThanOrEqual(canvas.height)
      }
    }
  })
})
