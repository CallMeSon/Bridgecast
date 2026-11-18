import path from 'node:path'

/** Copy shown while a Linux PC has no Chrome or Chromium (web pages stay in Electron). */
export const LINUX_BROWSER_MISSING =
  'Google Chrome or Chromium is not installed on this PC. Web pages use the built-in browser.'

/** A Chrome-family browser the Linux web helper can drive. */
export interface LinuxBrowser {
  path: string
  /** A snap package: it can only write inside the user's home, outside hidden folders. */
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
 * browser on PATH. A real browser (not WebKit) is what lets Google sign-in work.
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
  // A deb or vendor build beats a snap: the snap sandbox limits where it can store a profile.
  return found.find((b) => !b.snap) ?? found[0] ?? null
}

/**
 * Where the helper keeps sign-in profiles. A snap Chromium cannot reach hidden folders such
 * as `~/.config`, so its profiles live under its own `~/snap/chromium/common`. Any other
 * snap gets a plain `<snap>-common` folder under `~/snap/<snap>/common` when we can name it,
 * falling back to `<userData>/web-profile` for a deb or vendor build.
 */
export function linuxProfileRoot(o: {
  snap: boolean
  home: string
  userData: string
  browser?: string
}): string {
  if (!o.snap) return path.join(o.userData, 'web-profile')
  const snap = o.browser ? snapName(o.browser) : 'chromium'
  return path.join(o.home, 'snap', snap, 'common', `${path.basename(o.userData)}-web-profile`)
}

/** The snap package name from a launcher (`/snap/bin/chromium`) or a real path (`/snap/chromium/current/...`). */
function snapName(browser: string): string {
  const launcher = /^\/snap\/bin\/([^/]+)/.exec(browser)
  if (launcher?.[1]) return launcher[1]
  const direct = /(?:^|\/)snap\/([^/]+)\//.exec(browser)
  if (direct?.[1] && direct[1] !== 'bin') return direct[1]
  // Ubuntu's `chromium-browser` wrapper hands over to the chromium snap.
  return 'chromium'
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
