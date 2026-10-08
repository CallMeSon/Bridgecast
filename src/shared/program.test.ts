import { describe, it, expect } from 'vitest'
import {
  reduce,
  reconcile,
  followSlideOrder,
  initialState,
  pendingTake,
  type ProgramState,
  type ShownSlide
} from './program'

const s = (n: number): { file: string; notes: string }[] =>
  Array.from({ length: n }, (_, i) => ({ file: `${i}.png`, notes: '' }))
/** Slide files are named after their original index (`0.png`, `1.png`, …). */
const sh = (deckId: string, index: number, file = `${index}.png`): ShownSlide => ({
  deckId,
  index,
  file
})
const decks = [
  { id: 'A', slides: s(3) },
  { id: 'B', slides: s(2) }
]
const at = (deckId: string, index: number, extra: Partial<ProgramState> = {}): ProgramState => ({
  ...initialState,
  deckId,
  index,
  shown: sh(deckId, index),
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
      transition: 'cut',
      autoAdvance: false
    })
  })
})

describe('reduce navigation', () => {
  it('next A/0 -> A/1 and shown follows', () => {
    const r = reduce(at('A', 0), { type: 'next' }, decks)
    expect(r.deckId).toBe('A')
    expect(r.index).toBe(1)
    expect(r.shown).toEqual(sh('A', 1))
  })
  it('auto advance on: next at A/2 goes to B/0; at B/1 no change', () => {
    const r = reduce(at('A', 2, { autoAdvance: true }), { type: 'next' }, decks)
    expect([r.deckId, r.index]).toEqual(['B', 0])
    expect(r.shown).toEqual(sh('B', 0))
    const end = at('B', 1, { autoAdvance: true })
    expect(reduce(end, { type: 'next' }, decks)).toEqual(end)
  })
  it('auto advance on: prev at B/0 goes to A/2; at A/0 no change', () => {
    const r = reduce(at('B', 0, { autoAdvance: true }), { type: 'prev' }, decks)
    expect([r.deckId, r.index]).toEqual(['A', 2])
    const start = at('A', 0, { autoAdvance: true })
    expect(reduce(start, { type: 'prev' }, decks)).toEqual(start)
  })
  it('auto advance off (default): next and prev stay inside the live deck', () => {
    const last = at('A', 2)
    expect(reduce(last, { type: 'next' }, decks)).toEqual(last)
    const first = at('B', 0)
    expect(reduce(first, { type: 'prev' }, decks)).toEqual(first)
    // Inside the deck they still move.
    expect(reduce(at('A', 1), { type: 'next' }, decks).index).toBe(2)
    expect(reduce(at('B', 1), { type: 'prev' }, decks).index).toBe(0)
  })
  it('setAutoAdvance changes only the flag', () => {
    const st = at('A', 1)
    expect(reduce(st, { type: 'setAutoAdvance', on: true }, decks)).toEqual({
      ...st,
      autoAdvance: true
    })
    expect(reduce(st, { type: 'setAutoAdvance', on: 'ya' as unknown as boolean }, decks)).toEqual(
      st
    )
  })
  it('frozen keeps shown; unfreezing then next makes shown follow', () => {
    const f = at('A', 0, { frozen: true })
    const r = reduce(f, { type: 'next' }, decks)
    expect(r.index).toBe(1)
    expect(r.shown).toEqual(sh('A', 0))
    const u = reduce(r, { type: 'toggleFreeze' }, decks)
    expect(u.frozen).toBe(false)
    const n = reduce(u, { type: 'next' }, decks)
    expect(n.shown).toEqual(sh('A', 2))
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
    expect(r.shown).toEqual(sh('A', 2))
  })
  it('selectDeck moves to deckId/0; unknown ignored', () => {
    const st = at('A', 2)
    const r = reduce(st, { type: 'selectDeck', deckId: 'B' }, decks)
    expect([r.deckId, r.index]).toEqual(['B', 0])
    expect(r.shown).toEqual(sh('B', 0))
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
    const r = reduce(at('A', 0, { autoAdvance: true }), { type: 'next' }, ds)
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
  it('drops shown when its slide is gone', () => {
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
    expect(reconcile(st, decks)).toBe(st)
  })
  it('shown follows its slide (by file) when the slides of its deck moved', () => {
    // Slide 2.png moved to the front: [2.png, 0.png, 1.png].
    const moved = [{ id: 'A', slides: [2, 0, 1].map((i) => ({ file: `${i}.png`, notes: '' })) }]
    const r = reconcile(at('A', 2, { deckId: 'A', index: 2 }), moved)
    expect(r.shown).toEqual(sh('A', 0, '2.png'))
  })
  it('drops shown when its slide file is no longer in the deck', () => {
    const other = [{ id: 'A', slides: [{ file: 'x.png', notes: '' }, ...s(2)] }]
    const st = at('A', 2)
    expect(reconcile(st, other).shown).toBeNull()
  })
})

describe('followSlideOrder', () => {
  it('position and shown follow the slide that moved', () => {
    // A: 2.png moves to the front.
    const r = followSlideOrder(at('A', 2), 'A', [2, 0, 1])
    expect([r.deckId, r.index]).toEqual(['A', 0])
    expect(r.shown).toEqual(sh('A', 0, '2.png'))
  })
  it('keeps the same slide when another slide moved around it', () => {
    // Live slide 0.png; 2.png moves between 0.png and 1.png: [0, 2, 1].
    const r = followSlideOrder(at('A', 0), 'A', [0, 2, 1])
    expect(r.index).toBe(0)
    expect(r.shown).toEqual(sh('A', 0))
    // Position on 1.png (index 1) is pushed to index 2.
    const p = followSlideOrder(at('A', 1, { shown: sh('A', 0) }), 'A', [0, 2, 1])
    expect(p.index).toBe(2)
    expect(p.shown).toEqual(sh('A', 0))
  })
  it('position and shown in different decks are remapped independently', () => {
    const st = at('B', 1, { shown: sh('A', 1) })
    const r = followSlideOrder(st, 'A', [1, 2, 0])
    expect([r.deckId, r.index]).toEqual(['B', 1])
    expect(r.shown).toEqual(sh('A', 0, '1.png'))
  })
  it('returns the same state for another deck or an invalid order', () => {
    const st = at('A', 1)
    expect(followSlideOrder(st, 'B', [1, 0])).toBe(st)
    expect(followSlideOrder(st, 'A', [0, 0, 1])).toBe(st)
    expect(followSlideOrder(st, 'A', [0, 1])).toBe(st)
    expect(followSlideOrder(st, 'A', [0, 1, 2])).toBe(st)
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
    expect(r.shown).toEqual(sh('A', 0))
    const r2 = reduce(r, { type: 'next' }, decks)
    expect(r2.shown).toEqual(sh('A', 1))
  })

  it('shown left over from another event: first Next takes the position', () => {
    const st = standby('B', 0, { shown: sh('OTHER', 4) })
    const r = reduce(st, { type: 'next' }, decks)
    expect(r.shown).toEqual(sh('B', 0))
    expect(r.index).toBe(0)
  })

  it('Prev takes the position the same way', () => {
    const r = reduce(standby('A', 2), { type: 'prev' }, decks)
    expect([r.deckId, r.index]).toEqual(['A', 2])
    expect(r.shown).toEqual(sh('A', 2))
  })

  it('STANDBY on the last slide of the last deck can still go live', () => {
    const r = reduce(standby('B', 1), { type: 'next' }, decks)
    expect(r.shown).toEqual(sh('B', 1))
  })

  it('taking while black keeps black (badge goes STANDBY -> BLACK)', () => {
    const r = reduce(standby('A', 0, { black: true }), { type: 'next' }, decks)
    expect(r.shown).toEqual(sh('A', 0))
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
    expect(st.shown).toEqual(sh('A', 0))
    expect(pendingTake(st, decks)).toBe(false)
    const r = reduce(st, { type: 'next' }, decks)
    expect([r.deckId, r.index]).toEqual(['A', 2])
    expect(r.shown).toEqual(sh('A', 2))
  })

  it('no take without a valid position', () => {
    expect(pendingTake(initialState, decks)).toBe(false)
    expect(pendingTake(standby('A', 9), decks)).toBe(false)
    expect(reduce(initialState, { type: 'next' }, decks)).toEqual(initialState)
  })
})
