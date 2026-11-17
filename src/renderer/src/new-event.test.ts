import { describe, expect, it } from 'vitest'
import {
  addDeckFiles,
  canvasChoices,
  canvasOfChoice,
  checkEventName,
  EVENT_NAME_MAX
} from './new-event'

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

describe('canvasChoices', () => {
  it('lists the default with its size, the presets, the display and Custom', () => {
    const list = canvasChoices({ width: 1920, height: 1080 }, { width: 2560, height: 1440 })
    expect(list.map((c) => c.value)).toEqual([
      'default',
      '1920x1080',
      '3840x2160',
      '1280x720',
      'match',
      'custom'
    ])
    expect(list[0].label).toBe('Default (1920×1080)')
    expect(list[4]).toEqual({ value: 'match', label: 'Match HDMI display (2560×1440)' })
  })

  it('disables Match HDMI display without a display', () => {
    const match = canvasChoices(null, null).find((c) => c.value === 'match')
    expect(match?.disabled).toBe(true)
  })
})

describe('canvasOfChoice', () => {
  const none = { width: '', height: '' }

  it('gives null for the default, and the size of a preset or the display', () => {
    expect(canvasOfChoice('default', none, null)).toEqual({ ok: true, canvas: null })
    expect(canvasOfChoice('3840x2160', none, null)).toEqual({
      ok: true,
      canvas: { width: 3840, height: 2160 }
    })
    expect(canvasOfChoice('match', none, { width: 2560, height: 1440 })).toEqual({
      ok: true,
      canvas: { width: 2560, height: 1440 }
    })
  })

  it('rounds a custom size down to even sides and refuses an invalid one', () => {
    expect(canvasOfChoice('custom', { width: '3841', height: '1081' }, null)).toEqual({
      ok: true,
      canvas: { width: 3840, height: 1080 }
    })
    expect(canvasOfChoice('custom', { width: '', height: '1080' }, null).ok).toBe(false)
    expect(canvasOfChoice('match', none, null).ok).toBe(false)
  })
})
