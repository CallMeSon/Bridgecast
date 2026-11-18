import * as fs from 'node:fs'
import path from 'node:path'

/** Copy shown while a Linux PC has no Chrome or Chromium (web pages stay in Electron). */
export const LINUX_BROWSER_MISSING =
  'Google Chrome or Chromium is not installed on this PC. Web pages use the built-in browser.'

/** Copy shown when the only Chrome-family browser is a Snap package. */
export const LINUX_BROWSER_SNAP =
  'Chromium from the Snap Store cannot host web pages; they use the built-in browser. Install Google Chrome to sign in to Google.'

/** Copy shown when python3 (window handling for the helper) is missing. */
export const LINUX_PYTHON_MISSING =
  'Chrome for web pages needs python3, which is not installed on this PC. Web pages use the built-in browser.'

/** A Chrome-family browser the Linux web helper can drive. */
export interface LinuxBrowser {
  path: string
  /**
   * A snap package. Refused: its sandbox cannot write the profile under the app's hidden data
   * folder (`~/.config/...`), so Snap builds are never used.
   */
  snap: boolean
}

/**
 * Whether a launcher belongs to a snap package: it lives under `/snap/`, resolves into snapd,
 * or is a wrapper script (Ubuntu's `chromium-browser`) that hands over to the snap.
 */
export function looksLikeSnap(file: string, real: string, head: string): boolean {
  return (
    file.startsWith('/snap/') ||
    real.startsWith('/snap/') ||
    /(^|\/)snapd?$/.test(real) ||
    /\bsnap\b/.test(head)
  )
}

/** Chrome-family browsers in order of preference (real Chrome first, snap last). */
const BROWSER_NAMES = [
  'google-chrome-stable',
  'google-chrome',
  'chromium',
  'chromium-browser',
  'microsoft-edge-stable',
  'microsoft-edge',
  'brave-browser'
]

export interface FindBrowserOptions {
  env: NodeJS.ProcessEnv
  exists: (file: string) => boolean
  /** Whether `file` is (a launcher of) a snap package. */
  isSnap: (file: string) => boolean
}

/**
 * The browser the Linux helper drives: `PPT_CHROME` wins, then the first Chrome-family
 * browser on PATH. A real browser (not an embedded one) is what lets Google sign-in work.
 * A snap is only returned when nothing else is installed, marked, so the caller can refuse it.
 */
export function findLinuxBrowser(o: FindBrowserOptions): LinuxBrowser | null {
  const custom = o.env['PPT_CHROME']
  if (custom) return o.exists(custom) ? { path: custom, snap: o.isSnap(custom) } : null
  const dirs = (o.env['PATH'] ?? '').split(':').filter(Boolean)
  const all = [...dirs, '/snap/bin']
  const candidates: string[] = []
  const seen = new Set<string>()
  for (const name of BROWSER_NAMES) {
    for (const dir of all) {
      const file = path.join(dir, name)
      if (!seen.has(file)) {
        seen.add(file)
        candidates.push(file)
      }
    }
  }
  const found = candidates
    .filter((file) => o.exists(file))
    .map((file) => ({ path: file, snap: o.isSnap(file) }))
  // A deb or vendor build beats a snap.
  return found.find((b) => !b.snap) ?? found[0] ?? null
}

/** Whether `name` is an executable file in one of PATH's folders. */
export function onPath(
  name: string,
  env: NodeJS.ProcessEnv,
  exists: (file: string) => boolean
): boolean {
  return (env['PATH'] ?? '')
    .split(':')
    .filter(Boolean)
    .some((dir) => exists(path.join(dir, name)))
}

/**
 * Why Chrome cannot host web pages on this PC, or null when it can: a Chrome-family browser
 * that is not a snap, and python3 for the helper's window handling.
 */
export function chromeProblem(o: { browser: LinuxBrowser | null; python: boolean }): string | null {
  if (!o.browser) return LINUX_BROWSER_MISSING
  if (o.browser.snap) return LINUX_BROWSER_SNAP
  if (!o.python) return LINUX_PYTHON_MISSING
  return null
}

/** What this PC offers for Chrome web pages (reads PATH and the launchers). */
export interface ChromeDetection {
  browser: LinuxBrowser | null
  /** Operator copy, or null when Chrome can be used. */
  problem: string | null
}

/** Looks for a usable Chrome on this PC (Linux). Never throws. */
export function detectLinuxChrome(env: NodeJS.ProcessEnv): ChromeDetection {
  const exists = (file: string): boolean => {
    try {
      return fs.statSync(file).isFile()
    } catch {
      return false
    }
  }
  const browser = findLinuxBrowser({
    env,
    exists,
    isSnap: (file) => {
      try {
        return looksLikeSnap(
          file,
          fs.realpathSync(file),
          fs.readFileSync(file, 'latin1').slice(0, 4096)
        )
      } catch {
        return false
      }
    }
  })
  return { browser, problem: chromeProblem({ browser, python: onPath('python3', env, exists) }) }
}

/**
 * Where the helper keeps its Chrome profiles: `<userData>/web-profile`, one folder per profile
 * (`default` is the one every web deck shares). Only Bridgecast's own folder: the user's own
 * Chrome profile and cookies are never read or touched.
 */
export function linuxProfileRoot(userData: string): string {
  return path.join(userData, 'web-profile')
}

/** The profile web decks share (the one "Sign in to Google" signs in). */
export const SHARED_PROFILE = 'default'

/** The address the sign-in window opens. */
export const GOOGLE_SIGN_IN_URL = 'https://accounts.google.com/'

/**
 * Arguments of the sign-in browser: the Bridgecast profile and nothing that automates it. Google
 * refuses sign-in while DevTools is attached, so there is no remote debugging and no automation
 * flag here. `--password-store=basic` must match the helper, or the helper could not read the
 * cookies this window saves.
 */
export function chromeSignInArgs(profileDir: string, url = GOOGLE_SIGN_IN_URL): string[] {
  return [
    `--user-data-dir=${profileDir}`,
    '--password-store=basic',
    '--no-first-run',
    '--no-default-browser-check',
    '--new-window',
    url
  ]
}

/** `resources/web-bridge-linux/bridge.mjs` packaged, the source folder in dev. */
export function webBridgeLinuxScriptPath(opts: {
  packaged: boolean
  resourcesPath: string
  appPath: string
}): string {
  return opts.packaged
    ? path.join(opts.resourcesPath, 'web-bridge-linux', 'bridge.mjs')
    : path.join(opts.appPath, 'native', 'web-bridge-linux', 'bridge.mjs')
}
