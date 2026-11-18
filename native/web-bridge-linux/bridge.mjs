#!/usr/bin/env node
// web-bridge for Linux: hosts one real Chrome/Chromium app window per web deck, so a web deck
// renders in a real browser (a Google session signed in once in the Bridgecast profile works)
// while the app captures the window. Same JSON-lines protocol as native/web-bridge (Windows,
// WebView2); see that README. Run by Electron itself (ELECTRON_RUN_AS_NODE=1), so it needs no
// separate Node install. Window chores (find the X11 window, no frame, below other windows,
// keep the operator's focus) go through xwin.py (python3 + libX11, no xdotool).
//
//   bridge.mjs --user-data <folder> --browser <chrome path>
import { spawn, execFile } from 'node:child_process'
import fs from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import readline from 'node:readline'
import { fileURLToPath } from 'node:url'

const XWIN = path.join(path.dirname(fileURLToPath(import.meta.url)), 'xwin.py')
const xwin = (...args) => run('python3', [XWIN, ...args])

const argv = process.argv.slice(2)
const opt = (name) => {
  const i = argv.indexOf(`--${name}`)
  return i >= 0 ? argv[i + 1] : undefined
}
const USER_DATA = opt('user-data')
const BROWSER = opt('browser')
if (!USER_DATA || !BROWSER) {
  process.stderr.write('usage: bridge.mjs --user-data <folder> --browser <chrome>\n')
  process.exit(2)
}

// ---- protocol io ----
const out = (o) => process.stdout.write(`${JSON.stringify(o)}\n`)
const log = (...a) => process.stderr.write(`${a.join(' ')}\n`)
const event = (name, o = {}) => out({ event: name, ...o })

class BridgeError extends Error {
  constructor(code, message) {
    super(message)
    this.code = code
  }
}

// Step trace for field diagnosis: PPT_WEB_BRIDGE_TRACE=1 (the app prints helper stderr).
const trace = (...a) => {
  if (process.env.PPT_WEB_BRIDGE_TRACE) log('trace', ...a)
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const run = (cmd, args, timeout = 5000) =>
  new Promise((resolve) => {
    execFile(cmd, args, { timeout }, (err, stdout) => resolve(err ? null : String(stdout)))
  })

// ---- CDP over WebSocket (browser-level connection, flattened sessions) ----
class Cdp {
  constructor(url) {
    this.url = url
    this.next = 1
    this.pending = new Map()
    this.handlers = []
    this.closeCbs = []
  }
  open() {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(this.url)
      this.ws = ws
      ws.onopen = () => resolve()
      ws.onerror = () => reject(new Error('DevTools connection failed'))
      ws.onclose = () => {
        for (const p of this.pending.values()) p.reject(new Error('DevTools connection closed'))
        this.pending.clear()
        for (const cb of this.closeCbs) cb()
      }
      ws.onmessage = (m) => {
        let msg
        try {
          msg = JSON.parse(String(m.data))
        } catch {
          return
        }
        if (msg.id !== undefined) {
          const p = this.pending.get(msg.id)
          if (!p) return
          this.pending.delete(msg.id)
          if (msg.error) p.reject(new Error(msg.error.message || 'DevTools error'))
          else p.resolve(msg.result || {})
        } else if (msg.method) {
          for (const h of this.handlers) h(msg.method, msg.params || {}, msg.sessionId)
        }
      }
    })
  }
  send(method, params = {}, sessionId, timeout = 15000) {
    return new Promise((resolve, reject) => {
      const id = this.next++
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`${method} timed out`))
      }, timeout)
      this.pending.set(id, {
        resolve: (v) => {
          clearTimeout(timer)
          resolve(v)
        },
        reject: (e) => {
          clearTimeout(timer)
          reject(e)
        }
      })
      try {
        this.ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }))
      } catch (e) {
        this.pending.delete(id)
        clearTimeout(timer)
        reject(e)
      }
    })
  }
  on(h) {
    this.handlers.push(h)
  }
  onClose(cb) {
    this.closeCbs.push(cb)
  }
  close() {
    try {
      this.ws.close()
    } catch {
      /* already closed */
    }
  }
}

