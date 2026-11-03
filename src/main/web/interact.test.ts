import { describe, expect, it } from 'vitest'
import { InteractSwitches } from './interact'

type Owner = { name: string }

describe('InteractSwitches', () => {
  const operator: Owner = { name: 'operator' }
  const prepare: Owner = { name: 'prepare' }

  it('turns a switch on and off per deck', () => {
    const s = new InteractSwitches<Owner>()
    s.set('a', operator)
    expect(s.has('a')).toBe(true)
    expect(s.has('b')).toBe(false)
    s.clear('a')
    expect(s.has('a')).toBe(false)
  })

  it('keeps a switch while its deck stays on air in the same event', () => {
    const s = new InteractSwitches<Owner>()
    s.sync('ev', 'a')
    s.set('a', operator)
    s.sync('ev', 'a')
    expect(s.has('a')).toBe(true)
  })

  it('drops a switch as soon as its deck is no longer on air', () => {
    const s = new InteractSwitches<Owner>()
    s.sync('ev', 'a')
    s.set('a', operator)
    s.sync('ev', 'b')
    expect(s.has('a')).toBe(false)
    s.sync('ev', null)
    s.set('b', operator)
    s.sync('ev', null)
    expect(s.has('b')).toBe(false)
  })

  it('drops every switch when the open event changes', () => {
    const s = new InteractSwitches<Owner>()
    s.sync('ev1', 'a')
    s.set('a', operator)
    s.sync('ev2', 'a')
    expect(s.has('a')).toBe(false)
  })

  it('drops the switches of a window that closed or navigated, and keeps the others', () => {
    const s = new InteractSwitches<Owner>()
    s.sync('ev', 'a')
    s.set('a', prepare)
    s.releaseOwner(operator)
    expect(s.has('a')).toBe(true)
    s.releaseOwner(prepare)
    expect(s.has('a')).toBe(false)
  })
})
