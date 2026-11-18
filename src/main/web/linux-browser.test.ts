import { describe, expect, it } from 'vitest'
import {
  findLinuxBrowser,
  looksLikeSnap,
  linuxProfileRoot,
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
  it('keeps profiles in userData for a normal browser', () => {
    expect(
      linuxProfileRoot({ snap: false, home: '/home/a', userData: '/home/a/.config/bridgecast' })
    ).toBe('/home/a/.config/bridgecast/web-profile')
  })

  it('moves them out of hidden folders for a snap', () => {
    expect(
      linuxProfileRoot({ snap: true, home: '/home/a', userData: '/home/a/.config/bridgecast-dev' })
    ).toBe('/home/a/snap/chromium/common/bridgecast-dev-web-profile')
  })

  it('names the snap package from the launcher', () => {
    expect(
      linuxProfileRoot({
        snap: true,
        home: '/home/a',
        userData: '/home/a/.config/bridgecast',
        browser: '/snap/bin/edge'
      })
    ).toBe('/home/a/snap/edge/common/bridgecast-web-profile')
    expect(
      linuxProfileRoot({
        snap: true,
        home: '/home/a',
        userData: '/home/a/.config/bridgecast',
        browser: '/snap/brave/current/usr/brave-browser'
      })
    ).toBe('/home/a/snap/brave/common/bridgecast-web-profile')
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