// ---- sound: a private null sink per browser, its monitor streamed over a unix socket ----
let sinkCounter = 0
class Audio {
  constructor() {
    this.name = `bridgecast_web_${process.pid}_${++sinkCounter}`
    this.module = null
    this.sock = path.join(
      process.env.XDG_RUNTIME_DIR || os.tmpdir(),
      `bridgecast-web-${process.pid}-${sinkCounter}.sock`
    )
    this.client = null
    this.parec = null
    this.server = null
  }
  async start() {
    const id = await run('pactl', [
      'load-module',
      'module-null-sink',
      `sink_name=${this.name}`,
      'sink_properties=device.description=Bridgecast-Web'
    ])
    if (!id) throw new Error('pactl load-module failed')
    this.module = id.trim()
    try {
      fs.unlinkSync(this.sock)
    } catch {
      /* none yet */
    }
    this.server = net.createServer((c) => this.onClient(c))
    await new Promise((resolve, reject) => {
      this.server.once('error', reject)
      this.server.listen(this.sock, resolve)
    })
  }
  // One reader at a time; frames are dropped while no reader is connected.
  onClient(c) {
    if (this.client) this.client.destroy()
    this.client = c
    c.on('error', () => undefined)
    c.on('close', () => {
      if (this.client === c) {
        this.client = null
        this.stopParec()
      }
    })
    this.startParec()
  }
  startParec() {
    if (this.parec) return
    const p = spawn(
      'parec',
      [
        `--device=${this.name}.monitor`,
        '--format=float32le',
        '--rate=48000',
        '--channels=2',
        '--latency-msec=20'
      ],
      { stdio: ['ignore', 'pipe', 'ignore'] }
    )
    this.parec = p
    p.stdout.on('data', (d) => {
      const c = this.client
      if (c && !c.destroyed && c.writableLength < 1 << 20) c.write(d)
    })
    p.on('exit', () => {
      if (this.parec === p) this.parec = null
    })
    p.on('error', () => undefined)
  }
  stopParec() {
    if (this.parec) {
      this.parec.kill()
      this.parec = null
    }
  }
  async setMuted(muted) {
    await run('pactl', ['set-sink-mute', this.name, muted ? '1' : '0'])
  }
  async dispose() {
    this.stopParec()
    if (this.client) this.client.destroy()
    if (this.server) this.server.close()
    try {
      fs.unlinkSync(this.sock)
    } catch {
      /* already gone */
    }
    if (this.module) await run('pactl', ['unload-module', this.module])
  }
}

// ---- profiles and browser processes (one per profile folder, like WebView2 environments) ----
const SAFE_PROFILE = /^[A-Za-z0-9_-]{1,64}$/
const browsers = new Map() // profile -> Browser
const pages = new Map() // deckId -> Page

const WINDOW_MARK = 'bcw-'
// App windows need a real start URL; its title is the marker the window is found by.
const appUrl = (marker) => `--app=data:text/html,<title>${marker}</title>`

class Browser {
  constructor(profile) {
    this.profile = profile
    this.dir = path.join(USER_DATA, profile)
    this.proc = null
    this.cdp = null
    this.audio = null
    this.starting = null
    this.exiting = false
  }

