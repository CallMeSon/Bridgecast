import { describe, expect, it } from 'vitest'
import {
  fitDip,
  placeRect,
  planHdmi,
  type ScreenDisplay,
  type TargetMemo,
  type WindowView
} from './hdmi-plan'
import { OPERATOR_DISPLAY } from '../shared/displays'

const laptop: ScreenDisplay = {
  id: 1,
  label: 'Layar laptop',
  width: 2880,
  height: 1800,
  primary: true,
  bounds: { x: 0, y: 0, width: 1920, height: 1200 }
}
const projector: ScreenDisplay = {
  id: 2,
  label: 'EPSON PJ',
  width: 1920,
  height: 1080,
  primary: false,
  bounds: { x: 1920, y: 0, width: 1920, height: 1080 }
}
const memo: TargetMemo = { id: 2, label: 'EPSON PJ', width: 1920, height: 1080 }

const none: WindowView = { exists: false, ready: false, visible: false, bounds: null }
const shown: WindowView = { exists: true, ready: true, visible: true, bounds: projector.bounds }
const hidden: WindowView = { ...shown, visible: false }
const on = { enabled: true, displayId: 2 }

describe('planHdmi', () => {
  it('off: destroys an existing window, status off', () => {
    expect(
      planHdmi({ enabled: false, displayId: 2 }, [laptop, projector], memo, shown)
    ).toMatchObject({ action: { type: 'destroy' }, status: { state: 'off' } })
    expect(planHdmi({ enabled: false, displayId: null }, [laptop], null, none)).toMatchObject({
      action: { type: 'none' },
      status: { state: 'off' }
    })
  })

  it('enabled with the display present: creates the window on its bounds (shown once ready)', () => {
    const p = planHdmi(on, [laptop, projector], null, none)
    expect(p.action).toEqual({ type: 'create', bounds: projector.bounds })
    expect(p.status.state).toBe('hidden')
    expect(p.status.message).toMatch(/Menyiapkan/)
    expect(p.memo).toEqual(memo)
    expect(p.targetId).toBe(2)
  })

  it('window became ready: shows it on the display', () => {
    const p = planHdmi(on, [laptop, projector], memo, { ...hidden, ready: true })
    expect(p.action).toEqual({ type: 'show', bounds: projector.bounds })
    expect(p.status).toEqual({ state: 'showing' })
  })

  it('not ready yet: never shows (no white/black flash), only places it', () => {
    const p = planHdmi(on, [laptop, projector], memo, { ...none, exists: true, bounds: null })
    expect(p.action).toEqual({ type: 'setBounds', bounds: projector.bounds })
    expect(p.status.state).toBe('hidden')
  })

  it('already showing on the right bounds: nothing to do', () => {
    expect(planHdmi(on, [laptop, projector], memo, shown)).toEqual({
      action: { type: 'none' },
      status: { state: 'showing' },
      memo,
      targetId: 2
    })
  })

  it('display-removed: hides the window (never moves it to the operator screen)', () => {
    const p = planHdmi(on, [laptop], memo, shown)
    expect(p.action).toEqual({ type: 'hide' })
    expect(p.status).toEqual({ state: 'hidden' })
    expect(p.memo).toEqual(memo) // remembered for the reconnect
    // Already hidden: stays hidden, window kept alive (rendering) for a quick return.
    expect(planHdmi(on, [laptop], memo, hidden).action).toEqual({ type: 'none' })
  })

  it('display-removed with another external display present: still hidden, no jump', () => {
    const tv: ScreenDisplay = {
      ...projector,
      id: 3,
      label: 'SAMSUNG',
      width: 3840,
      height: 2160
    }
    expect(planHdmi(on, [laptop, tv], memo, shown).action).toEqual({ type: 'hide' })
  })

  it('display-added with the same id: shows again on its bounds', () => {
    expect(planHdmi(on, [laptop, projector], memo, hidden).action).toEqual({
      type: 'show',
      bounds: projector.bounds
    })
  })

  it('display-added with a new id: re-matched by label and size', () => {
    const again = { ...projector, id: 99, bounds: { x: -1920, y: 0, width: 1920, height: 1080 } }
    const p = planHdmi(on, [laptop, again], memo, hidden)
    expect(p.action).toEqual({ type: 'show', bounds: again.bounds })
    expect(p.targetId).toBe(99)
    expect(p.memo).toEqual({ ...memo, id: 99 })
  })

  it('label+size fallback never picks another model or size', () => {
    const other = { ...projector, id: 99, label: 'BENQ' }
    expect(planHdmi(on, [laptop, other], memo, hidden).action).toEqual({ type: 'none' })
    const smaller = { ...projector, id: 98, width: 1280, height: 720 }
    expect(planHdmi(on, [laptop, smaller], memo, hidden).status.state).toBe('hidden')
  })

  it('display-metrics-changed: re-applies the new bounds while showing', () => {
    const bigger = {
      ...projector,
      width: 3840,
      height: 2160,
      bounds: { ...projector.bounds, width: 2560, height: 1440 }
    }
    const p = planHdmi(on, [laptop, bigger], memo, shown)
    expect(p.action).toEqual({ type: 'setBounds', bounds: bigger.bounds })
    expect(p.status).toEqual({ state: 'showing' })
    // Moved because the operator screen changed size (the projector now starts further right).
    const moved = { ...projector, bounds: { ...projector.bounds, x: 2560 } }
    expect(planHdmi(on, [laptop, moved], memo, shown).action).toEqual({
      type: 'setBounds',
      bounds: moved.bounds
    })
  })

  it('the chosen display became the Windows primary: hidden with an error and the fix', () => {
    const p = planHdmi(
      on,
      [
        { ...laptop, primary: false },
        { ...projector, primary: true }
      ],
      memo,
      shown
    )
    expect(p.action).toEqual({ type: 'hide' })
    expect(p.status.state).toBe('error')
    expect(p.status.message).toMatch(/layar utama.*Pilih layar lain/)
  })

  describe('operator display (the screen holding the operator window)', () => {
    it('operator on the primary: HDMI shows as usual', () => {
      expect(planHdmi(on, [laptop, projector], memo, hidden, 1).action).toEqual({
        type: 'show',
        bounds: projector.bounds
      })
    })

    it('primary swap, operator stays on the laptop (now non-primary): never covers it', () => {
      const swapped = [
        { ...laptop, primary: false },
        { ...projector, primary: true }
      ]
      const onLaptop = { enabled: true, displayId: 1 }
      const p = planHdmi(onLaptop, swapped, null, shown, 1)
      expect(p.action).toEqual({ type: 'hide' })
      expect(p.status).toEqual({ state: 'error', message: OPERATOR_DISPLAY })
      expect(planHdmi(onLaptop, swapped, null, none, 1).action).toEqual({ type: 'none' })
    })

    it('operator dragged onto the target: hidden with the error, remembered', () => {
      const p = planHdmi(on, [laptop, projector], memo, shown, 2)
      expect(p.action).toEqual({ type: 'hide' })
      expect(p.status).toEqual({ state: 'error', message: OPERATOR_DISPLAY })
      expect(p.memo).toEqual(memo)
      expect(planHdmi(on, [laptop, projector], memo, none, 2).action).toEqual({ type: 'none' })
    })

    it('operator moved back: shown again', () => {
      const away = planHdmi(on, [laptop, projector], memo, shown, 2)
      expect(away.action.type).toBe('hide')
      const back = planHdmi(on, [laptop, projector], away.memo, hidden, 1)
      expect(back.action).toEqual({ type: 'show', bounds: projector.bounds })
      expect(back.status).toEqual({ state: 'showing' })
    })

    it('unknown operator display (null) does not block HDMI', () => {
      expect(planHdmi(on, [laptop, projector], memo, shown, null).action).toEqual({ type: 'none' })
    })
  })

  it('no display chosen (null) and no memo: uses the first non-primary display', () => {
    const p = planHdmi({ enabled: true, displayId: null }, [laptop, projector], null, none)
    expect(p.action).toEqual({ type: 'create', bounds: projector.bounds })
    expect(p.targetId).toBe(2)
  })

  it('saved display missing at startup (no memo): hidden, the window is not even created', () => {
    expect(planHdmi(on, [laptop], null, none)).toEqual({
      action: { type: 'none' },
      status: { state: 'hidden' },
      memo: null,
      targetId: null
    })
  })
})

