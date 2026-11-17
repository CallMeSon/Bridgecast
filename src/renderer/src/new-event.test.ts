import { describe, expect, it } from 'vitest'
import { addDeckFiles, checkEventName, EVENT_NAME_MAX } from './new-event'

describe('addDeckFiles', () => {
  const f = (name: string, size = 1): { name: string; size: number } => ({ name, size })

  it('keeps only PPTX, PPT and PDF and counts the rest', () => {
    const r = addDeckFiles([], [f('a.pptx'), f('b.PPT'), f('c.pdf'), f('notes.txt'), f('d.png')])
    expect(r.files.map((x) => x.name)).toEqual(['a.pptx', 'b.PPT', 'c.pdf'])
    expect(r.skipped).toBe(2)
  })

  it('orders names naturally and never lists the same file twice', () => {
    const first = addDeckFiles([], [f('10 Closing.pdf'), f('2 Opening.pptx')])
    expect(first.files.map((x) => x.name)).toEqual(['2 Opening.pptx', '10 Closing.pdf'])
    const again = addDeckFiles(first.files, [f('2 Opening.pptx'), f('2 Opening.pptx', 9)])
    expect(again.files).toHaveLength(3)
    expect(again.skipped).toBe(0)
  })
})

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
