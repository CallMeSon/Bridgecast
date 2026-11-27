import { describe, expect, it } from 'vitest'
import {
  SEEK_IDLE,
  keySeek,
  seekDrag,
  seekRelease,
  seekSettle,
  seekShown,
  timeAtFraction
} from './media-seek'

describe('seek maths', () => {
  it('maps pointer fraction exactly and clamps', () => {
    expect(timeAtFraction(0.25, 80)).toBe(20)
    expect(timeAtFraction(-1, 80)).toBe(0)
    expect(timeAtFraction(2, 80)).toBe(80)
  })
  it('keys step 1 s and 10 s within bounds', () => {
    expect(keySeek('ArrowRight', 5.5, 60)).toBe(6.5)
    expect(keySeek('PageDown', 5, 60)).toBe(0)
    expect(keySeek('PageUp', 55, 60)).toBe(60)
    expect(keySeek('Home', 5, 60)).toBeNull()
  })
})

describe('media seek view', () => {
  it('follows the clock when idle', () => expect(seekShown(SEEK_IDLE, 7)).toBe(7))
  it('shows the drag value while dragging', () =>
    expect(seekShown(seekDrag(SEEK_IDLE, 3), 7)).toBe(3))
  it('keeps the released value until the seek counter advances', () => {
    let v = seekRelease(3, 4)
    expect(seekShown(v, 7)).toBe(3)
    v = seekSettle(v, 4)
    expect(seekShown(v, 7)).toBe(3)
    v = seekSettle(v, 5)
    expect(seekShown(v, 7)).toBe(7)
  })
  it('a new drag overrides a pending value', () => {
    expect(seekShown(seekDrag(seekRelease(3, 0), 9), 1)).toBe(9)
  })
})
