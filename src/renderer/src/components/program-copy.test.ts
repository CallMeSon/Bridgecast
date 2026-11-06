import { describe, expect, it } from 'vitest'
import type { ProgramState } from '../../../shared/program'
import type { DeckMeta } from '../../../shared/types'
import { audienceNote, standbyCard } from './program-copy'

const deck = (n: number): DeckMeta =>
  ({ source: 'pptx', slides: Array.from({ length: n }, () => ({})) }) as unknown as DeckMeta
const webDeck = (): DeckMeta => ({ source: 'web', slides: [{}] }) as unknown as DeckMeta
const s = { shown: { index: 2 } } as unknown as ProgramState

describe('standbyCard', () => {
  it('no deck: asks for files', () =>
    expect(standbyCard(null, 0, 'Drag files')).toEqual({
      title: 'No slides yet',
      sub: 'Drag files'
    }))
  it('deck with no slides: asks for files', () =>
    expect(standbyCard(deck(0), 0, 'Drag files').title).toBe('No slides yet'))
  it('deck with slides: says what Next does', () =>
    expect(standbyCard(deck(12), 2, 'x')).toEqual({
      title: 'Standby',
      sub: 'Press Space to put slide 3 on air.'
    }))
  it('web deck on standby', () =>
    expect(standbyCard(webDeck(), 0, 'x')).toEqual({
      title: 'Standby',
      sub: 'Press Space to put this page on air.'
    }))
})

describe('audienceNote', () => {
  it('web live', () => expect(audienceNote(s, 'live', true)).toBe('Audience sees the web page'))
  it('web frozen', () =>
    expect(audienceNote(s, 'frozen', true)).toBe('Audience sees the web page, held'))
  it('slide live is unchanged', () =>
    expect(audienceNote(s, 'live', false)).toBe('Audience sees slide 3'))
  it('black ignores isWeb', () =>
    expect(audienceNote(s, 'black', true)).toBe('Audience sees black'))
})
