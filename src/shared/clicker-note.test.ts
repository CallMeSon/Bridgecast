import { describe, expect, it } from 'vitest'
import { clickerNote } from './clicker'

const s = { enabled: true, active: false, failed: [] as string[], wayland: false }

describe('clickerNote', () => {
  it('is silent when all keys were claimed or the setting is off', () => {
    expect(clickerNote(s)).toBeNull()
    expect(clickerNote({ ...s, enabled: false, failed: ['PageUp'] })).toBeNull()
  })
  it('names the keys that could not be claimed', () => {
    expect(clickerNote({ ...s, failed: ['PageUp', 'Left arrow'] })).toContain('PageUp, Left arrow')
  })
  it('mentions Wayland on Linux sessions', () => {
    expect(clickerNote({ ...s, failed: ['PageUp'], wayland: true })).toContain('Wayland')
  })
})
