import { describe, expect, it } from 'vitest'
import {
  GOOGLE_SIGN_IN_URL,
  LINUX_BROWSER_MISSING,
  LINUX_BROWSER_SNAP,
  LINUX_PYTHON_MISSING,
  SHARED_PROFILE,
  chromeProblem,
  chromeSignInArgs,
  findLinuxBrowser,
  looksLikeSnap,
  linuxProfileRoot,
  onPath,
  webBridgeLinuxScriptPath
} from './linux-browser'

const finder = (
  files: string[],
  snaps: string[] = [],
  env: NodeJS.ProcessEnv = {}
): ReturnType<typeof findLinuxBrowser> =>
  findLinuxBrowser({
    env: { PATH: '/usr/bin:/usr/local/bin', ...env },
    exists: (f) => files.includes(f),
    isSnap: (f) => snaps.includes(f)
  })

describe('findLinuxBrowser', () => {
  it('prefers Google Chrome over Chromium', () => {
    const r = finder(['/usr/bin/chromium', '/usr/bin/google-chrome-stable'])
    expect(r?.path).toBe('/usr/bin/google-chrome-stable')
  })

  it('prefers a non-snap browser over a snap one', () => {
    const r = finder(['/snap/bin/chromium', '/usr/bin/brave-browser'], ['/snap/bin/chromium'])
    expect(r).toEqual({ path: '/usr/bin/brave-browser', snap: false })
  })

  it('falls back to the snap Chromium and marks it', () => {
    const r = finder(['/snap/bin/chromium'], ['/snap/bin/chromium'])
    expect(r).toEqual({ path: '/snap/bin/chromium', snap: true })
  })

  it('PPT_CHROME wins, and a missing one finds nothing', () => {
    expect(finder(['/opt/c/chrome'], [], { PPT_CHROME: '/opt/c/chrome' })?.path).toBe(
      '/opt/c/chrome'
    )
    expect(finder(['/usr/bin/chromium'], [], { PPT_CHROME: '/nope' })).toBeNull()
  })

  it('returns null when nothing is installed', () => {
    expect(finder([])).toBeNull()
  })
})

describe('linuxProfileRoot', () => {
  // Snap builds are refused (see chromeProblem), so there is no snap location to compute: the
  // profiles always live in Bridgecast's own userData folder, never in the user's Chrome profile.
  it('keeps profiles in the app data folder', () => {
    expect(linuxProfileRoot('/home/a/.config/bridgecast')).toBe(
      '/home/a/.config/bridgecast/web-profile'
    )
    expect(linuxProfileRoot('/home/a/.config/bridgecast-dev')).toBe(
      '/home/a/.config/bridgecast-dev/web-profile'
    )
  })

  it('never points at the personal Chrome profile', () => {
    expect(linuxProfileRoot('/home/a/.config/bridgecast')).not.toContain('google-chrome')
    expect(SHARED_PROFILE).toBe('default')
  })
})

describe('chromeSignInArgs', () => {
  it('uses the Bridgecast profile and no automation or debugging flags', () => {
    const args = chromeSignInArgs('/d/web-profile/default')
    expect(args).toContain('--user-data-dir=/d/web-profile/default')
    expect(args[args.length - 1]).toBe(GOOGLE_SIGN_IN_URL)
    expect(args.join(' ')).not.toMatch(/remote-debugging|enable-automation|AutomationControlled/)
  })
})

describe('chromeProblem', () => {
  const chrome = { path: '/usr/bin/google-chrome-stable', snap: false }
  it('is null for a real Chrome with python3', () => {
    expect(chromeProblem({ browser: chrome, python: true })).toBeNull()
  })
  it('says why not: none installed, snap, no python3', () => {
    expect(chromeProblem({ browser: null, python: true })).toBe(LINUX_BROWSER_MISSING)
    expect(
      chromeProblem({ browser: { path: '/snap/bin/chromium', snap: true }, python: true })
    ).toBe(LINUX_BROWSER_SNAP)
    expect(chromeProblem({ browser: chrome, python: false })).toBe(LINUX_PYTHON_MISSING)
  })
})

describe('onPath', () => {
  it('finds a program in one of the PATH folders', () => {
    const exists = (f: string): boolean => f === '/usr/bin/python3'
    expect(onPath('python3', { PATH: '/bin:/usr/bin' }, exists)).toBe(true)
    expect(onPath('python3', { PATH: '/bin' }, exists)).toBe(false)
  })
})

describe('webBridgeLinuxScriptPath', () => {
  it('points into resources when packaged and into the repo in dev', () => {
    const base = { resourcesPath: '/r', appPath: '/app' }
    expect(webBridgeLinuxScriptPath({ ...base, packaged: true })).toBe(
      '/r/web-bridge-linux/bridge.mjs'
    )
    expect(webBridgeLinuxScriptPath({ ...base, packaged: false })).toBe(
      '/app/native/web-bridge-linux/bridge.mjs'
    )
  })
})

describe('looksLikeSnap', () => {
  it('recognizes the snap launcher, snapd and the Ubuntu wrapper script', () => {
    expect(looksLikeSnap('/snap/bin/chromium', '/usr/lib/snapd/snapd', '')).toBe(true)
    expect(
      looksLikeSnap(
        '/usr/bin/chromium-browser',
        '/usr/bin/chromium-browser',
        '#!/bin/sh\nexec snap run chromium'
      )
    ).toBe(true)
  })

  it('does not flag a deb or vendor build', () => {
    expect(
      looksLikeSnap(
        '/usr/bin/google-chrome-stable',
        '/opt/google/chrome/google-chrome',
        '#!/bin/bash'
      )
    ).toBe(false)
  })
})
