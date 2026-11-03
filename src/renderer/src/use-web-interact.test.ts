import { describe, expect, it } from 'vitest'
import { claimKeys, keyInputs, keysClaimed } from './use-web-interact'

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
