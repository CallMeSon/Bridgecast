import { describe, expect, it } from 'vitest'
import { addressShown, homeDisabled } from './prepare-ui'

describe('addressShown', () => {
  it('keeps the typed text while editing, even when the page URL changes', () => {
    expect(addressShown({ pageUrl: 'https://b.com/', typed: 'https://a', editing: true })).toBe(
      'https://a'
    )
  })
  it('shows the page URL when not editing', () => {
    expect(addressShown({ pageUrl: 'https://b.com/', typed: 'https://a', editing: false })).toBe(
      'https://b.com/'
    )
  })
  it('shows the typed text before the page has a URL', () => {
    expect(addressShown({ pageUrl: null, typed: 'https://a', editing: false })).toBe('https://a')
  })
})

describe('homeDisabled', () => {
  it('is disabled when the page is at the deck address, ignoring one trailing slash', () => {
    expect(homeDisabled('https://a.com/', 'https://a.com')).toBe(true)
    expect(homeDisabled('https://a.com', 'https://a.com/')).toBe(true)
  })
  it('is enabled on a different path', () => {
    expect(homeDisabled('https://a.com/next', 'https://a.com')).toBe(false)
  })
  it('is disabled without a deck address', () => {
    expect(homeDisabled('https://a.com', undefined)).toBe(true)
  })
})
