import { describe, expect, it } from 'vitest'
import {
  NO_SECOND_DISPLAY,
  OPERATOR_DISPLAY,
  displayText,
  hdmiSettingsError,
  nativeLength,
  pickDisplay,
  resolveHdmi,
  toDisplayInfo,
  type DisplayInfo
} from './displays'

const laptop: DisplayInfo = {
  id: 1,
  label: 'Laptop display',
  width: 2880,
  height: 1800,
  primary: true
}
const projector: DisplayInfo = {
  id: 2,
  label: 'EPSON PJ',
  width: 1920,
  height: 1080,
  primary: false
}
const tv: DisplayInfo = { id: 3, label: 'SAMSUNG', width: 3840, height: 2160, primary: false }

describe('pickDisplay', () => {
  it('returns the saved display when it is present and not primary', () => {
    expect(pickDisplay([laptop, projector, tv], 3)).toBe(tv)
    expect(pickDisplay([laptop, projector], 2)).toBe(projector)
  })

  it('returns null when the saved id is the primary (operator) display', () => {
    expect(pickDisplay([laptop, projector], 1)).toBeNull()
  })

  it('returns null when the saved display is missing (never another display)', () => {
    expect(pickDisplay([laptop, projector], 3)).toBeNull()
    expect(pickDisplay([laptop], 2)).toBeNull()
  })

  it('returns the first non-primary display when nothing is saved', () => {
    expect(pickDisplay([laptop, projector, tv], null)).toBe(projector)
    expect(pickDisplay([tv, laptop, projector], null)).toBe(tv)
  })

  it('returns null when only the primary display exists', () => {
    expect(pickDisplay([laptop], null)).toBeNull()
    expect(pickDisplay([], null)).toBeNull()
  })
})

describe('toDisplayInfo / displayText', () => {
  it('reports 1920×1080 for a 1715×965 DIP display at 112 %', () => {
    const d = { id: 7, label: 'X', size: { width: 1715, height: 965 }, scaleFactor: 1.12 }
    expect(toDisplayInfo(d, 1, 0)).toMatchObject({ width: 1920, height: 1080 })
  })

  it('reports the native resolution (DIP size × scale factor) and marks the primary', () => {
    const d = { id: 7, label: 'DELL', size: { width: 1280, height: 720 }, scaleFactor: 1.5 }
    expect(toDisplayInfo(d, 7, 0)).toEqual({
      id: 7,
      label: 'DELL',
      width: 1920,
      height: 1080,
      primary: true
    })
    expect(toDisplayInfo(d, 1, 0).primary).toBe(false)
  })

  it('names a display without a label by its position', () => {
    const d = { id: 9, label: '', size: { width: 1920, height: 1080 }, scaleFactor: 1 }
    expect(toDisplayInfo(d, 1, 1).label).toBe('Display 2')
  })

  it('shows label and resolution, and marks the operator screen', () => {
    expect(displayText(projector)).toBe('EPSON PJ · 1920×1080')
    expect(displayText({ ...projector, operator: true })).toBe(
      'EPSON PJ · 1920×1080 (operator display)'
    )
    expect(displayText({ ...laptop, operator: true })).toBe(
      'Laptop display · 2880×1800 (main display, operator)'
    )
    expect(displayText(laptop)).toBe('Laptop display · 2880×1800 (main display, operator)')
  })
})

describe('nativeLength', () => {
  // Windows reports a display's DIP size rounded up: ceil(pixels / scale).
  it('recovers the pixel size from the DIP size and scale', () => {
    expect(nativeLength(1715, 1.1200000047683716)).toBe(1920) // measured: 1920×1080 at 112 %
    expect(nativeLength(965, 1.1200000047683716)).toBe(1080)
    expect(nativeLength(1536, 1.25)).toBe(1920)
    expect(nativeLength(1280, 1.5)).toBe(1920)
    expect(nativeLength(1920, 1)).toBe(1920)
    expect(nativeLength(1920, 2)).toBe(3840)
  })

  it('prefers the even length when two pixel sizes give the same DIP size', () => {
    expect(nativeLength(1098, 1.75)).toBe(1920) // 1920 or 1921 px → 1098 DIP
    expect(nativeLength(2195, 1.75)).toBe(3840)
    expect(nativeLength(683, 2)).toBe(1366)
  })

  it('round-trips common resolutions at scalings up to 200 %', () => {
    for (const sf of [1, 1.12, 1.25, 1.5, 1.75, 2]) {
      for (const px of [768, 900, 1050, 1080, 1200, 1366, 1440, 1600, 1920, 2160, 2560, 3840]) {
        expect(nativeLength(Math.ceil(px / sf - 1e-6), sf), `${px} @ ${sf}`).toBe(px)
      }
    }
  })
})