describe('fitDip / placeRect (exact cover at fractional scaling)', () => {
  // Windows maps a window's DIP size to device pixels as ceil(dip × scale)
  // (measured: 1715 DIP at 112 % → 1921 px on a 1920 px panel, 1714 → 1920).
  const px = (dip: number, sf: number): number => Math.ceil(dip * sf - 1e-6)

  it('picks the DIP size that maps to exactly the native pixels', () => {
    expect(fitDip(1920, 1.1200000047683716)).toBe(1714)
    expect(fitDip(1080, 1.1200000047683716)).toBe(964)
    // Common Windows scalings of common panels all have an exact DIP size.
    for (const [native, sf] of [
      [1920, 1.25],
      [1080, 1.25],
      [1920, 1.5],
      [1080, 1.75],
      [1920, 1.75],
      [2560, 1.25],
      [3840, 1.5],
      [2160, 1.5]
    ]) {
      expect(px(fitDip(native, sf), sf), `${native} px at ${sf}`).toBe(native)
    }
  })

  it('when no DIP size is exact, covers rather than leaving a gap', () => {
    // 2560 px at 150 %: 1706 DIP → 2559 px (gap), 1707 → 2561 px (covers).
    expect(fitDip(2560, 1.5)).toBe(1707)
    expect(fitDip(2560, 3)).toBe(854)
    for (const sf of [1, 1.12, 1.25, 1.5, 1.75, 2, 2.25, 2.5, 3, 3.5]) {
      for (const native of [1080, 1200, 1440, 1920, 2160, 2560, 3840]) {
        const got = px(fitDip(native, sf), sf)
        const exact = Math.floor(native / sf + 1e-6) * sf > native - 1 + 1e-6
        expect(
          exact ? got === native : got > native && got < native + sf,
          `${native} @ ${sf}: ${got}`
        ).toBe(true)
      }
    }
  })

  it('keeps integer scales unchanged', () => {
    expect(fitDip(1920, 1)).toBe(1920)
    expect(fitDip(3840, 2)).toBe(1920)
    expect(fitDip(1920, 1.25)).toBe(1536)
  })

  it('placeRect keeps the display origin and fits the size', () => {
    const d = { ...projector, bounds: { x: 1715, y: 0, width: 1715, height: 965 } }
    expect(placeRect(d, 1.1200000047683716)).toEqual({ x: 1715, y: 0, width: 1714, height: 964 })
    expect(placeRect(projector, 1)).toEqual(projector.bounds)
  })
})
