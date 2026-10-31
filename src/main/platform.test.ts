import { describe, expect, it } from 'vitest'
import {
  INSTALL_LIBREOFFICE,
  NO_POWERPOINT_ENGINE,
  WAYLAND_STILLS,
  detectEngine,
  engineName
} from './platform'

const linux = { platform: 'linux' as const, hasSoffice: true, hasPyUno: true }

describe('detectEngine', () => {
  it('uses PowerPoint on Windows and can capture', () => {
    expect(detectEngine({ platform: 'win32', hasSoffice: false, hasPyUno: false })).toEqual({
      engine: 'powerpoint',
      canCapture: true
    })
  })

  it('uses LibreOffice on Linux with X11 and both tools', () => {
    expect(detectEngine({ ...linux, sessionType: 'x11' })).toEqual({
      engine: 'libreoffice',
      canCapture: true
    })
    expect(detectEngine(linux)).toEqual({ engine: 'libreoffice', canCapture: true })
  })

  it('imports but cannot capture on Wayland, with the Wayland copy', () => {
    expect(detectEngine({ ...linux, sessionType: 'wayland' })).toEqual({
      engine: 'libreoffice',
      canCapture: false,
      message: WAYLAND_STILLS
    })
  })

  it('has no engine on Linux without soffice, with the install copy', () => {
    expect(detectEngine({ ...linux, sessionType: 'x11', hasSoffice: false })).toEqual({
      engine: 'none',
      canCapture: false,
      message: INSTALL_LIBREOFFICE
    })
  })

  it('has no engine on Linux without python3-uno, with the install copy', () => {
    const r = detectEngine({ ...linux, hasPyUno: false })
    expect(r.engine).toBe('none')
    expect(r.message).toBe(INSTALL_LIBREOFFICE)
  })

  it('has no engine on macOS', () => {
    const r = detectEngine({ platform: 'darwin', hasSoffice: true, hasPyUno: true })
    expect(r).toEqual({ engine: 'none', canCapture: false, message: NO_POWERPOINT_ENGINE })
  })

  it('copies the exact install and Wayland strings', () => {
    expect(INSTALL_LIBREOFFICE).toBe(
      'Install LibreOffice Impress and python3-uno to import PowerPoint files, or export the file to PDF and import the PDF.'
    )
    expect(WAYLAND_STILLS).toBe(
      "Animated slides need an X11 session on Linux. Log in with 'GNOME on Xorg' to play animations; showing still slides."
    )
  })
})

describe('engineName', () => {
  it('names the program', () => {
    expect(engineName('libreoffice')).toBe('LibreOffice')
    expect(engineName('powerpoint')).toBe('PowerPoint')
    expect(engineName('none')).toBe('PowerPoint')
  })
})
