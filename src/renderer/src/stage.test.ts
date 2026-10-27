import { describe, it, expect } from 'vitest'
import { stageRect } from './stage'

describe('stageRect', () => {
  it('a canvas wider than the window is letterboxed top and bottom', () => {
    expect(stageRect({ width: 3840, height: 1080 }, { width: 1920, height: 1080 })).toEqual({
      width: 1920,
      height: 540,
      left: 0,
      top: 270
    })
  })
  it('the same aspect fills the window', () => {
    expect(stageRect({ width: 1920, height: 1080 }, { width: 1920, height: 1080 })).toEqual({
      width: 1920,
      height: 1080,
      left: 0,
      top: 0
    })
  })
  it('a portrait canvas is pillarboxed left and right', () => {
    expect(stageRect({ width: 1080, height: 1920 }, { width: 1920, height: 1080 })).toEqual({
      width: 607.5,
      height: 1080,
      left: 656.25,
      top: 0
    })
  })
  it('a window with no size gives an empty rect instead of NaN', () => {
    expect(stageRect({ width: 1920, height: 1080 }, { width: 0, height: 0 })).toEqual({
      width: 0,
      height: 0,
      left: 0,
      top: 0
    })
  })
})
