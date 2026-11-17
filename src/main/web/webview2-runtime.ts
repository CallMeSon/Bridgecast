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
}): boolean {
  const custom = o.env['WEBVIEW2_BROWSER_EXECUTABLE_FOLDER']
  if (custom) return o.exists(custom)
  const bases = [o.programFilesX86, o.programFiles].filter((b): b is string => !!b)
  return bases.some((b) => o.exists(join(b, 'Microsoft', 'EdgeWebView', 'Application')))
}
