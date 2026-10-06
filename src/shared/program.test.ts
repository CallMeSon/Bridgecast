import { describe, it, expect } from 'vitest'
import { reduce, reconcile, initialState, pendingTake, type ProgramState } from './program'

const s = (n: number): { file: string; notes: string }[] =>
  Array.from({ length: n }, (_, i) => ({ file: `${i}.png`, notes: '' }))
const decks = [
  { id: 'A', slides: s(3) },
  { id: 'B', slides: s(2) }
]
const at = (deckId: string, index: number, extra: Partial<ProgramState> = {}): ProgramState => ({
  ...initialState,
  deckId,
  index,
  shown: { deckId, index },
  ...extra
})

describe('initialState', () => {
  it('has defaults', () => {
    expect(initialState).toEqual({
      deckId: null,
      index: 0,
      shown: null,
      frozen: false,
      black: false,
      transition: 'cut'
    })
  })
})

describe('reduce navigation', () => {
  it('next A/0 -> A/1 and shown follows', () => {
    const r = reduce(at('A', 0), { type: 'next' }, decks)
    expect(r.deckId).toBe('A')
    expect(r.index).toBe(1)
    expect(r.shown).toEqual({ deckId: 'A', index: 1 })
  })
  it('next at A/2 goes to B/0; at B/1 no change', () => {
    const r = reduce(at('A', 2), { type: 'next' }, decks)
    expect([r.deckId, r.index]).toEqual(['B', 0])
    const end = at('B', 1)
    expect(reduce(end, { type: 'next' }, decks)).toEqual(end)
  })
  it('prev at B/0 goes to A/2; at A/0 no change', () => {
    const r = reduce(at('B', 0), { type: 'prev' }, decks)
    expect([r.deckId, r.index]).toEqual(['A', 2])
    const start = at('A', 0)
    expect(reduce(start, { type: 'prev' }, decks)).toEqual(start)
  })
  it('frozen keeps shown; unfreezing then next makes shown follow', () => {
    const f = at('A', 0, { frozen: true })
    const r = reduce(f, { type: 'next' }, decks)
    expect(r.index).toBe(1)
    expect(r.shown).toEqual({ deckId: 'A', index: 0 })
    const u = reduce(r, { type: 'toggleFreeze' }, decks)
    expect(u.frozen).toBe(false)
    const n = reduce(u, { type: 'next' }, decks)
    expect(n.shown).toEqual({ deckId: 'A', index: 2 })
  })
  it('toggleBlack changes neither position nor shown', () => {
    const st = at('A', 1)
    const r = reduce(st, { type: 'toggleBlack' }, decks)
    expect(r).toEqual({ ...st, black: true })
  })
  it('goto out of range ignored; valid goto works', () => {
    const st = at('A', 1)
    expect(reduce(st, { type: 'goto', index: 3 }, decks)).toEqual(st)
    expect(reduce(st, { type: 'goto', index: -1 }, decks)).toEqual(st)
    const r = reduce(st, { type: 'goto', index: 2 }, decks)
    expect(r.index).toBe(2)
    expect(r.shown).toEqual({ deckId: 'A', index: 2 })
  })
  it('selectDeck moves to deckId/0; unknown ignored', () => {
    const st = at('A', 2)
    const r = reduce(st, { type: 'selectDeck', deckId: 'B' }, decks)
    expect([r.deckId, r.index]).toEqual(['B', 0])
    expect(r.shown).toEqual({ deckId: 'B', index: 0 })
    expect(reduce(st, { type: 'selectDeck', deckId: 'Z' }, decks)).toEqual(st)
  })
  it('setTransition works', () => {
    expect(
      reduce(initialState, { type: 'setTransition', transition: 'fade' }, decks).transition
    ).toBe('fade')
  })
  it('empty decks: nav is no-op, toggles work', () => {
    expect(reduce(initialState, { type: 'next' }, [])).toEqual(initialState)
    expect(reduce(initialState, { type: 'prev' }, [])).toEqual(initialState)
    expect(reduce(initialState, { type: 'goto', index: 0 }, [])).toEqual(initialState)
    expect(reduce(initialState, { type: 'selectDeck', deckId: 'A' }, [])).toEqual(initialState)
    expect(reduce(initialState, { type: 'toggleFreeze' }, []).frozen).toBe(true)
    expect(reduce(initialState, { type: 'toggleBlack' }, []).black).toBe(true)
  })
  it('skips decks without slides and does not mutate', () => {
    const ds = [
      { id: 'A', slides: s(1) },
      { id: 'E', slides: [] },
      { id: 'B', slides: s(1) }
    ]
    const frozen = JSON.stringify(ds)
    const r = reduce(at('A', 0), { type: 'next' }, ds)
    expect([r.deckId, r.index]).toEqual(['B', 0])
    expect(JSON.stringify(ds)).toBe(frozen)
  })
})