  baseFlags() {
    return [
      `--user-data-dir=${this.dir}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--ozone-platform=x11',
      '--password-store=basic',
      '--autoplay-policy=no-user-gesture-required',
      '--disable-session-crashed-bubble',
      '--hide-crash-restore-bubble',
      // The window is parked where nothing shows it; it must keep rendering for capture.
      '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding',
      '--disable-background-timer-throttling',
      '--disable-features=CalculateNativeWinOcclusion,Translate'
      // No --disable-blink-features=AutomationControlled: Chrome answers it with an
      // "unsupported command-line flag" bar inside the window, which the capture would show.
      // With remote debugging, navigator.webdriver is true (measured, Chrome 156); Google
      // sign-in therefore happens in a separate launch without remote debugging (the app's
      // "Sign in to Google"), and this browser reuses the profile it leaves behind.
    ]
  }

  /** The browser's environment: no Electron leftovers, sound into the private sink. */
  env() {
    const env = { ...process.env }
    delete env.ELECTRON_RUN_AS_NODE
    // Electron's desktop name would make Chrome call its windows "Electron".
    delete env.CHROME_DESKTOP
    if (this.audio) env.PULSE_SINK = this.audio.name
    return env
  }

  async ensure() {
    if (this.cdp) return
    this.starting ??= this.launch()
    try {
      await this.starting
    } finally {
      this.starting = null
    }
  }

  async launch() {
    fs.mkdirSync(this.dir, { recursive: true })
    try {
      fs.unlinkSync(path.join(this.dir, 'DevToolsActivePort'))
    } catch {
      /* first run */
    }
    this.audio = new Audio()
    try {
      await this.audio.start()
    } catch (e) {
      log('audio unavailable:', e.message)
      this.audio = null
    }
    this.proc = spawn(
      BROWSER,
      [...this.baseFlags(), '--remote-debugging-port=0', appUrl(`${WINDOW_MARK}boot`)],
      {
        stdio: ['ignore', 'ignore', process.env.PPT_WEB_BRIDGE_TRACE ? 'inherit' : 'ignore'],
        env: this.env()
      }
    )
    trace('browser spawned', this.proc.pid, BROWSER, this.dir)
    this.proc.on('exit', (code) => {
      trace('browser exit', code)
      this.onExit()
    })
    this.proc.on('error', (e) => {
      log('browser start:', e.message)
      this.onExit()
    })
    const portFile = path.join(this.dir, 'DevToolsActivePort')
    let port = 0
    for (let i = 0; i < 200 && !port; i++) {
      if (!this.proc) break
      try {
        port = Number(fs.readFileSync(portFile, 'utf8').split('\n')[0])
      } catch {
        await sleep(100)
      }
    }
    if (!port) throw new BridgeError('start', 'The browser did not start.')
    const info = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json()
    this.cdp = new Cdp(info.webSocketDebuggerUrl)
    await this.cdp.open()
    this.cdp.onClose(() => this.onExit())
    this.cdp.on((m, p, s) => onCdpEvent(this, m, p, s))
    await this.cdp.send('Target.setDiscoverTargets', { discover: true })
    // Deny by default: camera, microphone, location, notifications, downloads.
    for (const name of ['videoCapture', 'audioCapture', 'geolocation', 'notifications']) {
      await this.cdp
        .send('Browser.setPermission', { permission: { name }, setting: 'denied' })
        .catch(() => undefined)
    }
    await this.cdp.send('Browser.setDownloadBehavior', { behavior: 'deny' }).catch(() => undefined)
    // The boot window (the first app window needs a URL) is not a deck.
    const boot = await this.waitTarget(`${WINDOW_MARK}boot`)
    this.bootTarget = boot.targetId
  }

  async waitTarget(marker, timeoutMs = 20000) {
    const until = Date.now() + timeoutMs
    while (Date.now() < until) {
      const { targetInfos } = await this.cdp.send('Target.getTargets')
      const hit = targetInfos.find((t) => t.type === 'page' && t.url.includes(marker))
      if (hit) return hit
      await sleep(100)
    }
    throw new BridgeError('open', 'The page window did not open.')
  }

  // A new app window in the already running browser (the second launch hands over to it).
  async newWindow(marker, w, h, x, y) {
    if (this.bootTarget) {
      // The very first deck reuses the boot window.
      const t = this.bootTarget
      this.bootTarget = null
      return t
    }
    const p = spawn(
      BROWSER,
      [
        ...this.baseFlags(),
        `--window-size=${w},${h}`,
        `--window-position=${x},${y}`,
        appUrl(marker)
      ],
      { stdio: 'ignore', env: this.env() }
    )
    p.on('error', () => undefined)
    return (await this.waitTarget(marker)).targetId
  }

  onExit() {
    if (this.exiting) return
    this.exiting = true
    browsers.delete(this.profile)
    if (this.audio) void this.audio.dispose()
    for (const page of [...pages.values()]) {
      if (page.browser !== this) continue
      event('crashed', { deckId: page.deckId })
      status(page.deckId, 'error', loadFailed(page.url))
      page.dispose()
    }
    // Nothing is left to host: leave, so the app restarts the helper and reopens the pages.
    if (!shuttingDown) {
      event('exited')
      setTimeout(() => process.exit(1), 100)
    }
  }

  kill() {
    this.exiting = true
    this.cdp?.send('Browser.close').catch(() => undefined)
    try {
      this.proc?.kill()
    } catch {
      /* gone */
    }
    this.cdp?.close()
  }
}

// ---- pages ----
const loadFailed = (url) =>
  `Could not open ${domainOf(url)}. Check the internet connection, then Reload.`
function domainOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./i, '')
  } catch {
    return url || ''
  }
}
const allowedUrl = (url) => {
  try {
    const u = new URL(url)
    return u.protocol === 'http:' || u.protocol === 'https:'
  } catch {
    return false
  }
}
const status = (deckId, st, message) =>
  event('status', { deckId, status: st, ...(message ? { message } : {}) })

const PAGE_SCRIPT = (zoom) => `(() => {
  const z = ${zoom};
  const apply = () => { if (document.documentElement) document.documentElement.style.zoom = z === 1 ? '' : String(z) };
  apply(); document.addEventListener('DOMContentLoaded', apply);
  if (!window.__bcHooked) {
    window.__bcHooked = true;
    window.__bcMute = false;
    const muteAll = () => document.querySelectorAll('video,audio').forEach((m) => { if (window.__bcMute) m.muted = true });
    setInterval(muteAll, 400);
    document.addEventListener('mousemove', (e) => { try {
      const t = e.target; const c = (t && getComputedStyle(t).cursor) || 'default';
      if (c !== window.__bcCur) { window.__bcCur = c; window.__bcCursor(c) } } catch (_) {} }, true);
  }
})()`

class Page {
  constructor(deckId, browser, profile) {
    this.deckId = deckId
    this.browser = browser
    this.profile = profile
    this.canvas = { w: 1920, h: 1080 }
    this.zoom = 1
    this.live = false
    this.muted = false
    this.loaded = false
    this.url = ''
    this.title = ''
    this.cursor = 'default'
    this.crashes = 0
    this.canBack = false
    this.canForward = false
    this.viewport = null
    this.probe = null
    this.hungReported = false
    this.closed = false
    this.scriptId = null
  }

  cdp(method, params, timeout) {
    return this.browser.cdp.send(method, params, this.sessionId, timeout)
  }

  async attach(targetId) {
    this.targetId = targetId
    const { sessionId } = await this.browser.cdp.send('Target.attachToTarget', {
      targetId,
      flatten: true
    })
    this.sessionId = sessionId
    await this.cdp('Page.enable')
    await this.cdp('Runtime.enable')
    await this.cdp('Inspector.enable').catch(() => undefined)
    // Load events of iframes must not read as the page loading (the app treats `loading` as a
    // new document, which closes the ready gate).
    const { frameTree } = await this.cdp('Page.getFrameTree')
    this.mainFrameId = frameTree?.frame?.id ?? targetId
    await this.cdp('Runtime.addBinding', { name: '__bcCursor' })
    await this.installScript()
    this.liveness = setInterval(() => this.checkLiveness(), 2000)
  }

  async installScript() {
    if (this.scriptId) {
      await this.cdp('Page.removeScriptToEvaluateOnNewDocument', {
        identifier: this.scriptId
      }).catch(() => undefined)
    }
    const r = await this.cdp('Page.addScriptToEvaluateOnNewDocument', {
      source: PAGE_SCRIPT(this.zoom)
    })
    this.scriptId = r.identifier
    await this.cdp('Runtime.evaluate', { expression: PAGE_SCRIPT(this.zoom) }).catch(
      () => undefined
    )
  }

  // A renderer stuck in JS keeps the browser alive: ask for a value every 2 s, and report a
  // page that has not answered after 5 s (the app then holds the deck on air).
  checkLiveness() {
    if (this.closed || !this.loaded) return
    if (!this.probe) {
      const started = Date.now()
      const probe = { started }
      this.probe = probe
      this.cdp('Runtime.evaluate', { expression: 'document.title', returnByValue: true }, 60000)
        .then((r) => {
          if (this.probe === probe) this.probe = null
          this.hungReported = false
          this.setTitle(r.result?.value)
        })
        .catch(() => {
          if (this.probe === probe) this.probe = null
        })
      return
    }
    if (!this.hungReported && Date.now() - this.probe.started > 5000) {
      this.hungReported = true
      event('hung', { deckId: this.deckId })
    }
  }

  // Chrome only reports a title with a navigation; later changes are read by the probe.
  setTitle(title) {
    if (typeof title !== 'string' || title === this.title || title === this.deckId) return
    this.title = title
    this.emitNav()
  }

  async history() {
    try {
      const h = await this.cdp('Page.getNavigationHistory')
      this.canBack = h.currentIndex > 0
      this.canForward = h.currentIndex < h.entries.length - 1
    } catch {
      /* page is going away */
    }
  }

  emitNav() {
    if (this.closed) return
    event('nav', {
      deckId: this.deckId,
      url: this.url,
      title: this.title,
      canGoBack: this.canBack,
      canGoForward: this.canForward,
      loading: !this.loaded,
      cursor: this.cursor
    })
  }

  async refreshViewport() {
    try {
      const r = await this.cdp('Runtime.evaluate', {
        expression: '[window.innerWidth, window.innerHeight, window.devicePixelRatio]',
        returnByValue: true
      })
      const v = r.result?.value
      if (Array.isArray(v) && v[0] > 0 && v[1] > 0) this.viewport = { w: v[0], h: v[1], dpr: v[2] }
    } catch {
      /* keep the last one */
    }
  }

  // Make the page's viewport exactly the canvas (the window has no frame, but the browser may
  // add its own chrome): resize the window until innerWidth/innerHeight match.
  async fit(left, top) {
    const { windowId } = await this.browser.cdp.send('Browser.getWindowForTarget', {
      targetId: this.targetId
    })
    this.windowId = windowId
    let width = this.canvas.w
    let height = this.canvas.h
    for (let i = 0; i < 4; i++) {
      await this.browser.cdp.send('Browser.setWindowBounds', {
        windowId,
        bounds: {
          windowState: 'normal',
          width,
          height,
          ...(left !== undefined ? { left, top } : {})
        }
      })
      await sleep(150)
      await this.refreshViewport()
      const v = this.viewport
      if (!v) return
      const wantW = Math.round(this.canvas.w / (v.dpr || 1))
      const wantH = Math.round(this.canvas.h / (v.dpr || 1))
      if (v.w === wantW && v.h === wantH) return
      width += wantW - v.w
      height += wantH - v.h
      left = undefined
    }
  }

  /**
   * The page's X11 window, as desktopCapturer lists it: the client window (WM_STATE) titled
   * with the deck id, owned by this browser. A name search alone also finds the window
   * manager's frame (GNOME's mutter-x11-frames copies the title), whose id matches no capture
   * source. Then: no frame, no taskbar entry, below other windows.
   */
  async frameless() {
    // open() renamed the window to the deck id before asking for frames.
    const pid = String(this.browser.proc?.pid ?? 0)
    let xid = null
    for (let i = 0; i < 30 && !xid; i++) {
      const found = (await xwin('find', pid, this.deckId))?.trim()
      if (found && /^[0-9]+$/.test(found)) xid = found
      else await sleep(100)
    }
    if (!xid) return null
    this.xid = xid
    await xwin('prepare', xid)
    return this.xid
  }

  dispose() {
    this.closed = true
    clearInterval(this.liveness)
    pages.delete(this.deckId)
  }
}

function onCdpEvent(browser, method, p, sessionId) {
  if (method === 'Target.targetCreated') {
    const t = p.targetInfo
    if (t.type !== 'page' || !t.openerId) return
    // On air: no new windows (a page must not navigate the live deck away).
    for (const page of pages.values()) {
      if (page.browser === browser && page.targetId === t.openerId && page.live) {
        browser.cdp.send('Target.closeTarget', { targetId: t.targetId }).catch(() => undefined)
      }
    }
    return
  }
  if (method === 'Target.targetInfoChanged') {
    const t = p.targetInfo
    const page = [...pages.values()].find((x) => x.targetId === t.targetId)
    if (!page || page.closed) return
    if (t.title !== undefined && t.title !== page.deckId && !t.title.startsWith(WINDOW_MARK)) {
      page.title = t.title
    }
    if (t.url && !t.url.startsWith('chrome-error:') && t.url !== 'about:blank') page.url = t.url
    void page.history().then(() => page.emitNav())
    return
  }
  const page = [...pages.values()].find((x) => x.sessionId && x.sessionId === sessionId)
  if (!page || page.closed) return
  switch (method) {
    case 'Page.frameStartedLoading':
      if (p.frameId !== page.mainFrameId) break
      page.loaded = false
      page.failed = false
      status(page.deckId, 'loading')
      page.emitNav()
      break
    case 'Page.frameNavigated':
      if (p.frame.parentId) break
      page.mainFrameId = p.frame.id
      if (p.frame.url.startsWith('chrome-error:') || p.frame.unreachableUrl) {
        page.loaded = false
        page.failed = true
        status(page.deckId, 'error', loadFailed(p.frame.unreachableUrl || page.url))
        page.emitNav()
      }
      break
    case 'Page.frameStoppedLoading': {
      // The error page also finishes loading: it is not a ready page. The boot page
      // (about:blank before the first navigate) is not one either, nor is an iframe.
      if (p.frameId !== page.mainFrameId || page.failed || page.url === '') break
      page.loaded = true
      page.crashes = 0
      page.hungReported = false
      status(page.deckId, 'ready')
      void page.refreshViewport()
      void page
        .cdp('Runtime.evaluate', { expression: 'document.title', returnByValue: true })
        .then((r) => {
          if (typeof r.result?.value === 'string' && r.result.value !== page.deckId) {
            page.title = r.result.value
          }
        })
        .catch(() => undefined)
        .then(() => page.history())
        .then(() => page.emitNav())
      break
    }
    case 'Runtime.bindingCalled':
      if (p.name === '__bcCursor' && p.payload !== page.cursor) {
        page.cursor = p.payload
        page.emitNav()
      }
      break
    case 'Inspector.targetCrashed':
      onRendererCrashed(page)
      break
    case 'Page.javascriptDialogOpening':
      // A dialog would freeze the page on air: dismiss it.
      page.cdp('Page.handleJavaScriptDialog', { accept: false }).catch(() => undefined)
      break
    default:
      break
  }
}

async function onRendererCrashed(page) {
  event('crashed', { deckId: page.deckId })
  page.loaded = false
  if (++page.crashes > 3) {
    status(page.deckId, 'error', loadFailed(page.url))
    return
  }
  status(page.deckId, 'loading', 'The page stopped. Reloading it.')
  await sleep(1000)
  if (!page.closed) page.cdp('Page.reload').catch(() => undefined)
}

// ---- keys and mouse (DevTools input: no focus, works while the window is behind others) ----
const VK = {
  ArrowRight: 39,
  ArrowLeft: 37,
  ArrowUp: 38,
  ArrowDown: 40,
  Enter: 13,
  Escape: 27,
  Backspace: 8,
  Tab: 9,
  Delete: 46,
  Home: 36,
  End: 35,
  PageUp: 33,
  PageDown: 34,
  Space: 32,
  Shift: 16,
  Control: 17,
  Alt: 18,
  Meta: 91
}
function keyCodeName(k) {
  if (k.length === 1) {
    if (k === ' ') return 'Space'
    if (/[a-z]/i.test(k)) return `Key${k.toUpperCase()}`
    if (/[0-9]/.test(k)) return `Digit${k}`
    return ''
  }
  return k
}
function virtualKey(k) {
  if (VK[k] !== undefined) return VK[k]
  if (k.length === 1 && /[a-z0-9]/i.test(k)) return k.toUpperCase().charCodeAt(0)
  return 0
}
function modifierMask(list) {
  let mask = 0
  for (const m of Array.isArray(list) ? list : []) {
    if (m === 'alt') mask |= 1
    else if (m === 'control') mask |= 2
    else if (m === 'meta') mask |= 4
    else if (m === 'shift') mask |= 8
  }
  return mask
}
const buttonMask = (b) => (b === 'left' ? 1 : b === 'right' ? 2 : b === 'middle' ? 4 : 0)

function input(page, ev) {
  const kind = ev.kind
  const swallow = (p) => p.catch(() => undefined)
  if (kind === 'key') {
    const keyCode = String(ev.keyCode ?? '')
    if (!keyCode) return
    const vk = virtualKey(keyCode)
    const params = {
      type: ev.type,
      key: keyCode === 'Space' ? ' ' : keyCode,
      code: keyCodeName(keyCode),
      windowsVirtualKeyCode: vk,
      nativeVirtualKeyCode: vk,
      modifiers: modifierMask(ev.modifiers)
    }
    if (ev.type === 'char') {
      params.text = keyCode
      params.unmodifiedText = keyCode
    }
    swallow(page.cdp('Input.dispatchKeyEvent', params))
    return
  }
  const nx = Number(ev.x)
  const ny = Number(ev.y)
  if (!(nx >= 0 && nx <= 1 && ny >= 0 && ny <= 1)) {
    throw new BridgeError('input', `Bad input coordinates: x=${ev.x} y=${ev.y} (${kind})`)
  }
  const vw = page.viewport?.w || page.canvas.w
  const vh = page.viewport?.h || page.canvas.h
  const x = Math.round(nx * vw)
  const y = Math.round(ny * vh)
  if (kind === 'mouse') {
    if (ev.type === 'mouseLeave') return
    const type =
      ev.type === 'mouseDown'
        ? 'mousePressed'
        : ev.type === 'mouseUp'
          ? 'mouseReleased'
          : 'mouseMoved'
    const button = ev.button || 'none'
    swallow(
      page.cdp('Input.dispatchMouseEvent', {
        type,
        x,
        y,
        button,
        clickCount: Number(ev.clickCount) || 0,
        buttons: ev.type === 'mouseDown' ? buttonMask(button) : 0
      })
    )
  } else if (kind === 'wheel') {
    // The app stores the negated DOM delta (Electron's sign); CDP uses the DOM sign again.
    swallow(
      page.cdp('Input.dispatchMouseEvent', {
        type: 'mouseWheel',
        x,
        y,
        deltaX: -(Number(ev.deltaX) || 0),
        deltaY: -(Number(ev.deltaY) || 0),
        button: 'none',
        buttons: 0
      })
    )
  } else {
    throw new BridgeError('input', `Unknown input kind ${kind}`)
  }
}

// ---- commands ----
const need = (a) => {
  const p = pages.get(a.deckId)
  if (!p) throw new BridgeError('page', 'That web page is not open.')
  return p
}

async function previousFocus() {
  const id = (await xwin('active'))?.trim()
  return id && /^[1-9][0-9]*$/.test(id) ? id : null
}

async function open(a) {
  const deckId = String(a.deckId || '')
  if (!/^[A-Za-z0-9-]{1,64}$/.test(deckId)) throw new BridgeError('args', 'Bad deck id.')
  const profile = String(a.profile || 'default')
  if (!SAFE_PROFILE.test(profile)) throw new BridgeError('args', 'Bad profile name.')
  const url = String(a.url || '')
  if (!allowedUrl(url)) throw new BridgeError('url', 'This address cannot be opened.')
  const w = Number(a.width) || 1920
  const h = Number(a.height) || 1080
  if (w < 1 || h < 1) throw new BridgeError('args', 'open needs a size.')
  const x = Math.round(Number(a.x) || 0)
  const y = Math.round(Number(a.y) || 0)
  if (pages.has(deckId)) await closePage(deckId)

  let browser = browsers.get(profile)
  if (!browser) {
    browser = new Browser(profile)
    browsers.set(profile, browser)
  }
  trace('open', deckId, 'profile', profile)
  const focus = await previousFocus()
  try {
    await browser.ensure()
    trace('browser ready')
    const page = new Page(deckId, browser, profile)
    page.canvas = { w, h }
    page.zoom = Number(a.zoom) > 0 ? Number(a.zoom) : 1
    page.live = a.live === true
    page.url = ''
    pages.set(deckId, page)
    const targetId = await browser.newWindow(`${WINDOW_MARK}${deckId}`, w, h, x, y)
    trace('window', targetId)
    await page.attach(targetId)
    trace('attached')
    // Title the window with the deck id so its X window can be found, then size it.
    await page.cdp('Runtime.evaluate', { expression: `document.title = ${JSON.stringify(deckId)}` })
    const xid = await page.frameless()
    trace('x window', xid)
    await page.fit(x, y)
    trace('fitted')
    page.url = url
    await page.cdp('Page.navigate', { url })
    // The operator keeps the keyboard: the page window must never take focus.
    if (focus) await xwin('activate', focus)
    const res = {
      windowId: xid ?? '',
      browserPid: browser.proc?.pid ?? 0,
      ...(browser.audio ? { audioPipe: browser.audio.sock } : {})
    }
    if (!xid) log(`${deckId}: no X window found; capture will not find this page`)
    event('app', { pid: res.browserPid, profile })
    return res
  } catch (e) {
    const page = pages.get(deckId)
    if (page) page.dispose()
    throw e
  }
}

async function closePage(deckId) {
  const page = pages.get(deckId)
  if (!page) return
  page.dispose()
  try {
    await page.browser.cdp.send('Target.closeTarget', { targetId: page.targetId }, undefined, 5000)
  } catch {
    /* already gone */
  }
}

async function handle(cmd, a) {
  switch (cmd) {
    case 'open':
      return open(a)
    case 'navigate': {
      const p = need(a)
      if (!allowedUrl(String(a.url))) throw new BridgeError('url', 'This address cannot be opened.')
      p.url = String(a.url)
      p.loaded = false
      await p.cdp('Page.navigate', { url: p.url })
      return {}
    }
    case 'reload': {
      const p = need(a)
      p.crashes = 0
      await p.cdp('Page.reload')
      return {}
    }
    case 'stop':
      await need(a).cdp('Page.stopLoading')
      return {}
    case 'back':
    case 'forward': {
      const p = need(a)
      const h = await p.cdp('Page.getNavigationHistory')
      const entry = h.entries[h.currentIndex + (cmd === 'back' ? -1 : 1)]
      if (entry) await p.cdp('Page.navigateToHistoryEntry', { entryId: entry.id })
      return {}
    }
    case 'setZoom': {
      const p = need(a)
      const z = Number(a.zoom)
      if (!(z > 0)) throw new BridgeError('args', 'setZoom needs a positive zoom.')
      p.zoom = z
      await p.installScript()
      return {}
    }
    case 'resize': {
      const p = need(a)
      p.canvas = { w: Number(a.width) || p.canvas.w, h: Number(a.height) || p.canvas.h }
      await p.fit()
      return {}
    }
    case 'input':
      input(need(a), a.ev || {})
      return {}
    case 'setMuted': {
      const p = need(a)
      p.muted = a.muted === true
      await p
        .cdp('Runtime.evaluate', { expression: `window.__bcMute = ${p.muted}` })
        .catch(() => undefined)
      const all = [...pages.values()].filter((x) => x.browser === p.browser)
      await p.browser.audio?.setMuted(all.every((x) => x.muted))
      return {}
    }
    case 'setLive':
      need(a).live = a.live === true
      return {}
    case 'snapshot': {
      const p = need(a)
      const r = await p.cdp('Page.captureScreenshot', { format: 'png' }, 15000)
      return { png: r.data }
    }
    case 'signOut': {
      const profile = String(a.profile || 'default')
      if (!SAFE_PROFILE.test(profile)) throw new BridgeError('args', 'Bad profile name.')
      const b = browsers.get(profile)
      if (b?.cdp) {
        await b.cdp.send('Storage.clearCookies').catch(() => undefined)
        for (const p of pages.values()) {
          if (p.browser !== b) continue
          const origin = (() => {
            try {
              return new URL(p.url).origin
            } catch {
              return null
            }
          })()
          if (origin) {
            await p
              .cdp('Storage.clearDataForOrigin', { origin, storageTypes: 'all' })
              .catch(() => undefined)
          }
        }
        // Like the built-in browser: the pages load again, signed out.
        for (const p of pages.values()) {
          if (p.browser === b) await p.cdp('Page.reload').catch(() => undefined)
        }
      } else {
        fs.rmSync(path.join(USER_DATA, profile), { recursive: true, force: true })
      }
      return {}
    }
    case 'close':
      await closePage(String(a.deckId))
      return {}
    case 'ping':
      return { busy: false }
    case 'eval': {
      // Diagnostics only (e2e and field checks): never reachable without the env flag.
      if (process.env.PPT_WEB_BRIDGE_DEBUG !== '1')
        throw new BridgeError('cmd', 'Unknown command eval')
      const r = await need(a).cdp('Runtime.evaluate', {
        expression: String(a.expression),
        returnByValue: true
      })
      return { value: r.result?.value }
    }
    default:
      throw new BridgeError('cmd', `Unknown command ${cmd}`)
  }
}

let shuttingDown = false
async function shutdown() {
  if (shuttingDown) return
  shuttingDown = true
  for (const b of [...browsers.values()]) {
    b.kill()
    if (b.audio) await b.audio.dispose()
  }
  event('exited')
  setTimeout(() => process.exit(0), 200)
}

const rl = readline.createInterface({ input: process.stdin })
rl.on('line', (line) => {
  let req
  try {
    req = JSON.parse(line)
  } catch {
    log('bad line:', line)
    return
  }
  const { id, cmd, ...a } = req
  if (cmd === 'ping') {
    out({ id, ok: true, busy: false })
    return
  }
  handle(cmd, a).then(
    (res) => out({ id, ok: true, ...(res || {}) }),
    (e) =>
      out({
        id,
        ok: false,
        code: e instanceof BridgeError ? e.code : 'error',
        message: String(e?.message || e).replace(/\s+/g, ' ')
      })
  )
})
rl.on('close', () => void shutdown())
process.on('SIGTERM', () => void shutdown())
process.on('SIGINT', () => void shutdown())
process.stdout.on('error', () => process.exit(0))
