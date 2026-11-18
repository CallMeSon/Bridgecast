import { describe, expect, it } from 'vitest'
import {
  canSelfUpdate,
  childEnv,
  INSTALL_LIBREOFFICE,
  NO_POWERPOINT_ENGINE,
  SESSION_TYPE_ENV,
  WAYLAND_STILLS,
  detectEngine,
  engineName,
  needsX11Relaunch,
  x11CaptureEnv,
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

  it('captures on Wayland when the app runs on X11 through Xwayland', () => {
    expect(detectEngine({ ...linux, sessionType: 'wayland', x11Capture: true })).toEqual({
      engine: 'libreoffice',
      canCapture: true
    })
  })

  it('imports but cannot capture on Wayland without Xwayland, with the Wayland copy', () => {
    for (const x11Capture of [undefined, false]) {
      expect(detectEngine({ ...linux, sessionType: 'wayland', x11Capture })).toEqual({
        engine: 'libreoffice',
        canCapture: false,
        message: WAYLAND_STILLS
      })
    }
  })

  it('reads the session type it is given, not the value the app sets for capture', () => {
    // After x11CaptureEnv the process says x11; index.ts passes the session's own value.
    const own = { XDG_SESSION_TYPE: 'wayland', DISPLAY: ':0' }
    const set = x11CaptureEnv('linux', own, ['electron', '--ozone-platform=x11'])
    expect(
      detectEngine({ ...linux, sessionType: own.XDG_SESSION_TYPE, x11Capture: set !== null })
        .canCapture
    ).toBe(true)
    const noX = { XDG_SESSION_TYPE: 'wayland' }
    const none = x11CaptureEnv('linux', noX, ['electron', '--ozone-platform=x11'])
    expect(detectEngine({ ...linux, sessionType: 'wayland', x11Capture: none !== null })).toEqual({
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

describe('x11CaptureEnv', () => {
  const wayland = { XDG_SESSION_TYPE: 'wayland', WAYLAND_DISPLAY: 'wayland-0', DISPLAY: ':0' }
  const x11App = ['/opt/Bridgecast/bridgecast', '--ozone-platform=x11']

  it('says x11 and keeps the session value when the app runs on Xwayland', () => {
    expect(x11CaptureEnv('linux', wayland, x11App)).toEqual({
      XDG_SESSION_TYPE: 'x11',
      [SESSION_TYPE_ENV]: 'wayland'
    })
    // npm run dev passes the flag itself (no relaunch): same switch.
    expect(
      x11CaptureEnv('linux', wayland, ['electron', '.', '--ozone-platform=x11'])
    ).not.toBeNull()
  })

  it('applies to the process that the X11 relaunch starts', () => {
    const { args } = x11RelaunchOptions(wayland, ['/opt/Bridgecast/bridgecast'])
    expect(x11CaptureEnv('linux', wayland, ['/opt/Bridgecast/bridgecast', ...args])).not.toBeNull()
  })

  it('changes nothing without Xwayland, on a Wayland app, on X11 sessions or other systems', () => {
    expect(x11CaptureEnv('linux', { ...wayland, DISPLAY: undefined }, x11App)).toBeNull()
    expect(x11CaptureEnv('linux', wayland, ['electron', '.'])).toBeNull()
    expect(x11CaptureEnv('linux', wayland, ['electron', '--ozone-platform=wayland'])).toBeNull()
    expect(x11CaptureEnv('linux', { XDG_SESSION_TYPE: 'x11', DISPLAY: ':0' }, x11App)).toBeNull()
    expect(
      x11CaptureEnv('linux', { WAYLAND_DISPLAY: 'wayland-0', DISPLAY: ':0' }, x11App)
    ).toBeNull()
    expect(x11CaptureEnv('win32', wayland, x11App)).toBeNull()
  })

  it('is applied once: the changed environment needs no second change', () => {
    const env: Record<string, string | undefined> = { ...wayland }
    Object.assign(env, x11CaptureEnv('linux', env, x11App))
    expect(x11CaptureEnv('linux', env, x11App)).toBeNull()
    expect(env['XDG_SESSION_TYPE']).toBe('x11')
  })
})

describe('childEnv', () => {
  it('gives a started program the session type of the session', () => {
    const env = { PATH: '/usr/bin', XDG_SESSION_TYPE: 'x11', [SESSION_TYPE_ENV]: 'wayland' }
    const out = childEnv(env)
    expect(out).toEqual({ PATH: '/usr/bin', XDG_SESSION_TYPE: 'wayland' })
    expect(SESSION_TYPE_ENV in out).toBe(false)
    expect(env['XDG_SESSION_TYPE']).toBe('x11') // the app's own environment is not touched
  })

  it('passes the environment through unchanged when the app did not switch', () => {
    const env = { PATH: '/usr/bin', XDG_SESSION_TYPE: 'x11', DISPLAY: ':0' }
    expect(childEnv(env)).toEqual(env)
    expect(childEnv(env)).not.toBe(env)
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
