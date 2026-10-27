import { describe, expect, it } from 'vitest'
import { DEFAULT_OMT, dropWarning, restartAllowed, sanitizeOmt } from './omt'

describe('sanitizeOmt', () => {
  it('defaults for anything that is not an object', () => {
    expect(DEFAULT_OMT).toEqual({ enabled: false, name: 'PPT Share', fps: 30 })
    for (const raw of [undefined, null, 'x', 7, []]) expect(sanitizeOmt(raw)).toEqual(DEFAULT_OMT)
  })

  it('keeps valid values', () => {
    expect(sanitizeOmt({ enabled: true, name: 'Aula', fps: 60 })).toEqual({
      enabled: true,
      name: 'Aula',
      fps: 60
    })
  })

  it('an invalid fps becomes 30', () => {
    for (const fps of [45, '60', null, NaN, 0]) expect(sanitizeOmt({ fps }).fps).toBe(30)
  })

  it('an empty or invalid name becomes the default', () => {
    for (const name of ['  ', '', 5, null, '\u0007\u0001']) {
      expect(sanitizeOmt({ name }).name).toBe('PPT Share')
    }
  })

  it('trims, cuts to 64 characters and removes control characters', () => {
    expect(sanitizeOmt({ name: 'a'.repeat(80) }).name).toBe('a'.repeat(64))
    expect(sanitizeOmt({ name: '\u0007x' }).name).toBe('x')
    expect(sanitizeOmt({ name: '  Sala 1  ' }).name).toBe('Sala 1')
  })

  it('an invalid enabled flag becomes false', () => {
    expect(sanitizeOmt({ enabled: 1 }).enabled).toBe(false)
  })
})

describe('restartAllowed', () => {
  const now = 1_000_000
  it('allows restarts with 2 failures inside 60 s', () => {
    expect(restartAllowed([now - 10_000, now - 1000], now)).toBe(true)
  })
  it('stops with 3 failures inside 60 s', () => {
    expect(restartAllowed([now - 50_000, now - 10_000, now - 1000], now)).toBe(false)
  })
  it('allows 3 failures spread over 2 min', () => {
    expect(restartAllowed([now - 120_000, now - 60_000, now - 1000], now)).toBe(true)
  })
})

describe('dropWarning', () => {
  const now = 100_000
  // 10 samples, one per second, 600 frames each at 60 fps
  const samples = (dropped: number): { sent: number; dropped: number; at: number }[] =>
    Array.from({ length: 10 }, (_, i) => ({ sent: 600 - dropped, dropped, at: now - i * 1000 }))

  it('warns at 60 fps with 11 % drops over 10 s', () => {
    expect(dropWarning(samples(66), 60, now)).toBe(true)
  })
  it('does not warn at 30 fps', () => {
    expect(dropWarning(samples(66), 30, now)).toBe(false)
  })
  it('does not warn with 9 % drops', () => {
    expect(dropWarning(samples(54), 60, now)).toBe(false)
  })
  it('ignores samples older than 10 s and empty input', () => {
    expect(dropWarning([{ sent: 0, dropped: 600, at: now - 20_000 }], 60, now)).toBe(false)
    expect(dropWarning([], 60, now)).toBe(false)
  })
})
