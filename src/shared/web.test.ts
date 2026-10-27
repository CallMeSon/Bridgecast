import { describe, it, expect } from 'vitest'
import { sanitizeWebUrl, webDomain, WEB_URL_ERROR, WEB_HTTP_WARNING } from './web'

describe('sanitizeWebUrl', () => {
  it('trims and keeps https', () => {
    expect(sanitizeWebUrl(' https://canva.com/x ')).toEqual({ url: 'https://canva.com/x' })
  })
  it('adds https:// when there is no scheme', () => {
    expect(sanitizeWebUrl('canva.com/design/ABC/view')).toEqual({
      url: 'https://canva.com/design/ABC/view'
    })
  })
  it('accepts http with a warning', () => {
    expect(sanitizeWebUrl('http://x.org')).toEqual({
      url: 'http://x.org/',
      warning: 'This page is not secure (http). Use https if the site supports it.'
    })
  })
  it('refuses other schemes, spaces in the host and empty input', () => {
    const err = { error: 'Enter a web address that starts with https://.' }
    for (const input of [
      'javascript:alert(1)',
      'file:///etc/passwd',
      'ht tps://x',
      '',
      '   ',
      'a b.com'
    ]) {
      expect(sanitizeWebUrl(input)).toEqual(err)
    }
    expect(WEB_URL_ERROR).toBe(err.error)
    expect(WEB_HTTP_WARNING).toContain('not secure')
  })
})

describe('webDomain', () => {
  it('returns the hostname without www.', () => {
    expect(webDomain('https://www.canva.com/design/x')).toBe('canva.com')
    expect(webDomain('https://docs.google.com/a')).toBe('docs.google.com')
  })
  it('returns the input when it is not a URL', () => {
    expect(webDomain('nonsense')).toBe('nonsense')
  })
})
