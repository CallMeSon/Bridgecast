import { describe, expect, it } from 'vitest'
import {
  canSelfUpdate,
  INSTALL_LIBREOFFICE,
  NO_POWERPOINT_ENGINE,
  WAYLAND_STILLS,
  detectEngine,
  engineName,
  needsX11Relaunch,
  x11RelaunchOptions
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
})

describe('engineName', () => {
  it('names the program', () => {
    expect(engineName('libreoffice')).toBe('LibreOffice')
    expect(engineName('powerpoint')).toBe('PowerPoint')
    expect(engineName('none')).toBe('PowerPoint')
  })
})

describe('needsX11Relaunch', () => {
  const wayland = { XDG_SESSION_TYPE: 'wayland', WAYLAND_DISPLAY: 'wayland-0', DISPLAY: ':0' }
  it('restarts on X11 in a Wayland session with an X server', () => {
    expect(needsX11Relaunch('linux', wayland, ['electron', '.'])).toBe(true)
  })
  it('does not restart twice, on other systems, on X11 or without an X server', () => {
    expect(needsX11Relaunch('linux', wayland, ['electron', '--ozone-platform=x11'])).toBe(false)
    expect(needsX11Relaunch('win32', wayland, [])).toBe(false)
    expect(needsX11Relaunch('linux', { XDG_SESSION_TYPE: 'x11', DISPLAY: ':0' }, [])).toBe(false)
    expect(needsX11Relaunch('linux', { ...wayland, DISPLAY: undefined }, [])).toBe(false)
  })
})

describe('x11RelaunchOptions', () => {
  it('adds the X11 flag and keeps the arguments', () => {
    expect(x11RelaunchOptions({}, ['/opt/Bridgecast/bridgecast', '--foo'])).toEqual({
      args: ['--foo', '--ozone-platform=x11']
    })
  })
  it('restarts an AppImage through the .AppImage file, not the mount that disappears on exit', () => {
    expect(
      x11RelaunchOptions({ APPIMAGE: '/home/u/Bridgecast.AppImage' }, ['/tmp/.mount_x/bridgecast'])
    ).toEqual({ execPath: '/home/u/Bridgecast.AppImage', args: ['--ozone-platform=x11'] })
  })
})

describe('canSelfUpdate', () => {
  const base = { packaged: true, platform: 'linux' as const, env: {}, packageType: null }

  it('is true for Windows, an AppImage and a .deb install', () => {
    expect(canSelfUpdate({ ...base, platform: 'win32' })).toBe(true)
    expect(canSelfUpdate({ ...base, env: { APPIMAGE: '/x/b.AppImage' } })).toBe(true)
    expect(canSelfUpdate({ ...base, packageType: 'deb\n' })).toBe(true)
  })

  it('is false for dev builds, macOS, other Linux packages and when switched off', () => {
    expect(canSelfUpdate({ ...base, packaged: false, packageType: 'deb' })).toBe(false)
    expect(canSelfUpdate({ ...base, platform: 'darwin' })).toBe(false)
    expect(canSelfUpdate(base)).toBe(false)
    expect(canSelfUpdate({ ...base, packageType: 'rpm' })).toBe(false)
    expect(
      canSelfUpdate({ ...base, packageType: 'deb', env: { BRIDGECAST_NO_UPDATE_CHECK: '1' } })
    ).toBe(false)
  })
})
