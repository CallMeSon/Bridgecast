import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  updateCaptureWarnings,
  failLoadIsError,
  frameSenderAllowed,
  HeldAcks,
  heldAckRoles,
  holdBeforeNavigate,
  pageSizeWarning,
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

describe('updateCaptureWarnings', () => {
  const on = { hdmi: true, omt: true }
  it('one warning per output; a later report for that output replaces it', () => {
    let w = updateCaptureWarnings([], 'hdmi', 'a', true, on)
    w = updateCaptureWarnings(w, 'omt', 'a', true, on)
    w = updateCaptureWarnings(w, 'hdmi', 'b', true, on)
    expect(w).toEqual([
      { output: 'omt', deckId: 'a' },
      { output: 'hdmi', deckId: 'b' }
    ])
  })
  it('a recovery clears only that output and deck', () => {
    const w = updateCaptureWarnings([{ output: 'hdmi', deckId: 'a' }], 'hdmi', 'b', false, on)
    expect(w).toEqual([{ output: 'hdmi', deckId: 'a' }])
    expect(updateCaptureWarnings(w, 'hdmi', 'a', false, on)).toEqual([])
  })
  it('an output that is no longer active drops its warning', () => {
    const w = [
      { output: 'hdmi' as const, deckId: 'a' },
      { output: 'omt' as const, deckId: 'a' }
    ]
    expect(updateCaptureWarnings(w, null, '', false, { hdmi: false, omt: true })).toEqual([
      { output: 'omt', deckId: 'a' }
    ])
  })
  it('a report from an inactive output is not kept', () => {
    expect(updateCaptureWarnings([], 'hdmi', 'a', true, { hdmi: false, omt: false })).toEqual([])
  })
})

describe('holdBeforeNavigate', () => {
  it('holds first only for the live, unfrozen page that is not held yet', () => {
    expect(holdBeforeNavigate({ live: true, frozen: false, held: false })).toBe(true)
    expect(holdBeforeNavigate({ live: true, frozen: true, held: false })).toBe(false)
    expect(holdBeforeNavigate({ live: true, frozen: false, held: true })).toBe(false)
    expect(holdBeforeNavigate({ live: false, frozen: false, held: false })).toBe(false)
  })
})

describe('heldAckRoles', () => {
  it('waits for the active outputs, else the operator window', () => {
    expect(heldAckRoles({ hdmi: true, omt: true })).toEqual(['hdmi', 'omt'])
    expect(heldAckRoles({ hdmi: false, omt: true })).toEqual(['omt'])
    expect(heldAckRoles({ hdmi: false, omt: false })).toEqual(['operator'])
  })
})

describe('HeldAcks', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('resolves once every expected window has paused the page', async () => {
    const acks = new HeldAcks()
    const done = vi.fn()
    void acks.wait('w', ['hdmi', 'omt'], 1000).then(done)
    acks.ack('w', 'hdmi')
    await Promise.resolve()
    expect(done).not.toHaveBeenCalled()
    acks.ack('other', 'omt') // another deck does not count
    acks.ack('w', 'prepare') // a window not waited for does not count
    await Promise.resolve()
    expect(done).not.toHaveBeenCalled()
    acks.ack('w', 'omt')
    await vi.advanceTimersByTimeAsync(0)
    expect(done).toHaveBeenCalledWith('paused')
  })

  it('resolves after the timeout when a window never answers', async () => {
    const acks = new HeldAcks()
    const done = vi.fn()
    void acks.wait('w', ['hdmi'], 300).then(done)
    await vi.advanceTimersByTimeAsync(299)
    expect(done).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(done).toHaveBeenCalledWith('timeout')
  })

  it('an ack before the wait started does not count', async () => {
    const acks = new HeldAcks()
    acks.ack('w', 'hdmi')
    const done = vi.fn()
    void acks.wait('w', ['hdmi'], 300).then(done)
    await vi.advanceTimersByTimeAsync(0)
    expect(done).not.toHaveBeenCalled()
  })
})

describe('pageSizeWarning', () => {
  it('is empty when the page has the canvas size', () => {
    expect(pageSizeWarning([1920, 1080], { width: 1920, height: 1080 })).toBeUndefined()
  })
  it('names both sizes when the window was clamped', () => {
    expect(pageSizeWarning([2560, 1080], { width: 3840, height: 1080 })).toBe(
      'The web page is 2560x1080 on this PC, not the canvas size 3840x1080. The output shows it stretched. Use a smaller canvas, or check the display settings.'
    )
  })
})
