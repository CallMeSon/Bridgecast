import { describe, expect, it } from 'vitest'
import { isOwnOrigin, permissionAllowed } from './permissions'

const DEV = 'http://localhost:5173'

describe('isOwnOrigin', () => {
  it('accepts file: pages and the dev server origin only', () => {
    expect(isOwnOrigin('file:///', undefined)).toBe(true)
    expect(isOwnOrigin('file:///C:/app/out/renderer/index.html', '')).toBe(true)
    expect(isOwnOrigin('http://localhost:5173', DEV)).toBe(true)
    expect(isOwnOrigin('http://localhost:5173/#/output', DEV)).toBe(true)
  })

  it('refuses other origins, other ports and everything when there is no dev server', () => {
    expect(isOwnOrigin('https://example.com', DEV)).toBe(false)
    expect(isOwnOrigin('http://localhost:9999', DEV)).toBe(false)
    expect(isOwnOrigin('http://localhost:5173', undefined)).toBe(false)
    expect(isOwnOrigin('http://localhost:5173', '')).toBe(false)
    expect(isOwnOrigin('slide://abc', DEV)).toBe(false)
    expect(isOwnOrigin('', DEV)).toBe(false)
    expect(isOwnOrigin('not a url', DEV)).toBe(false)
  })
})

describe('permissionAllowed', () => {
  it('allows media and speaker-selection for own origins only', () => {
    expect(permissionAllowed('media', 'file:///', undefined)).toBe(true)
    expect(permissionAllowed('speaker-selection', 'file:///', undefined)).toBe(true)
    expect(permissionAllowed('media', 'https://example.com', DEV)).toBe(false)
    expect(permissionAllowed('speaker-selection', 'https://example.com', DEV)).toBe(false)
  })

  it('refuses every other permission, even for own origins', () => {
    for (const p of ['geolocation', 'notifications', 'clipboard-read', 'openExternal']) {
      expect(permissionAllowed(p, 'file:///', undefined)).toBe(false)
    }
  })
})
