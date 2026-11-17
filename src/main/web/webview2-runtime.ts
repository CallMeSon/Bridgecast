import { join } from 'node:path'

/** Copy shown while a PC has no WebView2 Evergreen runtime (web pages stay in Electron). */
export const WEBVIEW2_MISSING =
  'WebView2 is not installed on this PC. Web pages use the built-in browser.'

/**
 * True when the WebView2 Evergreen runtime is installed. `WEBVIEW2_BROWSER_EXECUTABLE_FOLDER`
 * wins (a fixed-version or a custom location); otherwise the Evergreen folder under Program
 * Files (x86) or Program Files. The helper cannot host a page without it, so main falls back
 * to the Electron backend instead of failing every open.
 */
export function webView2RuntimeFound(o: {
  env: NodeJS.ProcessEnv
  exists: (path: string) => boolean
  programFiles?: string
  programFilesX86?: string
  localAppData?: string
}): boolean {
  const custom = o.env['WEBVIEW2_BROWSER_EXECUTABLE_FOLDER']
  if (custom) return o.exists(custom)
  const candidates = [
    // A per-machine Evergreen install.
    o.programFilesX86 && join(o.programFilesX86, 'Microsoft', 'EdgeWebView', 'Application'),
    o.programFiles && join(o.programFiles, 'Microsoft', 'EdgeWebView', 'Application'),
    // A per-user Evergreen install.
    o.localAppData && join(o.localAppData, 'Microsoft', 'EdgeWebView', 'Application')
  ].filter((p): p is string => !!p)
  return candidates.some((p) => o.exists(p))
}
