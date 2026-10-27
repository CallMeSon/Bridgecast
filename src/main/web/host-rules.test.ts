import { describe, expect, it } from 'vitest'
import {
  failLoadIsError,
  frameSenderAllowed,
  isAppPageUrl,
  mergeDisableFeatures,
  syncPlan,
  webDeckName
} from './host-rules'

const web = (
  id: string,
  url = `https://${id}.com/`
): {
  id: string
  source: 'web'
  web: { url: string }
} => ({ id, source: 'web', web: { url } })
const pdf = (id: string): { id: string; source: 'pdf' } => ({ id, source: 'pdf' })

describe('syncPlan', () => {
  it('opens the web decks that have no page yet, never other decks', () => {
    expect(syncPlan([], [web('a'), pdf('p'), web('b')], null)).toEqual({
      open: [
        { deckId: 'a', url: 'https://a.com/' },
        { deckId: 'b', url: 'https://b.com/' }
      ],
      close: []
    })
    expect(syncPlan(['a'], [web('a'), web('b')], null).open).toEqual([
      { deckId: 'b', url: 'https://b.com/' }
    ])
  })

  it('closes pages whose deck is gone (event switched or deck removed)', () => {
    expect(syncPlan(['a', 'b'], [web('b')], null)).toEqual({ open: [], close: ['a'] })
  })

  it('keeps the page that is on air open after an event switch, closes it once it leaves air', () => {
    expect(syncPlan(['a', 'x'], [web('b')], 'a')).toEqual({
      open: [{ deckId: 'b', url: 'https://b.com/' }],
      close: ['x']
    })
    expect(syncPlan(['a', 'b'], [web('b')], 'other').close).toEqual(['a'])
  })

  it('skips a web deck without a URL', () => {
    expect(syncPlan([], [{ id: 'a', source: 'web' }], null).open).toEqual([])
  })
})

describe('webDeckName', () => {
  it('uses the page title, trimmed', () => {
    expect(webDeckName('  My design  ', 'https://www.canva.com/x')).toBe('My design')
  })
  it('falls back to the domain for an empty or unusable title', () => {
    expect(webDeckName('', 'https://www.canva.com/x')).toBe('canva.com')
    expect(webDeckName('   ', 'https://example.com/')).toBe('example.com')
    expect(webDeckName('bad\u0000name', 'https://example.com/')).toBe('bad name')
  })
  it('cuts a long title to 120 characters', () => {
    expect([...webDeckName('x'.repeat(300), 'https://a.com/')].length).toBe(120)
  })
})

describe('mergeDisableFeatures', () => {
  it('adds the feature to an empty or existing list once', () => {
    expect(mergeDisableFeatures('', 'CalculateNativeWinOcclusion')).toBe(
      'CalculateNativeWinOcclusion'
    )
    expect(mergeDisableFeatures('Foo,Bar', 'CalculateNativeWinOcclusion')).toBe(
      'Foo,Bar,CalculateNativeWinOcclusion'
    )
    expect(
      mergeDisableFeatures('Foo,CalculateNativeWinOcclusion', 'CalculateNativeWinOcclusion')
    ).toBe('Foo,CalculateNativeWinOcclusion')
  })
})

describe('isAppPageUrl', () => {
  const file = '/opt/app/resources/app.asar/out/renderer/index.html'
  it('accepts the built renderer page with any hash or query', () => {
    expect(isAppPageUrl(`file://${file}#/output`, { file })).toBe(true)
    expect(isAppPageUrl(`file://${file}?x=1#/prepare?deck=a`, { file })).toBe(true)
  })
  it('accepts the dev server origin only when one is set', () => {
    expect(
      isAppPageUrl('http://localhost:5173/#/output', { file, dev: 'http://localhost:5173' })
    ).toBe(true)
    expect(isAppPageUrl('http://localhost:5173/#/output', { file })).toBe(false)
  })
  it('refuses web pages, other files and junk', () => {
    expect(isAppPageUrl('https://evil.com/', { file, dev: 'http://localhost:5173' })).toBe(false)
    expect(isAppPageUrl('file:///tmp/index.html', { file })).toBe(false)
    expect(isAppPageUrl('', { file })).toBe(false)
    expect(isAppPageUrl('not a url', { file })).toBe(false)
  })
})

describe('failLoadIsError', () => {
  it('counts main-frame failures except an aborted load', () => {
    expect(failLoadIsError(-106, true)).toBe(true)
    expect(failLoadIsError(-3, true)).toBe(false)
    expect(failLoadIsError(-106, false)).toBe(false)
  })
})

describe('frameSenderAllowed', () => {
  const none = { hdmi: false, omt: false }
  it('takes the frame from an active output window', () => {
    expect(frameSenderAllowed('hdmi', { hdmi: true, omt: false })).toBe(true)
    expect(frameSenderAllowed('omt', { hdmi: false, omt: true })).toBe(true)
    expect(frameSenderAllowed('omt', { hdmi: true, omt: true })).toBe(true)
  })
  it('refuses an output window that is not active', () => {
    expect(frameSenderAllowed('hdmi', { hdmi: false, omt: true })).toBe(false)
    expect(frameSenderAllowed('omt', none)).toBe(false)
  })
  it('takes the operator preview only when no output is active', () => {
    expect(frameSenderAllowed('operator', none)).toBe(true)
    expect(frameSenderAllowed('operator', { hdmi: true, omt: false })).toBe(false)
    expect(frameSenderAllowed('operator', { hdmi: false, omt: true })).toBe(false)
  })
  it('never takes a Prepare window', () => {
    expect(frameSenderAllowed('prepare', none)).toBe(false)
    expect(frameSenderAllowed('prepare', { hdmi: true, omt: true })).toBe(false)
  })
})
