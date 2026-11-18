import { WEBVIEW2_MISSING } from './webview2-runtime'
import type { LinuxBrowser } from './linux-browser'

/** Copy when the Linux helper script is not in this build (a broken install). */
export const LINUX_HELPER_MISSING =
  'The Chrome web page helper is missing. Reinstall Bridgecast. Web pages use the built-in browser.'

/** What hosts web deck pages this session. */
export type WebBackendChoice =
  /** FakeWebEngine behind the helper backend (e2e, `PPT_ENGINE_FAKE=1`). */
  | { kind: 'fake' }
  /** Windows: web-bridge.exe hosting WebView2. */
  | { kind: 'webview2' }
  /** Linux, opted in: the PC's Chrome/Chromium driven by native/web-bridge-linux. */
  | { kind: 'chrome'; browser: LinuxBrowser }
  /** Electron's hidden page window; `note` says why a helper the operator expects is not used. */
  | { kind: 'electron'; note: string | null }

export interface WebBackendInput {
  platform: NodeJS.Platform
  /** `PPT_WEB_BACKEND` and `PPT_ENGINE_FAKE`. */
  env: Record<string, string | undefined>
  /** Windows: web-bridge.exe is in this build and the WebView2 runtime is installed. */
  webView2: { helper: boolean; runtime: boolean }
  /** Linux: the saved setting, what was detected, and whether bridge.mjs is in this build. */
  chrome: {
    enabled: boolean
    browser: LinuxBrowser | null
    /** `chromeProblem`: operator copy, or null when Chrome can be used. */
    problem: string | null
    helper: boolean
  }
}

/**
 * Picks the web page backend once at start. `PPT_WEB_BACKEND=electron` always wins, then the
 * fake helper (e2e). Windows uses WebView2 when its helper and runtime are there. Linux uses
 * Chrome only when the operator turned it on in Settings and a usable (non-snap) browser and the
 * helper are there; otherwise the built-in Electron window, with a note when the operator asked
 * for Chrome. Every other platform uses Electron.
 */
export function chooseWebBackend(i: WebBackendInput): WebBackendChoice {
  if (i.env['PPT_WEB_BACKEND'] === 'electron') return { kind: 'electron', note: null }
  if (i.env['PPT_ENGINE_FAKE'] === '1') return { kind: 'fake' }
  if (i.platform === 'win32') {
    if (i.webView2.helper && i.webView2.runtime) return { kind: 'webview2' }
    // The helper is shipped but this PC has no WebView2: the built-in browser takes over.
    return { kind: 'electron', note: i.webView2.helper ? WEBVIEW2_MISSING : null }
  }
  if (i.platform === 'linux' && i.chrome.enabled) {
    if (i.chrome.problem || !i.chrome.browser) {
      return { kind: 'electron', note: i.chrome.problem }
    }
    if (!i.chrome.helper) return { kind: 'electron', note: LINUX_HELPER_MISSING }
    return { kind: 'chrome', browser: i.chrome.browser }
  }
  return { kind: 'electron', note: null }
}
