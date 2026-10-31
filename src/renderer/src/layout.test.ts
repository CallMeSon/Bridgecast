import { describe, expect, it } from 'vitest'
import {
  clampSize,
  defaultLayout,
  limits,
  parseStored,
  resolveLayout,
  serializeStored,
  STEP
} from './layout'

const cur = { left: 256, right: 320, strip: 176 }

describe('defaultLayout', () => {
  it('uses the wide defaults above 1179px and the tight ones below', () => {
    expect(defaultLayout(1600)).toEqual({ left: 288, right: 352, strip: 176 })
    expect(defaultLayout(1179)).toEqual({ left: 256, right: 288, strip: 176 })
  })
})

describe('limits', () => {
  it('keeps side panels at 200 and Program at 420 at least', () => {
    expect(limits('left', cur, 1600, 900)).toEqual({ min: 200, max: 1600 - 320 - 420 })
    expect(limits('right', cur, 1600, 900)).toEqual({ min: 200, max: 1600 - 256 - 420 })
  })
  it('bounds the strip between 120 and 40% of the height', () => {
    expect(limits('strip', cur, 1600, 900)).toEqual({ min: 120, max: 360 })
    expect(limits('strip', cur, 1600, 200)).toEqual({ min: 120, max: 120 })
  })
  it('never lets max fall below min in a tiny window', () => {
    expect(limits('left', { left: 200, right: 200, strip: 120 }, 700, 500)).toEqual({
      min: 200,
      max: 200
    })
  })
})

describe('clampSize', () => {
  it('rounds and clamps', () => {
    expect(clampSize('left', 50, cur, 1600, 900)).toBe(200)
    expect(clampSize('left', 9999, cur, 1600, 900)).toBe(860)
    expect(clampSize('left', 300.4, cur, 1600, 900)).toBe(300)
    expect(clampSize('strip', 10, cur, 1600, 900)).toBe(120)
  })
  it('exposes a 16px keyboard step', () => expect(STEP).toBe(16))
})

describe('parseStored', () => {
  it('reads valid numbers only', () => {
    expect(parseStored('{"left":300,"right":260,"strip":150}')).toEqual({
      left: 300,
      right: 260,
      strip: 150
    })
    expect(parseStored('{"left":"x","right":-5,"strip":null,"extra":1}')).toEqual({})
  })
  it('ignores garbage', () => {
    expect(parseStored(null)).toEqual({})
    expect(parseStored('not json')).toEqual({})
    expect(parseStored('[1,2]')).toEqual({})
    expect(parseStored('7')).toEqual({})
  })
  it('round-trips through serializeStored', () => {
    expect(parseStored(serializeStored({ left: 300, strip: 176 }))).toEqual({
      left: 300,
      strip: 176
    })
  })
})

describe('resolveLayout', () => {
  it('falls back to defaults', () => {
    expect(resolveLayout({}, 1600, 900)).toEqual({ left: 288, right: 352, strip: 176 })
  })
  it('keeps stored sizes that fit', () => {
    expect(resolveLayout({ left: 400, strip: 200 }, 1600, 900)).toEqual({
      left: 400,
      right: 352,
      strip: 200
    })
  })
  it('shrinks the right panel first when the window gets narrow', () => {
    expect(resolveLayout({ left: 500, right: 400 }, 1200, 900)).toMatchObject({
      left: 500,
      right: 280
    })
  })
  it('then shrinks the left panel, never below 200', () => {
    expect(resolveLayout({ left: 600, right: 400 }, 900, 900)).toMatchObject({
      left: 280,
      right: 200
    })
    expect(resolveLayout({ left: 600, right: 400 }, 600, 900)).toMatchObject({
      left: 200,
      right: 200
    })
  })
  it('clamps the strip to 40% of a short window', () => {
    expect(resolveLayout({ strip: 400 }, 1280, 720).strip).toBe(288)
    expect(resolveLayout({ strip: 20 }, 1280, 720).strip).toBe(120)
  })
})
