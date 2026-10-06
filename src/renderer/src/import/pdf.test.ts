import { describe, it, expect } from 'vitest'
import { scaleForWidth } from './scale'

describe('scaleForWidth', () => {
  it('scales page width to target width', () => {
    expect(scaleForWidth(960, 1920)).toBe(2)
  })
  it('throws on zero width', () => {
    expect(() => scaleForWidth(0, 1920)).toThrow()
  })
})
