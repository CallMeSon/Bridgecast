import { describe, expect, it } from 'vitest'
import { positionParts } from './transport'

describe('positionParts', () => {
  it('pads to two digits', () => {
    expect(positionParts(2, 12)).toEqual(['03', '12'])
    expect(positionParts(0, 3)).toEqual(['01', '03'])
  })
  it('widens to three digits for 100+ slides', () => {
    expect(positionParts(4, 120)).toEqual(['005', '120'])
  })
})
