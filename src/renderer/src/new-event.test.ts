import { describe, expect, it } from 'vitest'
import { checkEventName, EVENT_NAME_MAX } from './new-event'

describe('checkEventName', () => {
  it('trims', () => {
    expect(checkEventName('  Gala  ')).toEqual({ ok: true, name: 'Gala' })
  })
  it('refuses empty and blank', () => {
    expect(checkEventName('').ok).toBe(false)
    expect(checkEventName('   ').ok).toBe(false)
  })
  it('refuses too long, accepts the limit', () => {
    expect(checkEventName('a'.repeat(EVENT_NAME_MAX)).ok).toBe(true)
    expect(checkEventName('a'.repeat(EVENT_NAME_MAX + 1)).ok).toBe(false)
  })
  it('refuses a duplicate, ignoring case and spaces', () => {
    expect(checkEventName(' gala ', ['Gala']).ok).toBe(false)
  })
})
