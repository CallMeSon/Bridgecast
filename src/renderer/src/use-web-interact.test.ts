import { describe, expect, it } from 'vitest'
import {
  clampToBox,
  claimKeys,
  keyInputs,
  keysClaimed,
  leaveAt,
  releaseOutside
} from './use-web-interact'

/** A DOM key event, as far as the mapping reads it. */
function key(
  type: 'keydown' | 'keyup',
  k: string,
  mods: Partial<KeyboardEvent> = {}
): KeyboardEvent {
  return {
    type,
    key: k,
    shiftKey: false,
    ctrlKey: false,
    altKey: false,
    metaKey: false,
    ...mods
  } as KeyboardEvent
}

describe('keyInputs', () => {
  it('keydown of a character: the key, then the typed character', () => {
    expect(keyInputs(key('keydown', 'a'))).toEqual([
      { kind: 'key', type: 'keyDown', keyCode: 'a', modifiers: [] },
      { kind: 'key', type: 'char', keyCode: 'a', modifiers: [] }
    ])
  })
  it('keyup sends only the key', () => {
    expect(keyInputs(key('keyup', 'a'))).toEqual([
      { kind: 'key', type: 'keyUp', keyCode: 'a', modifiers: [] }
    ])
  })
  it('a navigation key has no character', () => {
    expect(keyInputs(key('keydown', 'ArrowRight'))).toEqual([
      { kind: 'key', type: 'keyDown', keyCode: 'ArrowRight', modifiers: [] }
    ])
  })
  it('a modifier alone sends nothing', () => {
    expect(keyInputs(key('keydown', 'Shift', { shiftKey: true }))).toEqual([])
  })
  it('Enter types a carriage return', () => {
    expect(keyInputs(key('keydown', 'Enter'))[1]).toMatchObject({ type: 'char', keyCode: '\r' })
  })
})

describe('claimKeys', () => {
  it('holds the keys until every claim is released', () => {
    expect(keysClaimed()).toBe(false)
    const first = claimKeys()
    const second = claimKeys()
    expect(keysClaimed()).toBe(true)
    first()
    expect(keysClaimed()).toBe(true)
    second()
    expect(keysClaimed()).toBe(false)
  })
  it('releasing twice does not count down past zero', () => {
    const one = claimKeys()
    const other = claimKeys()
    one()
    one()
    expect(keysClaimed()).toBe(true)
    other()
    expect(keysClaimed()).toBe(false)
  })
})

const box = (left: number, top: number, width: number, height: number): DOMRect =>
  ({ left, top, width, height, right: left + width, bottom: top + height }) as DOMRect

describe('release and leave against the visible bounds', () => {
  // The monitor screen is 100 x 100 at (0, 0); zoomed 2x on the centre, the drawn page is
  // 200 x 200 at (-50, -50).
  const screen = box(0, 0, 100, 100)
  const zoomed = box(-50, -50, 200, 200)

  it('clampToBox keeps an inside point and moves an outside one to the edge', () => {
    expect(clampToBox(40, 60, screen)).toEqual({ x: 40, y: 60 })
    expect(clampToBox(130, -5, screen)).toEqual({ x: 100, y: 0 })
  })

  it('a release inside the visible screen is left to the capture', () => {
    expect(releaseOutside({ clientX: 50, clientY: 50, button: 0 }, screen, zoomed)).toBeNull()
  })

  it('a release just outside the screen is outside, though inside the zoomed page', () => {
    expect(releaseOutside({ clientX: 120, clientY: 50, button: 0 }, screen, zoomed)).toEqual({
      kind: 'mouse',
      type: 'mouseUp',
      x: 0.75,
      y: 0.5,
      button: 'left',
      clickCount: 1
    })
  })

  it('without zoom the bounds are the page: the old clamp', () => {
    expect(releaseOutside({ clientX: -20, clientY: 150, button: 2 }, screen, screen)).toEqual({
      kind: 'mouse',
      type: 'mouseUp',
      x: 0,
      y: 1,
      button: 'right',
      clickCount: 1
    })
  })

  it('leaving reports the visible edge, mapped on the zoomed page', () => {
    expect(leaveAt(0, 50, screen, zoomed)).toEqual({
      kind: 'mouse',
      type: 'mouseLeave',
      x: 0.25,
      y: 0.5,
      button: 'left',
      clickCount: 0
    })
  })
})
