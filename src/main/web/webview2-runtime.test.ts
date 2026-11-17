import { describe, expect, it } from 'vitest'
import { WEBVIEW2_MISSING, webView2RuntimeFound } from './webview2-runtime'

const found = (paths: string[]) => (p: string): boolean => paths.includes(p)

describe('webView2RuntimeFound', () => {
  it('finds the Evergreen folder under either Program Files', () => {
    expect(
      webView2RuntimeFound({
        env: {},
        exists: found(['C:\\Program Files (x86)\\Microsoft\\EdgeWebView\\Application']),
        programFilesX86: 'C:\\Program Files (x86)',
        programFiles: 'C:\\Program Files'
      })
    ).toBe(true)
    expect(
      webView2RuntimeFound({
        env: {},
        exists: found(['C:\\Program Files\\Microsoft\\EdgeWebView\\Application']),
        programFilesX86: 'C:\\Program Files (x86)',
        programFiles: 'C:\\Program Files'
      })
    ).toBe(true)
  })

  it('is false when neither folder exists', () => {
    expect(
      webView2RuntimeFound({
        env: {},
        exists: () => false,
        programFilesX86: 'C:\\Program Files (x86)',
        programFiles: 'C:\\Program Files'
      })
    ).toBe(false)
  })

  it('finds a per-user Evergreen install', () => {
    expect(
      webView2RuntimeFound({
        env: {},
        exists: found(['C:\\Users\\op\\AppData\\Local\\Microsoft\\EdgeWebView\\Application']),
        localAppData: 'C:\\Users\\op\\AppData\\Local'
      })
    ).toBe(true)
  })

  it('honours WEBVIEW2_BROWSER_EXECUTABLE_FOLDER (a fixed-version runtime)', () => {
    expect(
      webView2RuntimeFound({
        env: { WEBVIEW2_BROWSER_EXECUTABLE_FOLDER: 'D:\\Edge' },
        exists: found(['D:\\Edge']),
        programFilesX86: 'C:\\Program Files (x86)'
      })
    ).toBe(true)
    expect(
      webView2RuntimeFound({
        env: { WEBVIEW2_BROWSER_EXECUTABLE_FOLDER: 'D:\\Edge' },
        exists: () => false
      })
    ).toBe(false)
  })

  it('has the operator copy', () => {
    expect(WEBVIEW2_MISSING).toContain('built-in browser')
  })
})
