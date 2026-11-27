import { describe, expect, it } from 'vitest'
import { GlobalClicker, type ClickerDeps } from './clicker'
import type { Action } from '../shared/program'

// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
function rig(taken: string[] = []) {
  const reg = new Map<string, () => void>()
  const dispatched: Action[] = []
  const warns: string[] = []
  const st = { enabled: true, open: true, focused: false }
  const d: ClickerDeps = {
    register: (a, cb) => {
      if (taken.includes(a)) return false
      reg.set(a, cb)
      return true
    },
    unregister: (a) => void reg.delete(a),
    dispatch: (a) => void dispatched.push(a),
    enabled: () => st.enabled,
    operatorOpen: () => st.open,
    bridgecastFocused: () => st.focused,
    wayland: false,
    onChange: () => {},
    warn: (m) => void warns.push(m)
  }
  return { c: new GlobalClicker(d), reg, dispatched, warns, st }
}

describe('GlobalClicker', () => {
  it('registers four keys when in the background and releases them on focus', () => {
    const { c, reg, st } = rig()
    c.sync()
    expect([...reg.keys()].sort()).toEqual(['Left', 'PageDown', 'PageUp', 'Right'])
    expect(c.status().active).toBe(true)
    st.focused = true
    c.sync()
    expect(reg.size).toBe(0)
    expect(c.status().active).toBe(false)
  })

  it('does not register when the setting is off, and releases when turned off', () => {
    const { c, reg, st } = rig()
    st.enabled = false
    c.sync()
    expect(reg.size).toBe(0)
    st.enabled = true
    c.sync()
    st.enabled = false
    c.sync()
    expect(reg.size).toBe(0)
  })

  it('a pressed key dispatches the in-window action', () => {
    const { c, reg, dispatched } = rig()
    c.sync()
    reg.get('PageDown')!()
    reg.get('Left')!()
    expect(dispatched).toEqual([{ type: 'next' }, { type: 'prev' }])
  })

  it('names the keys another app kept and keeps the others', () => {
    const { c, reg, warns } = rig(['PageUp', 'Right'])
    c.sync()
    expect(c.status().failed).toEqual(['Right arrow', 'PageUp'])
    expect([...reg.keys()].sort()).toEqual(['Left', 'PageDown'])
    expect(warns).toHaveLength(1)
  })

  it('a throwing register counts as failed and never throws', () => {
    const r = rig()
    const c = new GlobalClicker({
      ...{
        register: () => {
          throw new Error('wayland')
        },
        unregister: () => {},
        dispatch: () => {},
        enabled: () => true,
        operatorOpen: () => true,
        bridgecastFocused: () => false,
        wayland: true,
        onChange: () => {},
        warn: () => {}
      }
    })
    expect(() => c.sync()).not.toThrow()
    expect(c.status().failed).toHaveLength(4)
    expect(r.reg.size).toBe(0)
  })

  it('dispose releases every key', () => {
    const { c, reg } = rig()
    c.sync()
    c.dispose()
    expect(reg.size).toBe(0)
  })
})
