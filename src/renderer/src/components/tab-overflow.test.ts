import { describe, expect, it } from 'vitest'
import { hiddenTabs } from './tab-overflow'

const tabs = [
  { left: 0, right: 100 },
  { left: 100, right: 200 },
  { left: 200, right: 300 }
]

describe('hiddenTabs', () => {
  it('lists the tabs that are not fully inside the view', () => {
    expect(hiddenTabs(tabs, 0, 150)).toEqual([1, 2])
  })
  it('is empty when the view covers every tab', () => {
    expect(hiddenTabs(tabs, 0, 300)).toEqual([])
  })
  it('counts an exact fit as visible', () => {
    expect(hiddenTabs(tabs, 100, 200)).toEqual([0, 2])
  })
  it('lists a tab cut on the left', () => {
    expect(hiddenTabs(tabs, 50, 300)).toEqual([0])
  })
})
