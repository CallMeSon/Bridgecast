import { describe, expect, it } from 'vitest'
import {
  DEFAULT_OPEN,
  loadOpenSections,
  loadPanelTab,
  saveOpenSection,
  savePanelTab,
  type KeyValueStore
} from './panel-sections'

function memory(initial: Record<string, string> = {}): KeyValueStore & {
  data: Record<string, string>
} {
  const data = { ...initial }
  return {
    data,
    getItem: (k) => (k in data ? data[k] : null),
    setItem: (k, v) => {
      data[k] = v
    }
  }
}

describe('panel tab', () => {
  it('defaults to controls when storage is empty, corrupt or unknown', () => {
    expect(loadPanelTab(memory())).toBe('controls')
    expect(loadPanelTab(memory({ 'panel-tab': 'nope' }))).toBe('controls')
  })
  it('round-trips', () => {
    const s = memory()
    savePanelTab(s, 'info')
    expect(loadPanelTab(s)).toBe('info')
  })
  it('survives a storage that throws', () => {
    const bad: KeyValueStore = {
      getItem: () => {
        throw new Error('blocked')
      },
      setItem: () => {
        throw new Error('blocked')
      }
    }
    expect(loadPanelTab(bad)).toBe('controls')
    expect(() => savePanelTab(bad, 'info')).not.toThrow()
    expect(loadOpenSections(bad)).toEqual(DEFAULT_OPEN)
  })
})

describe('open sections', () => {
  it('defaults: network collapsed, the rest open', () => {
    expect(loadOpenSections(memory())).toEqual({
      transition: true,
      'deck-settings': true,
      output: true,
      network: false,
      notes: true
    })
  })
  it('corrupt JSON or wrong shapes fall back to the defaults', () => {
    expect(loadOpenSections(memory({ 'panel-open': '{oops' }))).toEqual(DEFAULT_OPEN)
    expect(loadOpenSections(memory({ 'panel-open': '[1]' }))).toEqual(DEFAULT_OPEN)
    expect(
      loadOpenSections(memory({ 'panel-open': '{"network":"yes","bogus":false,"output":false}' }))
    ).toEqual({ ...DEFAULT_OPEN, output: false })
  })
  it('saveOpenSection round-trips and returns the new map', () => {
    const s = memory()
    const next = saveOpenSection(s, DEFAULT_OPEN, 'network', true)
    expect(next.network).toBe(true)
    expect(next.output).toBe(true)
    expect(loadOpenSections(s)).toEqual(next)
    expect(saveOpenSection(s, next, 'output', false).output).toBe(false)
    expect(loadOpenSections(s).output).toBe(false)
  })
})
