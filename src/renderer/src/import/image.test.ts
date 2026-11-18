import { describe, expect, it } from 'vitest'
import { imageSize } from './image'

describe('imageSize', () => {
  it('scales a wide image down to the import width, keeping the aspect', () => {
    expect(imageSize(4000, 3000, 1920)).toEqual({ width: 1920, height: 1440 })
    expect(imageSize(1920, 1080, 1920)).toEqual({ width: 1920, height: 1080 })
  })

  it('never upscales a small image', () => {
    expect(imageSize(640, 480, 1920)).toEqual({ width: 640, height: 480 })
  })

  it('refuses a size that cannot be drawn', () => {
    expect(() => imageSize(0, 480, 1920)).toThrow(/no usable size/)
    expect(() => imageSize(640, Number.NaN, 1920)).toThrow(/no usable size/)
  })
})