describe('hdmiSettingsError', () => {
  const all = [laptop, projector, tv]

  it('accepts a present, non-primary display and turning HDMI off', () => {
    expect(hdmiSettingsError({ enabled: true, displayId: 2 }, all, null)).toBeNull()
    expect(hdmiSettingsError({ enabled: true, displayId: null }, all, null)).toBeNull()
    expect(hdmiSettingsError({ enabled: false, displayId: null }, [laptop], null)).toBeNull()
  })

  it('lets HDMI be turned off while the saved display is unplugged', () => {
    expect(hdmiSettingsError({ enabled: false, displayId: 3 }, [laptop], null)).toBeNull()
  })

  it('always lets HDMI be turned off, even when its display became primary or holds the operator', () => {
    // Projector made the Windows primary: the switch sends exactly this payload.
    const swapped = [
      { ...laptop, primary: false },
      { ...projector, primary: true }
    ]
    expect(hdmiSettingsError({ enabled: false, displayId: 2 }, swapped, 1)).toBeNull()
    expect(hdmiSettingsError({ enabled: false, displayId: 2 }, all, 2)).toBeNull()
    expect(hdmiSettingsError({ enabled: false, displayId: 42 }, all, null)).toBeNull()
  })

  it('rejects the display holding the operator window, with the fix', () => {
    expect(hdmiSettingsError({ enabled: true, displayId: 2 }, all, 2)).toBe(OPERATOR_DISPLAY)
    expect(OPERATOR_DISPLAY).toMatch(/operator window.*Move.*choose a different HDMI display/)
  })

  it('primary swap: the old laptop panel (now non-primary) holds the operator and is refused', () => {
    const swapped = [
      { ...laptop, primary: false },
      { ...projector, primary: true }
    ]
    expect(hdmiSettingsError({ enabled: true, displayId: 1 }, swapped, 1)).toBe(OPERATOR_DISPLAY)
    expect(hdmiSettingsError({ enabled: true, displayId: null }, swapped, 1)).toBe(OPERATOR_DISPLAY)
  })

  it('operator dragged onto the second display: enabling with no choice is refused', () => {
    expect(hdmiSettingsError({ enabled: true, displayId: null }, [laptop, projector], 2)).toBe(
      OPERATOR_DISPLAY
    )
    expect(hdmiSettingsError({ enabled: true, displayId: null }, all, 2)).toBeNull() // tv is free
  })

  it('rejects malformed input', () => {
    expect(hdmiSettingsError(null, all, null)).toMatch(/not valid/)
    expect(hdmiSettingsError({ enabled: 'yes', displayId: 2 }, all, null)).toMatch(/not valid/)
    expect(hdmiSettingsError({ enabled: true, displayId: 2.5 }, all, null)).toMatch(/not valid/)
    expect(hdmiSettingsError({ enabled: true, displayId: '2' }, all, null)).toMatch(/not valid/)
  })

  it('rejects the primary display with an error and the fix', () => {
    expect(hdmiSettingsError({ enabled: true, displayId: 1 }, all, null)).toMatch(
      /main display \(operator\).*Choose the second display/
    )
  })

  it('rejects a display that is not connected', () => {
    expect(hdmiSettingsError({ enabled: true, displayId: 42 }, all, null)).toMatch(/not connected/)
  })

  it('cannot be enabled with only one display', () => {
    expect(hdmiSettingsError({ enabled: true, displayId: null }, [laptop], null)).toBe(
      NO_SECOND_DISPLAY
    )
    expect(NO_SECOND_DISPLAY).toBe(
      'No second display detected. Connect HDMI, then set Windows to Extend mode (Win+P, then Extend).'
    )
  })
})

describe('resolveHdmi', () => {
  it('turns "enabled, no display chosen" into the first non-primary display', () => {
    expect(resolveHdmi({ enabled: true, displayId: null }, [laptop, projector])).toEqual({
      enabled: true,
      displayId: 2
    })
  })

  it('never picks the display holding the operator window', () => {
    expect(resolveHdmi({ enabled: true, displayId: null }, [laptop, projector, tv], 2)).toEqual({
      enabled: true,
      displayId: 3
    })
  })

  it('keeps an explicit choice and the off state as they are', () => {
    expect(resolveHdmi({ enabled: true, displayId: 3 }, [laptop, projector, tv]).displayId).toBe(3)
    expect(resolveHdmi({ enabled: false, displayId: null }, [laptop, projector])).toEqual({
      enabled: false,
      displayId: null
    })
  })
})
