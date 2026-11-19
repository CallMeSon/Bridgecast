import { describe, expect, it } from 'vitest'
import { LINUX_HELPER_MISSING, chooseWebBackend, type WebBackendInput } from './backend-choice'
import { LINUX_BROWSER_SNAP } from './linux-browser'
import { WEBVIEW2_MISSING } from './webview2-runtime'

const chrome = { path: '/usr/bin/google-chrome-stable', snap: false }

const base = (over: Partial<WebBackendInput> = {}): WebBackendInput => ({
  platform: 'linux',
  env: {},
  webView2: { helper: false, runtime: false },
  chrome: { enabled: false, browser: chrome, problem: null, helper: true },
  ...over
})

describe('chooseWebBackend', () => {
  it('PPT_WEB_BACKEND=electron wins over everything', () => {
    const on = { enabled: true, browser: chrome, problem: null, helper: true }
    expect(
      chooseWebBackend(
        base({ env: { PPT_WEB_BACKEND: 'electron', PPT_ENGINE_FAKE: '1' }, chrome: on })
      )
    ).toEqual({ kind: 'electron', note: null })
  })

  it('the fake helper is used for e2e', () => {
    expect(chooseWebBackend(base({ env: { PPT_ENGINE_FAKE: '1' } }))).toEqual({ kind: 'fake' })
  })

  it('Linux uses Electron by default, with no note', () => {
    expect(chooseWebBackend(base())).toEqual({ kind: 'electron', note: null })
  })

  it('Linux uses Chrome only when the setting is on and Chrome is usable', () => {
    const on = { enabled: true, browser: chrome, problem: null, helper: true }
    expect(chooseWebBackend(base({ chrome: on }))).toEqual({ kind: 'chrome', browser: chrome })
  })

  it('Linux falls back to Electron with the reason when Chrome is on but unusable', () => {
    const snap = { enabled: true, browser: null, problem: LINUX_BROWSER_SNAP, helper: true }
    expect(chooseWebBackend(base({ chrome: snap }))).toEqual({
      kind: 'electron',
      note: LINUX_BROWSER_SNAP
    })
    const nohelper = { enabled: true, browser: chrome, problem: null, helper: false }
    expect(chooseWebBackend(base({ chrome: nohelper }))).toEqual({
      kind: 'electron',
      note: LINUX_HELPER_MISSING
    })
  })

  it('Windows uses WebView2 when helper and runtime are there, else Electron with a note', () => {
    expect(
      chooseWebBackend(base({ platform: 'win32', webView2: { helper: true, runtime: true } }))
    ).toEqual({ kind: 'webview2' })
    expect(
      chooseWebBackend(base({ platform: 'win32', webView2: { helper: true, runtime: false } }))
    ).toEqual({ kind: 'electron', note: WEBVIEW2_MISSING })
  })

  it('the Chrome setting means nothing off Linux', () => {
    const on = { enabled: true, browser: chrome, problem: null, helper: true }
    expect(chooseWebBackend(base({ platform: 'darwin', chrome: on }))).toEqual({
      kind: 'electron',
      note: null
    })
  })
})
