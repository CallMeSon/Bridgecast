import { describe, it, expect } from 'vitest'
import {
  reduce,
  reconcile,
  followSlideOrder,
  initialState,
  kvOnAir,
  locateShown,
  pendingTake,
  segmentOfDeck,
  webKey,
  type ProgramState,
  type ShownSlide
} from './program'

const s = (n: number): { file: string; notes: string }[] =>
  Array.from({ length: n }, (_, i) => ({ file: `${i}.png`, notes: '' }))
/**
 * Slide files are named after their original index (`0.png`, `1.png`, …). Carries
 * the deck defaults, which is what `moveTo` puts on a slide of a plain deck.
 */
const sh = (deckId: string, index: number, file = `${index}.png`): ShownSlide => ({
  deckId,
  index,
  file,
  fit: 'fit',
  audio: { volume: 100, muted: false },
  step: 0,
  playback: 'images'
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
      kv: false,
      kvUrl: null,
      transition: 'cut',
      autoAdvance: false,
      take: 0,
      webHold: false,
      airEvent: null,
      canvas: { width: 1920, height: 1080, origin: 'default' }
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
  it('frozen keeps shown while the position moves; unfreezing keeps shown and returns the position', () => {
    const f = at('A', 0, { frozen: true })
    const r = reduce(f, { type: 'next' }, decks)
    expect(r.index).toBe(1)
    expect(r.shown).toEqual(sh('A', 0))
    const u = reduce(r, { type: 'toggleFreeze' }, decks)
    expect(u.frozen).toBe(false)
    expect(u.shown).toEqual(sh('A', 0))
    expect([u.deckId, u.index]).toEqual(['A', 0])
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
    expect(reduce(initialState, { type: 'toggleFreeze' }, [])).toBe(initialState)
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
  it('clears frozen when shown is gone or the operator deck is gone', () => {
    expect(reconcile(at('A', 1, { frozen: true }), [decks[1]]).frozen).toBe(false)
    expect(reconcile(at('A', 2, { frozen: true }), [{ id: 'A', slides: s(2) }]).frozen).toBe(false)
    const other = at('B', 0, { shown: sh('A', 1), frozen: true })
    expect(reconcile(other, [decks[0]]).frozen).toBe(false)
  })
  it('keeps frozen while shown and the operator deck still exist', () => {
    const st = at('A', 1, { frozen: true })
    expect(reconcile(st, decks)).toBe(st)
    expect(reconcile(at('A', 2, { frozen: true }), [{ id: 'A', slides: s(3) }]).frozen).toBe(true)
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

  it('freeze while STANDBY is a no-op', () => {
    const st = standby('A', 0)
    expect(reduce(st, { type: 'toggleFreeze' }, decks)).toBe(st)
  })

  it('freeze, next, next, unfreeze: the output stays, the position returns to it, Next goes on from there', () => {
    let st = at('A', 0)
    st = reduce(st, { type: 'toggleFreeze' }, decks)
    st = reduce(st, { type: 'next' }, decks)
    st = reduce(st, { type: 'next' }, decks)
    expect(st.shown).toEqual(sh('A', 0))
    expect(st.index).toBe(2)
    st = reduce(st, { type: 'toggleFreeze' }, decks)
    expect(st.frozen).toBe(false)
    expect(st.shown).toEqual(sh('A', 0))
    expect([st.deckId, st.index]).toEqual(['A', 0])
    st = reduce(st, { type: 'next' }, decks)
    expect(st.shown).toEqual(sh('A', 1))
  })

  it('unfreeze after moving to another deck returns the position to the live deck', () => {
    let st = reduce(at('A', 1), { type: 'toggleFreeze' }, decks)
    st = reduce(st, { type: 'selectDeck', deckId: 'B' }, decks)
    st = reduce(st, { type: 'toggleFreeze' }, decks)
    expect(st.shown).toEqual(sh('A', 1))
    expect([st.deckId, st.index]).toEqual(['A', 1])
  })

  it('unfreeze with nothing on the output (stale frozen state) only clears the freeze', () => {
    const st = standby('A', 1, { frozen: true })
    const r = reduce(st, { type: 'toggleFreeze' }, decks)
    expect(r.frozen).toBe(false)
    expect(r.shown).toBeNull()
    expect(r.index).toBe(1)
  })

  it('unfreeze while black keeps black and the same slide behind it', () => {
    let st = at('A', 0, { black: true })
    st = reduce(st, { type: 'toggleFreeze' }, decks)
    st = reduce(st, { type: 'next' }, decks)
    st = reduce(st, { type: 'toggleFreeze' }, decks)
    expect(st.black).toBe(true)
    expect(st.shown).toEqual(sh('A', 0))
  })

  it('unfreeze with an invalid position returns it to the live slide', () => {
    const st = at('A', 0, { frozen: true, deckId: 'gone' })
    const r = reduce(st, { type: 'toggleFreeze' }, decks)
    expect(r.frozen).toBe(false)
    expect(r.shown).toEqual(sh('A', 0))
    expect([r.deckId, r.index]).toEqual(['A', 0])
  })

  it('unfreeze with the live slide outside these decks only clears the freeze', () => {
    const st = at('B', 1, { frozen: true, shown: sh('OTHER', 4) })
    const r = reduce(st, { type: 'toggleFreeze' }, decks)
    expect(r).toEqual({ ...st, frozen: false })
  })

  it('unfreeze without moving keeps the same shown slide', () => {
    const r = reduce(at('A', 1, { frozen: true }), { type: 'toggleFreeze' }, decks)
    expect(r.shown).toEqual(sh('A', 1))
  })

  it('no take without a valid position', () => {
    expect(pendingTake(initialState, decks)).toBe(false)
    expect(pendingTake(standby('A', 9), decks)).toBe(false)
    expect(reduce(initialState, { type: 'next' }, decks)).toEqual(initialState)
  })
})

describe('KV', () => {
  const KV_URL = 'slide://kv/e/k.png'
  it('toggleKv without a KV is a no-op returning the same object', () => {
    const st = at('A', 0)
    expect(reduce(st, { type: 'toggleKv' }, decks)).toBe(st)
    expect(reduce(initialState, { type: 'toggleKv' }, [])).toBe(initialState)
  })
  it('toggleKv turns KV on and Black off, and off again', () => {
    const st = at('A', 1, { kvUrl: KV_URL, black: true })
    const on = reduce(st, { type: 'toggleKv' }, decks)
    expect(on).toEqual({ ...st, kv: true, black: false })
    expect(on.shown).toEqual(st.shown)
    const off = reduce(on, { type: 'toggleKv' }, decks)
    expect(off).toEqual({ ...st, kv: false, black: false })
  })
  it('toggleKv while frozen turns KV on, keeping position and shown', () => {
    const fz = at('A', 2, { kvUrl: KV_URL, frozen: true })
    const r = reduce(fz, { type: 'toggleKv' }, decks)
    expect(r).toEqual({ ...fz, kv: true })
  })
  it('kvOnAir: automatic at STANDBY, forced with a slide, never with black or without a KV', () => {
    expect(kvOnAir(at('A', 0, { shown: null, kvUrl: KV_URL }))).toBe(true)
    expect(kvOnAir(at('A', 0, { kvUrl: KV_URL }))).toBe(false)
    expect(kvOnAir(at('A', 0, { kvUrl: KV_URL, kv: true }))).toBe(true)
    expect(kvOnAir(at('A', 0, { shown: null, kvUrl: KV_URL, black: true }))).toBe(false)
    expect(kvOnAir(at('A', 0, { shown: null }))).toBe(false)
    expect(kvOnAir(at('A', 0, { kv: true }))).toBe(false)
  })
  it('STANDBY with a KV: K goes black (output leaves the KV), K again brings the KV back', () => {
    const st = at('A', 0, { shown: null, kvUrl: KV_URL })
    const off = reduce(st, { type: 'toggleKv' }, decks)
    expect(off).toMatchObject({ kv: false, black: true })
    expect(kvOnAir(off)).toBe(false)
    const on = reduce(off, { type: 'toggleKv' }, decks)
    expect(on).toMatchObject({ kv: true, black: false })
    expect(kvOnAir(on)).toBe(true)
    const again = reduce(on, { type: 'toggleKv' }, decks)
    expect(again).toMatchObject({ kv: false, black: true })
  })
  it('LIVE: K puts the KV on, K again returns to the slide (no black)', () => {
    const st = at('A', 1, { kvUrl: KV_URL })
    const on = reduce(st, { type: 'toggleKv' }, decks)
    expect(kvOnAir(on)).toBe(true)
    const back = reduce(on, { type: 'toggleKv' }, decks)
    expect(back).toEqual(st)
  })
  it('toggleKv can turn KV off even if kvUrl went away', () => {
    const st = at('A', 0, { kv: true, kvUrl: null })
    expect(reduce(st, { type: 'toggleKv' }, decks).kv).toBe(false)
  })
  it('toggleKv is a no-op for a stale kv flag only when it is already off', () => {
    const st = at('A', 0, { kv: false, kvUrl: null })
    expect(reduce(st, { type: 'toggleKv' }, decks)).toBe(st)
  })
  it('toggleBlack turning Black on turns KV off; turning it off leaves KV off', () => {
    const st = at('A', 0, { kvUrl: KV_URL, kv: true })
    const b = reduce(st, { type: 'toggleBlack' }, decks)
    expect(b.black).toBe(true)
    expect(b.kv).toBe(false)
    const back = reduce(b, { type: 'toggleBlack' }, decks)
    expect(back.black).toBe(false)
    expect(back.kv).toBe(false)
  })
  it('the reducer never sets kvUrl', () => {
    const st = at('A', 0, { kvUrl: KV_URL })
    for (const a of [
      { type: 'next' },
      { type: 'toggleKv' },
      { type: 'toggleBlack' },
      { type: 'toggleFreeze' },
      { type: 'selectDeck', deckId: 'B' }
    ] as const) {
      expect(reduce(st, a, decks).kvUrl).toBe(KV_URL)
    }
    expect(reduce(at('A', 0), { type: 'toggleKv' }, decks).kvUrl).toBeNull()
  })
})

describe('take and video', () => {
  it('next/goto/selectDeck increment take; goto on the live slide replays', () => {
    const r1 = reduce(at('A', 0), { type: 'next' }, decks)
    expect(r1.take).toBe(1)
    const r2 = reduce(r1, { type: 'goto', index: 1 }, decks)
    expect(r2.take).toBe(2)
    expect(r2.shown).toEqual(r1.shown)
    expect(reduce(r2, { type: 'selectDeck', deckId: 'B' }, decks).take).toBe(3)
  })
  it('freeze, black, kv, transition, autoAdvance, unfreeze keep take', () => {
    const base = at('A', 1, { take: 5, kvUrl: 'x' })
    const actions = [
      { type: 'toggleFreeze' },
      { type: 'toggleBlack' },
      { type: 'toggleKv' },
      { type: 'setTransition', transition: 'fade' },
      { type: 'setAutoAdvance', on: true }
    ] as const
    for (const a of actions) expect(reduce(base, a, decks).take).toBe(5)
    const frozen = at('A', 1, { take: 5, frozen: true })
    expect(reduce(frozen, { type: 'toggleFreeze' }, decks).take).toBe(5)
    expect(reduce(frozen, { type: 'next' }, decks).take).toBe(5)
  })
  it('take on STANDBY first Next increments take', () => {
    const standby = { ...initialState, deckId: 'A', index: 0 }
    const r = reduce(standby, { type: 'next' }, decks)
    expect(r.take).toBe(1)
    expect(r.shown).toEqual(sh('A', 0))
  })
  it('shown carries the slide video', () => {
    const vd = [
      {
        id: 'V',
        slides: [
          { file: '001.png', notes: '', video: '001.mp4' },
          { file: '002.png', notes: '' }
        ]
      }
    ]
    const r = reduce(initialState, { type: 'selectDeck', deckId: 'V' }, vd)
    expect(r.shown?.video).toBe('001.mp4')
    const n = reduce(r, { type: 'next' }, vd)
    expect(n.shown).toMatchObject({ deckId: 'V', index: 1, file: '002.png' })
    expect('video' in n.shown!).toBe(false)
  })
  it('reconcile and followSlideOrder keep take and video', () => {
    const vd = [
      {
        id: 'V',
        slides: [
          { file: '001.png', notes: '' },
          { file: '002.png', notes: '', video: '002.mp4' }
        ]
      }
    ]
    const st: ProgramState = {
      ...initialState,
      deckId: 'V',
      index: 1,
      take: 7,
      shown: { deckId: 'V', index: 1, file: '002.png', video: '002.mp4', step: 0 }
    }
    const f = followSlideOrder(st, 'V', [1, 0])
    expect(f.take).toBe(7)
    expect(f.shown).toEqual({ deckId: 'V', index: 0, file: '002.png', video: '002.mp4', step: 0 })
    const reordered = [{ id: 'V', slides: [vd[0].slides[1], vd[0].slides[0]] }]
    const r = reconcile(st, reordered)
    expect(r.take).toBe(7)
    expect(r.shown).toMatchObject({ deckId: 'V', index: 0, file: '002.png', video: '002.mp4' })
  })
})

describe('sections', () => {
  const sd = [
    { id: 'A', slides: s(3) },
    { id: 'B', slides: s(2) },
    { id: 'C', slides: s(2) },
    { id: 'D', slides: s(0) },
    { id: 'E', slides: s(1) }
  ]
  const s1 = [{ id: 's1', name: 'Sesi 1', at: 2 }]
  const pos = (r: ProgramState): [string | null, number] => [r.deckId, r.index]

  it('auto on: Next/Prev stop at the section boundary, but move inside a segment', () => {
    const atB1 = at('B', 1, { autoAdvance: true })
    expect(reduce(atB1, { type: 'next' }, sd, s1)).toBe(atB1)
    const atC0 = at('C', 0, { autoAdvance: true })
    expect(reduce(atC0, { type: 'prev' }, sd, s1)).toBe(atC0)
    const r = reduce(at('A', 2, { autoAdvance: true }), { type: 'next' }, sd, s1)
    expect(pos(r)).toEqual(['B', 0])
  })
  it('auto on: Next steps over a deck without slides inside a segment', () => {
    const r = reduce(at('C', 1, { autoAdvance: true }), { type: 'next' }, sd, s1)
    expect(pos(r)).toEqual(['E', 0])
  })
  it('auto off with sections: stays in the deck as before', () => {
    const atA2 = at('A', 2)
    expect(reduce(atA2, { type: 'next' }, sd, s1)).toBe(atA2)
    expect(pos(reduce(at('A', 1), { type: 'next' }, sd, s1))).toEqual(['A', 2])
  })
  it('nextSection from A/1 goes to C/0 and counts a take', () => {
    const st = at('A', 1, { take: 4 })
    const r = reduce(st, { type: 'nextSection' }, sd, s1)
    expect(pos(r)).toEqual(['C', 0])
    expect(r.shown).toEqual(sh('C', 0))
    expect(r.take).toBe(5)
  })
  it('prevSection from C/1 goes to A/0 (leading block); in the leading block unchanged', () => {
    expect(pos(reduce(at('C', 1), { type: 'prevSection' }, sd, s1))).toEqual(['A', 0])
    const st = at('B', 1)
    expect(reduce(st, { type: 'prevSection' }, sd, s1)).toBe(st)
  })
  it('nextSection at the last segment is unchanged', () => {
    const st = at('E', 0)
    expect(reduce(st, { type: 'nextSection' }, sd, s1)).toBe(st)
  })
  it('skips empty sections and decks without slides', () => {
    const three = [
      { id: 's1', name: 'S1', at: 2 },
      { id: 's2', name: 'S2', at: 2 },
      { id: 's3', name: 'S3', at: 3 }
    ]
    expect(pos(reduce(at('A', 0), { type: 'nextSection' }, sd, three))).toEqual(['C', 0])
    expect(pos(reduce(at('C', 0), { type: 'nextSection' }, sd, three))).toEqual(['E', 0])
    expect(pos(reduce(at('E', 0), { type: 'prevSection' }, sd, three))).toEqual(['C', 0])
  })
  it('skips a segment whose decks were removed (Review Focus 1)', () => {
    // Originally A,B,C,E with s1 at 2 (C) and s2 at 3 (E); C is removed.
    const rest = [sd[0], sd[1], sd[4]]
    const adjusted = [
      { id: 's1', name: 'S1', at: 2 },
      { id: 's2', name: 'S2', at: 2 }
    ]
    expect(pos(reduce(at('A', 0), { type: 'nextSection' }, rest, adjusted))).toEqual(['E', 0])
    // Not adjusted by the caller: at 3 clamps to the end, s2 is empty, s1 holds E.
    const stale = [
      { id: 's1', name: 'S1', at: 2 },
      { id: 's2', name: 'S2', at: 3 }
    ]
    expect(pos(reduce(at('A', 0), { type: 'nextSection' }, rest, stale))).toEqual(['E', 0])
    const st = at('E', 0)
    expect(reduce(st, { type: 'nextSection' }, rest, stale)).toBe(st)
  })
  it('frozen: nextSection moves the position but not shown or take', () => {
    const st = at('A', 1, { frozen: true, take: 3 })
    const r = reduce(st, { type: 'nextSection' }, sd, s1)
    expect(pos(r)).toEqual(['C', 0])
    expect(r.shown).toBe(st.shown)
    expect(r.take).toBe(3)
  })
  it('STANDBY: nextSection takes the first segment with slides at slide 0; prevSection unchanged', () => {
    const r = reduce(initialState, { type: 'nextSection' }, sd, s1)
    expect(pos(r)).toEqual(['A', 0])
    expect(r.shown).toEqual(sh('A', 0))
    expect(reduce(initialState, { type: 'prevSection' }, sd, s1)).toBe(initialState)
  })
  it('STANDBY with a valid position: nextSection takes the first section, not the second', () => {
    const open = [
      { id: 'o', name: 'Opening', at: 0 },
      { id: 't1', name: 'Talk 1', at: 2 }
    ]
    const standby: ProgramState = { ...initialState, deckId: 'A', index: 0, take: 2 }
    expect(pendingTake(standby, sd)).toBe(true)
    const r = reduce(standby, { type: 'nextSection' }, sd, open)
    expect(pos(r)).toEqual(['A', 0])
    expect(r.shown).toEqual(sh('A', 0))
    expect(r.take).toBe(3)
    // prevSection keeps today's behaviour: nothing before the first segment.
    expect(reduce(standby, { type: 'prevSection' }, sd, open)).toBe(standby)
  })
  it('pending take from another event: nextSection takes the position segment first', () => {
    const away = at('C', 1, { shown: sh('X', 0) })
    expect(pendingTake(away, sd)).toBe(true)
    const r = reduce(away, { type: 'nextSection' }, sd, s1)
    expect(pos(r)).toEqual(['C', 0])
    expect(r.shown).toEqual(sh('C', 0))
    expect(r.take).toBe(away.take + 1)
  })
  it('selectSection jumps to the section; unknown or slideless is unchanged', () => {
    expect(pos(reduce(at('A', 1), { type: 'selectSection', sectionId: 's1' }, sd, s1))).toEqual([
      'C',
      0
    ])
    const st = at('A', 1)
    expect(reduce(st, { type: 'selectSection', sectionId: 'nope' }, sd, s1)).toBe(st)
    const slideless = [{ id: 'z', name: 'Z', at: 3 }]
    const onlyD = [sd[0], sd[1], sd[2], sd[3]]
    expect(reduce(st, { type: 'selectSection', sectionId: 'z' }, onlyD, slideless)).toBe(st)
  })
  it('without sections nextSection/prevSection are unchanged', () => {
    const st = at('A', 1)
    expect(reduce(st, { type: 'nextSection' }, sd)).toBe(st)
    expect(reduce(st, { type: 'prevSection' }, sd)).toBe(st)
  })
  it('without sections nextSection does nothing from STANDBY or a stale deck', () => {
    expect(reduce(initialState, { type: 'nextSection' }, sd)).toBe(initialState)
    expect(reduce(initialState, { type: 'nextSection' }, sd, [])).toBe(initialState)
    const stale = at('gone', 0)
    expect(reduce(stale, { type: 'nextSection' }, sd)).toBe(stale)
    expect(reduce(stale, { type: 'prevSection' }, sd)).toBe(stale)
    expect(reduce(initialState, { type: 'selectSection', sectionId: 's1' }, sd)).toBe(initialState)
  })
  it('a pending take keeps priority over section boundaries', () => {
    const away = at('B', 1, { autoAdvance: true, shown: sh('X', 0) })
    const r = reduce(away, { type: 'next' }, sd, s1)
    expect(pos(r)).toEqual(['B', 1])
    expect(r.shown).toEqual(sh('B', 1))
    const r2 = reduce(away, { type: 'prev' }, sd, s1)
    expect(pos(r2)).toEqual(['B', 1])
    expect(r2.take).toBe(away.take + 1)
  })
  it('segmentOfDeck maps a deck to its segment index or -1', () => {
    expect(segmentOfDeck(sd, s1, 'A')).toBe(0)
    expect(segmentOfDeck(sd, s1, 'E')).toBe(1)
    expect(segmentOfDeck(sd, s1, null)).toBe(-1)
    expect(segmentOfDeck(sd, s1, 'nope')).toBe(-1)
    expect(segmentOfDeck(sd, [], 'B')).toBe(0)
  })
})

describe('fit and deck audio on shown', () => {
  const plain = { id: 'D', slides: s(3) }
  const styled = {
    id: 'D',
    slides: s(3),
    fit: 'fill' as const,
    audio: { volume: 40, muted: false }
  }

  it('next onto a deck with fit and audio puts both on shown', () => {
    const r = reduce({ ...initialState, deckId: 'D', index: 0 }, { type: 'next' }, [styled])
    expect(r.shown?.fit).toBe('fill')
    expect(r.shown?.audio).toEqual({ volume: 40, muted: false })
  })

  it('a deck without fit and audio gives the defaults', () => {
    const r = reduce({ ...initialState, deckId: 'D', index: 0 }, { type: 'next' }, [plain])
    expect(r.shown?.fit).toBe('fit')
    expect(r.shown?.audio).toEqual({ volume: 100, muted: false })
  })

  it('reconcile after the live deck changed fit gives the new fit with the same take', () => {
    const live: ProgramState = {
      ...initialState,
      deckId: 'D',
      index: 1,
      take: 9,
      shown: sh('D', 1)
    }
    const r = reconcile(live, [{ ...plain, fit: 'stretch' }])
    expect(r.shown?.fit).toBe('stretch')
    expect(r.take).toBe(9)
  })

  it('reconcile after the live deck changed volume or mute keeps take', () => {
    const live: ProgramState = {
      ...initialState,
      deckId: 'D',
      index: 1,
      take: 9,
      shown: sh('D', 1)
    }
    const r = reconcile(live, [{ ...plain, audio: { volume: 20, muted: true } }])
    expect(r.shown?.audio).toEqual({ volume: 20, muted: true })
    expect(r.take).toBe(9)
  })

  it('locateShown returns the identical object when nothing changed', () => {
    const shown = { ...sh('D', 1), fit: 'fill' as const, audio: { volume: 40, muted: false } }
    expect(locateShown(shown, styled)).toBe(shown)
  })

  it('locateShown returns the identical old-style shown on a deck without fit and audio', () => {
    const old: ShownSlide = { deckId: 'D', index: 1, file: '1.png', step: 0 }
    expect(locateShown(old, plain)).toBe(old)
  })

  it('locateShown returns a new object when only the muted flag changed', () => {
    const shown = sh('D', 1)
    const r = locateShown(shown, { ...plain, audio: { volume: 100, muted: true } })
    expect(r).not.toBe(shown)
    expect(r?.audio?.muted).toBe(true)
  })
})

describe('web decks', () => {
  const webDeck = (
    id: string
  ): (typeof decks)[number] & { source: 'web'; web: { url: string } } => ({
    id,
    slides: s(1),
    source: 'web',
    web: { url: 'https://x.org/' }
  })
  const wdecks = [{ id: 'A', slides: s(3) }, webDeck('W'), { id: 'B', slides: s(2) }]
  const live = (extra: Partial<ProgramState> = {}): ProgramState => ({
    ...at('W', 0, extra),
    shown: { ...sh('W', 0), web: { deckId: 'W' } },
    ...extra
  })

  it('moveTo marks a web slide', () => {
    expect(reduce(at('A', 0), { type: 'selectDeck', deckId: 'W' }, wdecks).shown?.web).toEqual({
      deckId: 'W'
    })
    expect(
      reduce(at('B', 0), { type: 'selectDeck', deckId: 'A' }, wdecks).shown?.web
    ).toBeUndefined()
  })

  it('next/prev on a live web deck return the same state, also with auto advance', () => {
    for (const autoAdvance of [false, true]) {
      const st = live({ autoAdvance })
      expect(reduce(st, { type: 'next' }, wdecks)).toBe(st)
      expect(reduce(st, { type: 'prev' }, wdecks)).toBe(st)
    }
  })

  it('a frozen web deck moves the preview normally', () => {
    const st = live({ frozen: true, autoAdvance: true })
    const r = reduce(st, { type: 'next' }, wdecks)
    expect(r.deckId).toBe('B')
    expect(r.shown).toBe(st.shown)
  })

  it('nextDeck/prevDeck go to slide 0 of the neighbouring deck, across sections', () => {
    const sections = [{ id: 's', name: 'S', at: 1 }]
    const r = reduce(at('A', 2), { type: 'nextDeck' }, wdecks, sections)
    expect(r.deckId).toBe('W')
    expect(r.index).toBe(0)
    expect(r.shown?.deckId).toBe('W')
    const p = reduce(r, { type: 'prevDeck' }, wdecks, sections)
    expect(p.deckId).toBe('A')
    expect(p.index).toBe(0)
  })

  it('nextDeck works from a live web deck and skips decks without slides', () => {
    const ds = [webDeck('W'), { id: 'E', slides: [] }, { id: 'B', slides: s(2) }]
    expect(reduce(live(), { type: 'nextDeck' }, ds).deckId).toBe('B')
  })

  it('nextDeck from a pending take takes the pending deck first (not the one after it)', () => {
    // After an event switch the output still shows a slide of the old event (Z).
    const st: ProgramState = { ...at('A', 1), shown: { ...sh('Z', 0), web: { deckId: 'Z' } } }
    const r = reduce(st, { type: 'nextDeck' }, wdecks)
    expect(r.deckId).toBe('A')
    expect(r.index).toBe(0)
    expect(r.shown?.deckId).toBe('A')
    // Same deck Next would take.
    expect(reduce(st, { type: 'next' }, wdecks).shown?.deckId).toBe('A')
  })

  it('nextDeck/prevDeck at the ends return the same state', () => {
    const last = at('B', 1)
    expect(reduce(last, { type: 'nextDeck' }, wdecks)).toBe(last)
    const first = at('A', 0)
    expect(reduce(first, { type: 'prevDeck' }, wdecks)).toBe(first)
  })

  it('frozen nextDeck previews only', () => {
    const st = at('A', 0, { frozen: true })
    const r = reduce(st, { type: 'nextDeck' }, wdecks)
    expect(r.deckId).toBe('W')
    expect(r.shown).toBe(st.shown)
  })

  it('webHold is cleared by K, B, taking another deck and resumeWeb, not by next', () => {
    const held = live({ webHold: true, kvUrl: 'x' })
    expect(reduce(held, { type: 'toggleKv' }, wdecks).webHold).toBe(false)
    expect(reduce(held, { type: 'toggleBlack' }, wdecks).webHold).toBe(false)
    expect(reduce(held, { type: 'selectDeck', deckId: 'A' }, wdecks).webHold).toBe(false)
    expect(reduce(held, { type: 'nextDeck' }, wdecks).webHold).toBe(false)
    expect(reduce(held, { type: 'resumeWeb' }, wdecks).webHold).toBe(false)
    expect(reduce(held, { type: 'next' }, wdecks).webHold).toBe(true)
    expect(reduce(held, { type: 'selectDeck', deckId: 'W' }, wdecks).webHold).toBe(true)
  })

  it('resumeWeb without a hold returns the same state', () => {
    const st = live()
    expect(reduce(st, { type: 'resumeWeb' }, wdecks)).toBe(st)
  })

  it('webKey forwards one arrow only for next/prev on a live, unfrozen operator web deck', () => {
    const st = live()
    expect(webKey(st, wdecks, { type: 'next' })).toBe('ArrowRight')
    expect(webKey(st, wdecks, { type: 'prev' })).toBe('ArrowLeft')
    expect(webKey(st, wdecks, { type: 'toggleKv' })).toBeNull()
    expect(webKey({ ...st, frozen: true }, wdecks, { type: 'next' })).toBeNull()
    expect(webKey({ ...st, deckId: 'A' }, wdecks, { type: 'next' })).toBeNull()
    expect(webKey(at('A', 0), wdecks, { type: 'next' })).toBeNull()
    expect(webKey(initialState, wdecks, { type: 'next' })).toBeNull()
  })
})

describe('native steps, hidden slides and fallback', () => {
  const sl = (clicks: number, hidden = false) => ({
    file: `${clicks}-${hidden}.png`,
    notes: '',
    clicks,
    hidden
  })
  const nd = [
    {
      id: 'N',
      playback: 'native' as const,
      slides: [
        { file: 'n0.png', notes: '', clicks: 3 },
        { file: 'n1.png', notes: '', clicks: 2, hidden: true },
        { file: 'n2.png', notes: '', clicks: 0 },
        { file: 'n3.png', notes: '', clicks: 2 }
      ]
    },
    { id: 'V', playback: 'vector' as const, slides: [sl(2), sl(2)] }
  ]
  const live = (index = 0, step = 0, extra: Partial<ProgramState> = {}): ProgramState => ({
    ...initialState,
    deckId: 'N',
    index,
    take: 5,
    shown: { ...sh('N', index, nd[0].slides[index].file), playback: 'native', step },
    ...extra
  })

  it('a taken native slide starts at step 0', () => {
    const r = reduce(initialState, { type: 'selectDeck', deckId: 'N' }, nd)
    expect(r.shown?.playback).toBe('native')
    expect(r.shown?.step).toBe(0)
  })

  it('next steps through the clicks without a take, then the next slide takes', () => {
    let st = live()
    for (let i = 1; i <= 3; i++) {
      st = reduce(st, { type: 'next' }, nd)
      expect(st.shown?.step).toBe(i)
      expect(st.index).toBe(0)
      expect(st.take).toBe(5)
    }
    st = reduce(st, { type: 'next' }, nd)
    expect(st.index).toBe(2) // slide 1 is hidden
    expect(st.shown?.step).toBe(0)
    expect(st.take).toBe(6)
  })

  it('a slide with no counted clicks is not waited on', () => {
    const st = reduce(live(2), { type: 'next' }, nd)
    expect(st.index).toBe(3)
    expect(st.take).toBe(6)
  })

  it('prev steps back, then lands on the previous non-hidden slide fully built', () => {
    let st = live(2, 0)
    st = reduce(st, { type: 'prev' }, nd)
    expect(st.index).toBe(0)
    expect(st.shown?.step).toBe(3)
    expect(st.take).toBe(6)
    st = reduce(st, { type: 'prev' }, nd)
    expect(st.shown?.step).toBe(2)
    expect(st.take).toBe(6)
  })

  it('hidden slide is skipped forward and back in every mode', () => {
    const img = [{ id: 'I', slides: [sl(0), sl(0, true), sl(0)] }]
    const a = reduce(
      { ...initialState, deckId: 'I', index: 0, shown: sh('I', 0, img[0].slides[0].file) },
      { type: 'next' },
      img
    )
    expect(a.index).toBe(2)
    expect(reduce(a, { type: 'prev' }, img).index).toBe(0)
  })

  it('vector deck has no steps', () => {
    const st = reduce(initialState, { type: 'selectDeck', deckId: 'V' }, nd)
    expect(st.shown?.playback).toBe('vector')
    const n = reduce(st, { type: 'next' }, nd)
    expect(n.index).toBe(1)
    expect(n.shown?.step).toBe(0)
    expect(reduce(n, { type: 'prev' }, nd).shown?.step).toBe(0)
  })

  it('goto resets the step', () => {
    expect(reduce(live(0, 2), { type: 'goto', index: 3 }, nd).shown?.step).toBe(0)
  })

  it('enginePosition corrects index and step without changing take', () => {
    const r = reduce(live(0, 1), { type: 'enginePosition', deckId: 'N', index: 3, step: 1 }, nd)
    expect(r.index).toBe(3)
    expect(r.shown?.index).toBe(3)
    expect(r.shown?.file).toBe('n3.png')
    expect(r.shown?.step).toBe(1)
    expect(r.take).toBe(5)
    const r2 = reduce(live(0, 1), { type: 'enginePosition', deckId: 'N', index: 0, step: 2 }, nd)
    expect(r2.shown?.step).toBe(2)
    expect(r2.take).toBe(5)
    const other = live(0, 1)
    expect(reduce(other, { type: 'enginePosition', deckId: 'X', index: 3, step: 0 }, nd)).toBe(
      other
    )
  })

  it('fallback then next moves per slide; resume goes back to native fully built', () => {
    let st = reduce(live(0, 1), { type: 'nativeFallback', deckId: 'N' }, nd)
    expect(st.shown?.playback).toBe('images')
    st = reduce(st, { type: 'next' }, nd)
    expect(st.index).toBe(2)
    st = reduce(st, { type: 'resumeNative', deckId: 'N' }, nd)
    expect(st.shown?.playback).toBe('native')
    expect(st.shown?.step).toBe(0)
    const r = reduce(
      reduce(live(3, 0), { type: 'nativeFallback', deckId: 'N' }, nd),
      { type: 'resumeNative', deckId: 'N' },
      nd
    )
    expect(r.shown?.step).toBe(2)
  })
})

describe('offAir', () => {
  it('offAir from live goes to STANDBY and keeps the position', () => {
    const st = at('A', 2, { take: 5 })
    const r = reduce(st, { type: 'offAir' }, decks)
    expect(r).toMatchObject({
      shown: null,
      frozen: false,
      black: false,
      kv: false,
      webHold: false,
      deckId: 'A',
      index: 2,
      take: 5
    })
  })

  it('offAir clears freeze, black and a pressed KV', () => {
    const KV_URL = 'slide://x/kv.png'
    const inputs: Partial<ProgramState>[] = [
      { frozen: true },
      { black: true },
      { kv: true, kvUrl: KV_URL }
    ]
    for (const extra of inputs) {
      const r = reduce(at('A', 1, extra), { type: 'offAir' }, decks)
      expect(r.shown === null && !r.black && !r.kv && !r.frozen).toBe(true)
    }
  })

  it('offAir at STANDBY returns the same object', () => {
    expect(reduce(initialState, { type: 'offAir' }, [])).toBe(initialState)
  })

  it('offAir clears webHold', () => {
    const st = at('W', 0, {
      webHold: true,
      shown: { ...sh('W', 0), web: { deckId: 'W' } }
    })
    expect(reduce(st, { type: 'offAir' }, decks)).toMatchObject({ shown: null, webHold: false })
  })
})
