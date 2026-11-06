import { describe, expect, it } from 'vitest'
import {
  DEFAULT_NDI,
  DEFAULT_OMT,
  NETWORK_CHANGE_CONFIRM,
  NETWORK_CHANGE_NOTICE,
  canvasChangeConfirm,
  hasConnections,
  networkRunning,
  audioPlan,
  dropWarning,
  noReceiversHint,
  ndiBadge,
  netShortText,
  networkOn,
  omtBadge,
  sanitizeNdi,
  restartAllowed,
  sanitizeOmt
} from './omt'
import { CANVAS_CHANGE_LIVE } from './canvas'
import type { AudioRoute, NdiSettings, NdiStatus, OmtSettings, OmtStatus } from './omt'

describe('sanitizeOmt', () => {
  it('defaults for anything that is not an object', () => {
    expect(DEFAULT_OMT).toEqual({ enabled: false, name: 'Bridgecast', fps: 30 })
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
      expect(sanitizeOmt({ name }).name).toBe('Bridgecast')
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

describe('audioPlan', () => {
  // [role, hdmiShowing, networkRunning, route, local, tap]
  const T = true
  const F = false
  const rows: Array<['hdmi' | 'omt', boolean, boolean, AudioRoute, boolean, boolean]> = [
    ['hdmi', T, T, 'local', T, F],
    ['hdmi', T, T, 'omt', F, F],
    ['hdmi', T, T, 'both', T, F],
    ['hdmi', T, F, 'local', T, F],
    ['hdmi', T, F, 'omt', F, F],
    ['hdmi', T, F, 'both', T, F],
    ['hdmi', F, T, 'local', F, F],
    ['hdmi', F, T, 'omt', F, F],
    ['hdmi', F, T, 'both', F, F],
    ['hdmi', F, F, 'local', F, F],
    ['hdmi', F, F, 'omt', F, F],
    ['hdmi', F, F, 'both', F, F],
    ['omt', T, T, 'local', F, F],
    ['omt', T, T, 'omt', F, T],
    ['omt', T, T, 'both', F, T],
    ['omt', T, F, 'local', F, F],
    ['omt', T, F, 'omt', F, T],
    ['omt', T, F, 'both', F, T],
    ['omt', F, T, 'local', T, F],
    ['omt', F, T, 'omt', F, T],
    ['omt', F, T, 'both', T, T],
    ['omt', F, F, 'local', F, F],
    ['omt', F, F, 'omt', F, T],
    ['omt', F, F, 'both', F, T]
  ]

  it('covers every combination exactly once', () => {
    expect(new Set(rows.map((r) => r.slice(0, 4).join())).size).toBe(24)
  })

  it.each(rows)('%s showing=%s network=%s route=%s', (role, showing, net, route, local, tap) => {
    expect(audioPlan(role, showing, net, route)).toEqual({ local, tap })
  })

  it('never lets both windows play locally', () => {
    for (const showing of [true, false])
      for (const net of [true, false])
        for (const route of ['local', 'omt', 'both'] as const) {
          const both =
            audioPlan('hdmi', showing, net, route).local &&
            audioPlan('omt', showing, net, route).local
          expect(both).toBe(false)
        }
  })
})

describe('omtBadge', () => {
  const st = (o: Partial<OmtStatus>): OmtStatus => ({
    state: 'running',
    connections: 0,
    address: 'PC (Bridgecast)',
    ...o
  })

  it('no status or off is off', () => {
    expect(omtBadge(null)).toEqual({ text: 'OMT off', tone: 'off' })
    expect(omtBadge(st({ state: 'off' }))).toEqual({ text: 'OMT off', tone: 'off' })
  })

  it('running counts receivers', () => {
    expect(omtBadge(st({ connections: 0 }))).toEqual({
      text: 'OMT · no receivers',
      tone: 'neutral'
    })
    expect(omtBadge(st({ connections: 1 }))).toEqual({ text: 'OMT · 1 receiver', tone: 'ok' })
    expect(omtBadge(st({ connections: 2 }))).toEqual({ text: 'OMT · 2 receivers', tone: 'ok' })
  })

  it('starting is neutral, error is error', () => {
    expect(omtBadge(st({ state: 'starting' })).tone).toBe('neutral')
    expect(omtBadge(st({ state: 'error' }))).toEqual({ text: 'OMT error', tone: 'error' })
  })
})

describe('noReceiversHint', () => {
  const t0 = 1_000_000
  it('is due only after 15 s without receivers while running', () => {
    expect(noReceiversHint('running', 0, t0, t0 + 14_999)).toBe(false)
    expect(noReceiversHint('running', 0, t0, t0 + 15_000)).toBe(true)
  })
  it('never with a receiver, a different state or no start time', () => {
    expect(noReceiversHint('running', 1, t0, t0 + 60_000)).toBe(false)
    expect(noReceiversHint('starting', 0, t0, t0 + 60_000)).toBe(false)
    expect(noReceiversHint('error', 0, t0, t0 + 60_000)).toBe(false)
    expect(noReceiversHint('running', 0, null, t0 + 60_000)).toBe(false)
  })
})

describe('canvasChangeConfirm', () => {
  it('asks nothing when nothing is affected', () => {
    expect(canvasChangeConfirm(false, false)).toBeNull()
  })
  it('on air only keeps the canvas text', () => {
    expect(canvasChangeConfirm(true, false)).toBe(CANVAS_CHANGE_LIVE)
  })
  it('receivers only is the receivers copy verbatim', () => {
    expect(canvasChangeConfirm(false, true)).toBe(NETWORK_CHANGE_CONFIRM)
  })
  it('both give one question', () => {
    const t = canvasChangeConfirm(true, true) as string
    expect(t.match(/Change it now\?/g)).toHaveLength(1)
    expect(t.endsWith('Change it now?')).toBe(true)
    expect(t).toContain('what the audience sees.')
    expect(t).toContain(NETWORK_CHANGE_NOTICE)
  })
})

describe('sanitizeNdi', () => {
  it('defaults for anything that is not an object', () => {
    expect(DEFAULT_NDI).toEqual({ enabled: false, name: 'Bridgecast' })
    for (const raw of [undefined, null, 'x', 7, []]) expect(sanitizeNdi(raw)).toEqual(DEFAULT_NDI)
  })
  it('keeps valid values and trims', () => {
    expect(sanitizeNdi({ enabled: true, name: '  Sala 1 ' })).toEqual({
      enabled: true,
      name: 'Sala 1'
    })
  })
  it('blank, wrong-typed or control-only names fall back', () => {
    expect(sanitizeNdi({ name: '  ' }).name).toBe('Bridgecast')
    expect(sanitizeNdi({ name: 5 }).name).toBe('Bridgecast')
    expect(sanitizeNdi({ name: '\u0007' }).name).toBe('Bridgecast')
    expect(sanitizeNdi({ enabled: 'yes' }).enabled).toBe(false)
  })
  it('cuts to 64 characters', () => {
    expect(sanitizeNdi({ name: 'a'.repeat(80) }).name).toBe('a'.repeat(64))
  })
  it('removes control characters', () => {
    expect(sanitizeNdi({ name: '\u0007x' }).name).toBe('x')
  })
})

describe('ndiBadge', () => {
  const st = (state: NdiStatus['state'], connections = 0): NdiStatus => ({
    state,
    connections,
    address: null
  })
  it('off for null and off', () => {
    expect(ndiBadge(null)).toEqual({ text: 'NDI off', tone: 'off' })
    expect(ndiBadge(st('off'))).toEqual({ text: 'NDI off', tone: 'off' })
  })
  it('running with receivers', () => {
    expect(ndiBadge(st('running', 0))).toEqual({ text: 'NDI · no receivers', tone: 'neutral' })
    expect(ndiBadge(st('running', 1))).toEqual({ text: 'NDI · 1 receiver', tone: 'ok' })
    expect(ndiBadge(st('running', 2))).toEqual({ text: 'NDI · 2 receivers', tone: 'ok' })
  })
  it('error', () => {
    expect(ndiBadge(st('error'))).toEqual({ text: 'NDI error', tone: 'error' })
  })
})

describe('networkOn', () => {
  it('is true when either protocol is enabled', () => {
    const o = (enabled: boolean): OmtSettings => ({ ...DEFAULT_OMT, enabled })
    const n = (enabled: boolean): NdiSettings => ({ ...DEFAULT_NDI, enabled })
    expect(networkOn({ omt: o(false), ndi: n(false) })).toBe(false)
    expect(networkOn({ omt: o(true), ndi: n(false) })).toBe(true)
    expect(networkOn({ omt: o(false), ndi: n(true) })).toBe(true)
    expect(networkOn({ omt: o(true), ndi: n(true) })).toBe(true)
  })
})

describe('hasConnections', () => {
  const st = (connections: number, state: OmtStatus['state'] = 'running'): OmtStatus => ({
    state,
    connections,
    address: null
  })
  it('is false for null and for no receivers', () => {
    expect(hasConnections(null, null)).toBe(false)
    expect(hasConnections(st(0), st(0))).toBe(false)
    expect(hasConnections(st(0), null)).toBe(false)
  })
  it('is true when either target has a receiver', () => {
    expect(hasConnections(st(1), null)).toBe(true)
    expect(hasConnections(null, st(2))).toBe(true)
    expect(hasConnections(st(0), st(1))).toBe(true)
  })
})

describe('networkRunning', () => {
  const st = (state: OmtStatus['state']): OmtStatus => ({ state, connections: 0, address: null })
  it('is false for null and for targets that are not running', () => {
    expect(networkRunning(null, null)).toBe(false)
    expect(networkRunning(st('off'), st('starting'))).toBe(false)
    expect(networkRunning(st('error'), null)).toBe(false)
  })
  it('is true when either target runs', () => {
    expect(networkRunning(st('running'), null)).toBe(true)
    expect(networkRunning(null, st('running'))).toBe(true)
    expect(networkRunning(st('off'), st('running'))).toBe(true)
  })
})

describe('netShortText', () => {
  const st = (state: OmtStatus['state'], connections = 0): OmtStatus => ({
    state,
    connections,
    address: null
  })

  it('off, no receivers, a count, starting and error each keep a word', () => {
    expect(netShortText('OMT', null)).toBe('OMT off')
    expect(netShortText('OMT', st('off'))).toBe('OMT off')
    expect(netShortText('OMT', st('running', 0))).toBe('OMT 0')
    expect(netShortText('OMT', st('running', 2))).toBe('OMT 2')
    expect(netShortText('NDI', st('running', 1))).toBe('NDI 1')
    expect(netShortText('NDI', st('starting'))).toBe('NDI …')
    expect(netShortText('NDI', st('error'))).toBe('NDI')
  })
})
