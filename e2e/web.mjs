// End-to-end checks of web decks in real Electron (Playwright).
// Run: npm run test:e2e:web   (builds first, then launches out/main/index.js)
//
// Separate from smoke.mjs on purpose: smoke stops at its first failed check
// (a known, unrelated failure). A local http server serves fixtures/web/; the
// app's PPT_OUTPUT_DUMP hook globalThis.__pptWeb reports each web deck's
// status, window.__counter, HOLD and popup state. The output pixel checks read
// the HDMI window (a simulated second display), not the OMT window: on a
// 1920x1080 xvfb screen the OMT window comes out 1919x1079 (existing bug), so
// run on a larger screen to be safe: xvfb-run -a -s '-screen 0 2560x1440x24'.
import { _electron as electron } from 'playwright'
import * as fs from 'node:fs'
import * as http from 'node:http'
import * as os from 'node:os'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const tmpDirs = []
const mkTmp = (prefix) => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), prefix))
  tmpDirs.push(d)
  return d
}
function check(cond, msg) {
  if (!cond) throw new Error(`ASSERT: ${msg}`)
  console.log(`ok - ${msg}`)
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const HDMI_TITLE = 'Bridgecast HDMI'
const PROBE_ID = 515151

// ---------------------------------------------------------------- local web server
const fixture = fs.readFileSync(path.join(root, 'fixtures/web/index.html'))
let release = null
const slowGate = new Promise((r) => (release = r))
// A second slow page, for Edit URL while live (HOLD first, Resume web only once ready).
let release2 = null
const gate2 = new Promise((r) => (release2 = r))
const sockets = new Set()
const server = http.createServer(async (req, res) => {
  if (req.url?.startsWith('/slow')) await slowGate
  if (req.url?.startsWith('/gate2')) await gate2
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', connection: 'close' })
  res.end(fixture)
})
server.on('connection', (s) => {
  sockets.add(s)
  s.on('close', () => sockets.delete(s))
})
await new Promise((r) => server.listen(0, '127.0.0.1', r))
const base = `http://127.0.0.1:${server.address().port}`

// ---------------------------------------------------------------- app helpers
async function launch() {
  const userData = mkTmp('ppt-share-web-')
  const app = await electron.launch({
    args: ['--use-fake-device-for-media-stream', root],
    cwd: root,
    env: {
      ...process.env,
      PPT_SHARE_USER_DATA: userData,
      PPT_OUTPUT_DUMP: mkTmp('ppt-share-web-dump-'),
      ELECTRON_RENDERER_URL: ''
    }
  })
  const errors = []
  const win = await app.firstWindow()
  win.on('pageerror', (e) => errors.push(String(e)))
  await win.waitForSelector('.app')
  return { app, win, errors }
}
const web = (app) => app.evaluate(() => globalThis.__pptWeb)
async function waitWeb(app, pred, what, timeout = 20_000) {
  const end = Date.now() + timeout
  let d = null
  while (Date.now() < end) {
    d = await web(app)
    if (pred(d)) return d
    await sleep(150)
  }
  throw new Error(`ASSERT: ${what} (last: ${JSON.stringify(d)})`)
}
const session = (win) => win.evaluate(() => window.api.getSession())
const dispatch = async (win, a) => {
  await win.evaluate((x) => window.api.dispatch(x), a)
  return (await session(win)).state
}
async function waitState(win, pred, what, timeout = 8000) {
  const end = Date.now() + timeout
  let s = null
  while (Date.now() < end) {
    s = (await session(win)).state
    if (pred(s)) return s
    await sleep(100)
  }
  throw new Error(`ASSERT: ${what} (last: ${JSON.stringify(s)})`)
}
/** Run JS in the host page whose URL contains `part` (the first match). */
const pageEval = (app, part, js) =>
  app.evaluate(
    async ({ BrowserWindow }, [p, code]) => {
      const w = BrowserWindow.getAllWindows().find(
        (x) => !x.isDestroyed() && x.webContents.getURL().includes(p)
      )
      if (!w) throw new Error(`no window for ${p}`)
      return w.webContents.executeJavaScript(code, true) // as a user gesture (popups need one)
    },
    [part, js]
  )
const fakeDisplays = (app, list) =>
  app.evaluate((_e, l) => globalThis.__pptHdmiFakeDisplays(l), list)

/** [r,g,b] of the HDMI window at (x, y) in a 1000x600 sample, from its real pixels. */
const hdmiPx = (app) =>
  app.evaluate(async ({ BrowserWindow }, title) => {
    const w = BrowserWindow.getAllWindows().find((x) => !x.isDestroyed() && x.getTitle() === title)
    if (!w) return null
    const img = await w.webContents.capturePage()
    const { width, height } = img.getSize()
    const bmp = img.toBitmap() // BGRA
    const at = (x, y) => {
      const i = (Math.floor(y) * width + Math.floor(x)) * 4
      return [bmp[i + 2], bmp[i + 1], bmp[i]]
    }
    return [at(width * 0.03, height * 0.05), at(width * 0.97, height * 0.95)]
  }, HDMI_TITLE)
const isBlack = (p) => Math.max(...p) <= 8
/** The page window of a deck (by URL part): visible?, content size, full screen. */
const hostWin = (app, part) =>
  app.evaluate(({ BrowserWindow }, p) => {
    const w = BrowserWindow.getAllWindows().find(
      (x) => !x.isDestroyed() && x.webContents.getURL().includes(p)
    )
    return w
      ? { visible: w.isVisible(), size: w.getContentSize(), fullScreen: w.isFullScreen() }
      : null
  }, part)
/** The HDMI stream layer: the shown <video> (not an incoming one), poster and still. */
const hdmiLayer = (app) =>
  app.evaluate(async ({ BrowserWindow }, t) => {
    const w = BrowserWindow.getAllWindows().find((x) => !x.isDestroyed() && x.getTitle() === t)
    return w.webContents.executeJavaScript(
      `(() => { const l = document.querySelector('.stream-layer'); const v = l?.querySelector('video:not([data-incoming])'); return { video: !!v, paused: !!v?.paused, poster: !!l?.querySelector('img'), still: l?.dataset.still === 'true' } })()`
    )
  }, HDMI_TITLE)
// The fixture background is (32,64,128): blue dominates and it is not black.
const isFixturePx = (px) => px.every((p) => p[2] > 90 && p[2] > p[0] + 40)
async function waitPx(app, pred, what, timeout = 12_000) {
  const end = Date.now() + timeout
  let px = null
  while (Date.now() < end) {
    px = await hdmiPx(app)
    if (px && pred(px)) return px
    await sleep(200)
  }
  throw new Error(`ASSERT: ${what} (last: ${JSON.stringify(px)})`)
}

async function main() {
  const { app, win, errors } = await launch()
  try {
    // ---- event with a PDF deck (event 1 also holds the web decks)
    await win.click('.event-btn')
    await win.getByRole('menuitem', { name: 'New event' }).click()
    await win.fill('.event-input', 'Web Event')
    await win.press('.event-input', 'Enter')
    await win.locator('.event-btn', { hasText: 'Web Event' }).waitFor()
    const eventId = (await session(win)).eventId

    // ---- add web decks: a slow one (stays loading), a quick one, an unreachable one
    const add = (url) => win.evaluate(([e, u]) => window.api.addWebDeck(e, u), [eventId, url])
    const S = await add(`${base}/slow`)
    const B = await add(`${base}/b`)
    const C = await add(`${base}/c`)
    const X = await add('http://127.0.0.1:1/')
    check(S.web?.url === `${base}/slow` && S.source === 'web', 'web deck added with its URL')
    check(
      await win
        .evaluate(() => window.api.addWebDeck('x', 'javascript:alert(1)'))
        .then(() => false)
        .catch((e) => String(e).includes('Enter a web address that starts with https://.')),
      'javascript: is refused with the exact message'
    )

    // ---- the ready gate: refused before ready, accepted after
    const pre = await waitWeb(app, (d) => d[S.id]?.status === 'loading', 'slow page loading')
    check(pre[S.id].status === 'loading', 'the slow page is loading')
    let st = await dispatch(win, { type: 'selectDeck', deckId: S.id })
    check(st.shown === null, `take refused while the page is loading (${JSON.stringify(st)})`)
    await waitWeb(app, (d) => d[X.id]?.status === 'error', 'unreachable page errors')
    st = await dispatch(win, { type: 'selectDeck', deckId: X.id })
    check(st.shown === null, 'take refused for a page that could not load')
    release()
    await waitWeb(
      app,
      (d) =>
        d[S.id]?.status === 'ready' && d[B.id]?.status === 'ready' && d[C.id]?.status === 'ready',
      'pages become ready after a captured frame'
    )
    const sz = (await web(app))[S.id]
    check(
      sz.sizeOk && sz.contentSize[0] === 1920 && sz.contentSize[1] === 1080,
      `host window content size equals the canvas (${sz.contentSize})`
    )
    st = await dispatch(win, { type: 'selectDeck', deckId: S.id })
    check(st.shown?.web?.deckId === S.id && st.deckId === S.id, 'take accepted once ready')
    await waitWeb(app, (d) => d[S.id]?.counter === 0, 'counter readable')

    // ---- real user agent
    const ua = await pageEval(app, '/slow', 'navigator.userAgent')
    check(/Chrome\//.test(ua), `user agent looks like Chrome (${ua})`)
    check(!/Electron\//.test(ua), 'user agent has no Electron/ token')
    check(!/(ppt-share|bridgecast)\//i.test(ua), 'user agent has no app-name token')

    // ---- Next on a live web deck goes to the page, never moves the position
    const before = (await session(win)).state
    await win.locator('body').click({ position: { x: 2, y: 2 } })
    await win.keyboard.press('Space')
    await waitWeb(app, (d) => d[S.id].counter === 1, 'Next press 1 reached the page')
    await win.keyboard.press('Space')
    await waitWeb(app, (d) => d[S.id].counter === 2, 'Next press 2 reached the page')
    await sleep(400)
    check((await web(app))[S.id].counter === 2, 'two presses = counter 2 (one key per press)')
    await win.keyboard.press('ArrowLeft')
    await waitWeb(app, (d) => d[S.id].counter === 1, 'Prev reached the page')
    const after = (await session(win)).state
    check(
      after.index === before.index && after.deckId === before.deckId && after.take === before.take,
      'position and take unchanged after Next/Prev on the live page'
    )
    const focused = await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getFocusedWindow()?.webContents.getURL()
    )
    check(!String(focused).startsWith('http'), 'the page did not take the focus from the app')

    // ---- popup and camera
    await pageEval(app, '/slow', "document.getElementById('popup').click()")
    await sleep(500)
    check(
      (await pageEval(app, '/slow', 'window.__popup')) === 'blocked' &&
        !(await web(app))[S.id].windowOpen,
      'popup refused while the page is live'
    )
    await pageEval(app, '/b', "document.getElementById('popup').click()")
    await waitWeb(app, (d) => d[B.id].windowOpen, 'popup allowed while the page is not live')
    check(true, 'popup allowed while the page is not live')
    await pageEval(app, '/slow', "document.getElementById('camera').click()")
    const cam = await (async () => {
      for (let i = 0; i < 40; i++) {
        const v = await pageEval(app, '/slow', 'window.__camera')
        if (v) return v
        await sleep(150)
      }
      return null
    })()
    check(cam && cam !== 'granted', `camera request denied (${cam})`)
    check(
      (await session(win)).state.shown?.web?.deckId === S.id,
      'nothing on air changed after the popup and camera requests'
    )

    // ---- HTML full screen (Canva Present calls requestFullscreen): the window stays hidden
    await pageEval(app, '/slow', "document.getElementById('fullscreen').click()")
    await sleep(800)
    let hw = await hostWin(app, '/slow')
    check(
      hw && !hw.visible && !hw.fullScreen && hw.size[0] === 1920 && hw.size[1] === 1080,
      `HTML full screen keeps the page window hidden at the canvas size (${JSON.stringify(hw)}, page: ${await pageEval(app, '/slow', 'window.__fullscreen')})`
    )
    await pageEval(app, '/slow', 'document.fullscreenElement && document.exitFullscreen()')
    await sleep(500)
    hw = await hostWin(app, '/slow')
    check(
      hw && !hw.visible && hw.size[0] === 1920 && hw.size[1] === 1080,
      'leaving HTML full screen keeps the page window hidden at the canvas size'
    )
    check(
      (await session(win)).state.shown?.web?.deckId === S.id,
      'full screen changed nothing on air'
    )

    // ---- Prepare input: refused live, accepted frozen
    const key = (type) => ({ kind: 'key', type, keyCode: 'ArrowRight', modifiers: [] })
    let ok = await win.evaluate(([d, i]) => window.api.webInput(d, i), [S.id, key('keyDown')])
    check(ok === false, 'Prepare input refused while the deck is live and not frozen')
    await win.keyboard.press('f')
    await waitState(win, (s) => s.frozen, 'frozen')
    ok = await win.evaluate(([d, i]) => window.api.webInput(d, i), [S.id, key('keyDown')])
    await win.evaluate(([d, i]) => window.api.webInput(d, i), [S.id, key('keyUp')])
    check(ok === true, 'Prepare input accepted while frozen')
    await waitWeb(app, (d) => d[S.id].counter === 2, 'frozen Prepare key reached the page')
    await win.keyboard.press('f')
    await waitState(win, (s) => !s.frozen, 'unfrozen')

    // ---- HDMI output: pixels are not black
    const prim = await app.evaluate(({ screen }) => {
      const d = screen.getPrimaryDisplay()
      return { id: d.id, label: d.label, bounds: d.bounds }
    })
    const b = prim.bounds
    const primary = {
      id: prim.id,
      label: prim.label || 'Display 1',
      width: b.width,
      height: b.height,
      primary: true,
      bounds: b
    }
    const probe = {
      id: PROBE_ID,
      label: 'E2E OUTPUT',
      width: 1920,
      height: 1080,
      primary: false,
      bounds: { x: b.x + b.width - 960, y: b.y + b.height - 540, width: 960, height: 540 }
    }
    await fakeDisplays(app, [primary, probe])
    await win.evaluate((id) => window.api.setHdmi({ enabled: true, displayId: id }), PROBE_ID)
    await win.evaluate(
      () =>
        new Promise((resolve) => {
          const t = setInterval(async () => {
            if ((await window.api.getHdmiStatus()).state === 'showing') {
              clearInterval(t)
              resolve(true)
            }
          }, 100)
        })
    )
    await waitPx(app, (px) => !isBlack(px[0]) && !isBlack(px[1]), 'HDMI output is not black')
    await waitPx(app, isFixturePx, 'HDMI output shows the web page')
    check(true, 'HDMI output shows the live web page (not black)')

    // ---- D / Shift+D take the next / previous deck (the page to be held is taken last, once)
    await win.locator('body').click({ position: { x: 2, y: 2 } })
    await win.keyboard.press('d')
    await waitState(win, (x) => x.shown?.web?.deckId === B.id, 'D')
    check(true, 'D takes the next deck (a ready web deck)')
    await win.keyboard.press('Shift+D')
    await waitState(win, (x) => x.shown?.web?.deckId === S.id, 'Shift+D')
    check(true, 'Shift+D takes the previous deck')
    await win.keyboard.press('d')
    await waitState(win, (x) => x.shown?.web?.deckId === B.id, 'D again')
    await win.keyboard.press('d')
    await waitState(win, (x) => x.shown?.web?.deckId === C.id, 'D to C')
    await waitPx(app, isFixturePx, 'output shows the page after D')

    // ---- Edit URL while live: HOLD first, the output keeps the last frame, Resume web only once ready
    await win.evaluate(([d, u]) => window.api.setWebUrl(d, u), [C.id, `${base}/gate2`])
    st = (await session(win)).state
    check(
      st.webHold === true && st.shown?.web?.deckId === C.id,
      'Edit URL while live goes to HOLD first'
    )
    await waitWeb(app, (d) => d[C.id]?.status === 'loading', 'the new address is loading')
    let lay = await hdmiLayer(app)
    check(
      lay.video && lay.paused && !lay.poster,
      `the output holds its stream (${JSON.stringify(lay)})`
    )
    await sleep(600)
    check(
      isFixturePx(await hdmiPx(app)),
      'the output keeps the last frame while the new page loads'
    )
    st = await dispatch(win, { type: 'resumeWeb' })
    check(st.webHold === true, 'Resume web is refused while the new page is not ready')
    release2()
    await waitWeb(app, (d) => d[C.id]?.status === 'ready', 'the new page is ready')
    st = await dispatch(win, { type: 'resumeWeb' })
    check(
      st.webHold === false && st.shown?.web?.deckId === C.id,
      'Resume web once the page is ready'
    )
    await waitPx(app, isFixturePx, 'output shows the page after Resume web')

    // ---- server stops, Reload while live: HOLD, output keeps the last frame
    for (const s of sockets) s.destroy()
    await new Promise((r) => server.close(r))
    await win.evaluate((d) => window.api.reloadWeb(d), C.id)
    await waitWeb(app, (d) => d[C.id].webHold === true, 'webHold after the page failed to load')
    await waitState(win, (s) => s.webHold === true, 'HOLD in the program state')
    check(true, 'server stopped + Reload while live: webHold true')
    await waitWeb(app, (d) => d[C.id].status === 'error', 'the reload failed')
    await sleep(1500)
    // The HDMI layer pauses its shown stream element (no poster), shows the still, stays on screen.
    lay = await hdmiLayer(app)
    check(
      lay.video && lay.paused && !lay.poster && lay.still,
      `HOLD pauses the stream and keeps it on the output (${JSON.stringify(lay)})`
    )
    // Pixels: sampled several times over 2 s, every sample must be the page's last frame.
    for (let i = 0; i < 5; i++) {
      const px = await hdmiPx(app)
      check(isFixturePx(px), `the output still shows the last frame (${JSON.stringify(px)})`)
      await sleep(400)
    }
    await win.getByRole('button', { name: /Resume web/ }).waitFor({ timeout: 5000 })
    check(true, 'the HOLD warning offers Resume web')
    st = await dispatch(win, { type: 'resumeWeb' })
    check(st.webHold === true, 'Resume web is refused while the page has failed')

    // ---- K or B after HOLD: the failed page never comes back by itself
    await win.locator('body').click({ position: { x: 2, y: 2 } })
    await win.keyboard.press('b')
    st = await waitState(win, (s) => s.black, 'B on after HOLD')
    check(st.black && !st.webHold, 'B after HOLD goes black and ends HOLD')
    await win.keyboard.press('b')
    await sleep(500)
    st = (await session(win)).state
    check(st.black === true, 'B off is refused while the page has failed (output stays black)')
    await waitPx(app, (px) => px.every(isBlack), 'HDMI output stays black')
    check(true, 'the HDMI output stays black, the failed page is not on air')

    // ---- switching event keeps the live page on air; taking a slide of it closes it
    await win.click('.event-btn')
    await win.getByRole('menuitem', { name: 'New event' }).click()
    await win.fill('.event-input', 'Other Event')
    await win.press('.event-input', 'Enter')
    await win.locator('.event-btn', { hasText: 'Other Event' }).waitFor()
    await win.setInputFiles('[data-testid=file-input]', path.join(root, 'fixtures/sample.pdf'))
    await win.locator('.deck .meta', { hasText: '3 slides' }).waitFor({ timeout: 60_000 })
    const other = (await session(win)).eventId
    check(other !== eventId, 'a second event is open')
    st = (await session(win)).state
    check(st.shown?.web?.deckId === C.id, 'switching event keeps the live web page on air')
    const open = await web(app)
    check(
      Object.keys(open).length === 1 && open[C.id],
      `only the live page stays open (${Object.keys(open)})`
    )
    const pdf = await win.evaluate((e) => window.api.listDecks(e), other)
    st = await dispatch(win, { type: 'selectDeck', deckId: pdf[0].id })
    check(st.shown && !st.shown.web, 'a slide of the new event goes on air')
    await waitWeb(app, (d) => Object.keys(d).length === 0, 'the old page closes after leaving air')
    check(true, 'taking a slide of the new event closes the web page window')
    check(errors.length === 0, `no page errors in the operator window ${JSON.stringify(errors)}`)
  } finally {
    await app.close().catch(() => undefined)
  }
}

try {
  await main()
  console.log('all web end-to-end checks passed')
} catch (e) {
  console.error(e)
  process.exitCode = 1
} finally {
  for (const s of sockets) s.destroy()
  server.close()
  for (const d of tmpDirs) fs.rmSync(d, { recursive: true, force: true })
}