describe('reconcile', () => {
  it('drops shown when its deck is gone', () => {
    const st = at('A', 1)
    const r = reconcile(st, [decks[1]])
    expect(r.shown).toBeNull()
    expect([r.deckId, r.index]).toEqual(['B', 0])
  })
  it('drops shown when its index is out of range', () => {
    const st = at('A', 2)
    const r = reconcile(st, [{ id: 'A', slides: s(2) }])
    expect(r.shown).toBeNull()
    expect(r.index).toBe(1)
  })
  it('null position when no decks', () => {
    const r = reconcile(at('A', 1), [])
    expect(r.deckId).toBeNull()
    expect(r.index).toBe(0)
    expect(r.shown).toBeNull()
  })
  it('keeps valid state unchanged', () => {
    const st = at('A', 1)
    expect(reconcile(st, decks)).toEqual(st)
  })
})

describe('take on first Next/Prev when nothing of this event is shown', () => {
  const standby = (
    deckId: string,
    index: number,
    extra: Partial<ProgramState> = {}
  ): ProgramState => at(deckId, index, { shown: null, ...extra })

  it('STANDBY: first Next takes the position live without advancing', () => {
    const r = reduce(standby('A', 0), { type: 'next' }, decks)
    expect([r.deckId, r.index]).toEqual(['A', 0])
    expect(r.shown).toEqual({ deckId: 'A', index: 0 })
    const r2 = reduce(r, { type: 'next' }, decks)
    expect(r2.shown).toEqual({ deckId: 'A', index: 1 })
  })

  it('shown left over from another event: first Next takes the position', () => {
    const st = standby('B', 0, { shown: { deckId: 'OTHER', index: 4 } })
    const r = reduce(st, { type: 'next' }, decks)
    expect(r.shown).toEqual({ deckId: 'B', index: 0 })
    expect(r.index).toBe(0)
  })

  it('Prev takes the position the same way', () => {
    const r = reduce(standby('A', 2), { type: 'prev' }, decks)
    expect([r.deckId, r.index]).toEqual(['A', 2])
    expect(r.shown).toEqual({ deckId: 'A', index: 2 })
  })

  it('STANDBY on the last slide of the last deck can still go live', () => {
    const r = reduce(standby('B', 1), { type: 'next' }, decks)
    expect(r.shown).toEqual({ deckId: 'B', index: 1 })
  })

  it('taking while black keeps black (badge goes STANDBY -> BLACK)', () => {
    const r = reduce(standby('A', 0, { black: true }), { type: 'next' }, decks)
    expect(r.shown).toEqual({ deckId: 'A', index: 0 })
    expect(r.black).toBe(true)
  })

  it('frozen + STANDBY steps normally and does not take', () => {
    const st = standby('A', 0, { frozen: true })
    expect(pendingTake(st, decks)).toBe(false)
    const r = reduce(st, { type: 'next' }, decks)
    expect([r.deckId, r.index]).toEqual(['A', 1])
    expect(r.shown).toBeNull()
  })

  it('after freeze, move, unfreeze, Next steps normally (shown differs from position)', () => {
    let st = at('A', 0)
    st = reduce(st, { type: 'toggleFreeze' }, decks)
    st = reduce(st, { type: 'next' }, decks)
    st = reduce(st, { type: 'toggleFreeze' }, decks)
    expect(st.shown).toEqual({ deckId: 'A', index: 0 })
    expect(pendingTake(st, decks)).toBe(false)
    const r = reduce(st, { type: 'next' }, decks)
    expect([r.deckId, r.index]).toEqual(['A', 2])
    expect(r.shown).toEqual({ deckId: 'A', index: 2 })
  })

  it('no take without a valid position', () => {
    expect(pendingTake(initialState, decks)).toBe(false)
    expect(pendingTake(standby('A', 9), decks)).toBe(false)
    expect(reduce(initialState, { type: 'next' }, decks)).toEqual(initialState)
  })
})
