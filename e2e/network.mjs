// End-to-end checks of the OMT network output in real Electron (Playwright).
// Run: npm run test:e2e:network   (builds first, then launches out/main/index.js)
//
// Separate from smoke.mjs on purpose: smoke stops at its first failed check.
// libomt is replaced by a recording fake (PPT_OMT_FAKE=1), exposed under
// PPT_OUTPUT_DUMP as globalThis.__pptOmt; one run without the fake checks the
// missing-library path. Not imported from smoke.mjs.
import { _electron as electron } from 'playwright'
import * as fs from 'node:fs'
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
const OMT_TITLE = 'Bridgecast OMT'
const LIB_MISSING = 'OMT could not start: its library is missing. Reinstall Bridgecast.'

// Pixel helpers: frames carry [corner(10,10), top centre] as [r,g,b].
const isBlackPx = (px) => px.every((p) => Math.max(...p) <= 8)
const isWhitePx = (px) => px.every((p) => Math.min(...p) > 200)
// Slide 2 of sample.pdf is light blue (232,240,255); its corner is not white.
const isBluePx = (px) => px[0][0] < 245 && px[0][2] > 245
const KV_RGB = [220, 40, 160]
const near = (p) => p.every((v, i) => Math.abs(v - KV_RGB[i]) < 25)
const isKvPx = (px) => px.every(near)

// ---------------------------------------------------------------- built bundle
function buildChecks() {
  const main = path.join(root, 'out/main')
  const index = fs.readFileSync(path.join(main, 'index.js'), 'utf8')
  const workers = fs.readdirSync(main).filter((f) => /^worker-.*\.js$/.test(f))
  check(workers.length === 1, `the OMT worker is built (out/main/${workers[0]})`)
  const worker = fs.readFileSync(path.join(main, workers[0]), 'utf8')
  // binding.ts loads koffi through createRequire(__filename): that only works in CJS.
  check(!/import\.meta/.test(index), 'out/main/index.js does not use import.meta (CJS)')
  check(!/import\.meta/.test(worker), `out/main/${workers[0]} does not use import.meta (CJS)`)
  check(!/^import\s/m.test(index) && /require\(/.test(index), 'out/main/index.js is CommonJS')
  check(
    /__filename/.test(index + worker) || /createRequire/.test(index + worker),
    'the bundle still resolves koffi through createRequire(__filename)'
  )
}

// ---------------------------------------------------------------- app helpers
async function launch(extraEnv) {
  const userData = mkTmp('ppt-share-net-')
  const frameDir = mkTmp('ppt-share-net-frames-')
  const app = await electron.launch({
    args: [root],
    cwd: root,
    env: {
      ...process.env,
      PPT_SHARE_USER_DATA: userData,
      PPT_OUTPUT_DUMP: frameDir,
      ELECTRON_RENDERER_URL: '',
      ...extraEnv
    }
  })
  const errors = []
  const win = await app.firstWindow()
  win.on('pageerror', (e) => errors.push(String(e)))
  await win.waitForSelector('.app')
  return { app, win, userData, errors }
}

const dbg = (app) => app.evaluate(() => globalThis.__pptOmt)

async function waitDbg(app, pred, what, timeout = 15_000) {
  const end = Date.now() + timeout
  let d = null
  while (Date.now() < end) {
    d = await dbg(app)
    if (d && pred(d)) return d
    await sleep(150)
  }
  throw new Error(`ASSERT: ${what} (last: ${JSON.stringify(d)})`)
}

const omtWindows = (app) =>
  app.evaluate(
    ({ BrowserWindow }, title) =>
      BrowserWindow.getAllWindows().filter((w) => !w.isDestroyed() && w.getTitle() === title)
        .length,
    OMT_TITLE
  )

/** data-local / data-tap of every output window's `.output` element, by window title. */
const plans = (app) =>
  app.evaluate(
    async ({ BrowserWindow }, titles) => {
      const out = {}
      for (const t of titles) {
        const w = BrowserWindow.getAllWindows().find((x) => !x.isDestroyed() && x.getTitle() === t)
        out[t] = w
          ? await w.webContents.executeJavaScript(
              `(() => { const o = document.querySelector('.output'); return o ? { local: o.dataset.local, tap: o.dataset.tap } : null })()`
            )
          : null
      }
      return out
    },
    [HDMI_TITLE, OMT_TITLE]
  )

async function waitPlans(app, pred, what, timeout = 8000) {
  const end = Date.now() + timeout
  let p = null
  while (Date.now() < end) {
    p = await plans(app)
    if (pred(p)) return p
    await sleep(150)
  }
  throw new Error(`ASSERT: ${what} (last: ${JSON.stringify(p)})`)
}
const localCount = (p) => Object.values(p).filter((x) => x?.local === 'true').length

const setOmt = (win, o) => win.evaluate((v) => window.api.setOmt(v), o)
const setAudio = (win, a) => win.evaluate((v) => window.api.setAudio(v), a)
const omtStatus = (win) => win.evaluate(() => window.api.getOmtStatus())

async function waitStatus(win, pred, what, timeout = 15_000) {
  const end = Date.now() + timeout
  let s = null
  while (Date.now() < end) {
    s = await omtStatus(win)
    if (pred(s)) return s
    await sleep(150)
  }
  throw new Error(`ASSERT: ${what} (last: ${JSON.stringify(s)})`)
}

const fakeDisplays = (app, list) =>
  app.evaluate((_e, l) => globalThis.__pptHdmiFakeDisplays(l), list)

// ---------------------------------------------------------------- scenario 1: fake sender
async function fakeScenario() {
  const { app, win, errors } = await launch({ PPT_OMT_FAKE: '1' })
  const PROBE_ID = 515151
  try {
    // A KV image, an event and a 3-slide deck; slide 1 goes LIVE (white).
    const kvPath = path.join(mkTmp('ppt-share-net-kv-'), 'kv.png')
    const b64 = await app.evaluate(({ nativeImage }, rgb) => {
      const w = 1280
      const h = 720
      const buf = Buffer.alloc(w * h * 4)
      for (let i = 0; i < buf.length; i += 4) {
        buf[i] = rgb[2]
        buf[i + 1] = rgb[1]
        buf[i + 2] = rgb[0]
        buf[i + 3] = 255
      }
      return nativeImage.createFromBitmap(buf, { width: w, height: h }).toPNG().toString('base64')
    }, KV_RGB)
    fs.writeFileSync(kvPath, Buffer.from(b64, 'base64'))

    await win.click('.event-btn')
    await win.getByRole('menuitem', { name: 'New event' }).click()
    await win.fill('.event-input', 'Net Event')
    await win.press('.event-input', 'Enter')
    await win.locator('.event-btn', { hasText: 'Net Event' }).waitFor()
    await win.setInputFiles('[data-testid=kv-input]', kvPath)
    await win.locator('[data-testid=kv-thumb] img').waitFor({ timeout: 10_000 })
    await win.setInputFiles('[data-testid=file-input]', path.join(root, 'fixtures/sample.pdf'))
    await win.locator('.deck .meta', { hasText: '3 slides' }).waitFor({ timeout: 60_000 })
    const tallyIs = (t) =>
      win.waitForFunction(
        (x) => document.querySelector('[data-testid=tally]')?.textContent === x,
        t
      )
    await win.keyboard.press('b') // the KV is on at STANDBY; B clears it for a clean start
    await win.keyboard.press('b')
    await win.keyboard.press('Space')
    await tallyIs('LIVE')
    check(true, 'event, KV and a 3-slide deck ready; slide 1 LIVE')

    const d0 = await dbg(app)
    check(d0.status.state === 'off' && !d0.windowExists && !d0.workerAlive, 'OMT starts off')

    // ---- OMT on, HDMI off: 1920x1080 frames, black first, content after output:ready
    await setOmt(win, { enabled: true, name: 'Bridgecast', fps: 30 })
    const first = await waitDbg(
      app,
      (d) => d.frames && d.frames.count > 5 && d.frames.lastPx && !isBlackPx(d.frames.lastPx),
      'OMT frames reach the sender and turn non-black after output:ready'
    )
    check(
      JSON.stringify(first.frames.sizes) === '["1920x1080"]',
      `OMT on, HDMI off: frames are 1920x1080 (${first.frames.sizes})`
    )
    check(isBlackPx(first.frames.firstPx), 'the first frame is black (before output:ready)')
    check(isWhitePx(first.frames.lastPx), 'after output:ready the frames show slide 1')
    check(first.ready && first.sending, 'controller reports ready and sending')
    const st = await waitStatus(win, (s) => s.state === 'running', 'OMT status running')
    check(st.address === 'omt://fake', 'status carries the (fake) source address')

    // ---- Next / Black / KV change the frame content
    const content = (pred, what) =>
      waitDbg(app, (d) => d.frames?.lastPx && pred(d.frames.lastPx), what, 8000)
    await win.keyboard.press('Space')
    await content(isBluePx, 'Next: frames show slide 2')
    check(true, 'Next changes the frame content (slide 2, blue corner)')
    await win.keyboard.press('b')
    await content(isBlackPx, 'Black: frames turn black')
    check(true, 'Black makes the frames black')
    await win.keyboard.press('b')
    await content(isBluePx, 'Black off: slide 2 returns')
    await win.keyboard.press('k')
    await content(isKvPx, 'KV: frames show the KV colour')
    check(true, 'KV changes the frame content (key visual colour)')
    await win.keyboard.press('k')
    await content(isBluePx, 'KV off: slide 2 returns')

    // ---- no Next for 3 s at 30 fps: about 90 frames (receivers must not time out)
    const c0 = (await dbg(app)).frames.count
    const t0 = Date.now()
    await sleep(3000)
    const c1 = (await waitDbg(app, (d) => d.frames.count > c0, 'frame count advances')).frames.count
    const secs = (Date.now() - t0) / 1000
    const rate = (c1 - c0) / secs
    check(
      rate > 26 && rate < 34,
      `no Next for ${secs.toFixed(1)} s at 30 fps: ${c1 - c0} frames (${rate.toFixed(1)}/s, expected about 90 per 3 s)`
    )

    // ---- audio plan: exactly one window plays locally; route both taps
    await setAudio(win, { deviceId: null, muted: false, masterVolume: 100, route: 'both' })
    let p = await waitPlans(
      app,
      (x) => x[OMT_TITLE]?.local === 'true' && x[OMT_TITLE]?.tap === 'true',
      'HDMI off, route both: the OMT window plays locally and taps'
    )
    check(
      p[HDMI_TITLE] === null && localCount(p) === 1,
      'HDMI off, route both: OMT local on, tap on, exactly one local window'
    )
    // ---- audio port: ~100 blocks/s, 960-element blocks
    const a0 = (await dbg(app)).frames.audioBlocks
    const ta = Date.now()
    await sleep(2000)
    const a1 = (await dbg(app)).frames
    const ar = (a1.audioBlocks - a0) / ((Date.now() - ta) / 1000)
    check(
      ar > 70 && ar < 130 && a1.lastAudioLen === 960,
      `audio port delivers blocks: ${ar.toFixed(0)}/s of ${a1.lastAudioLen} samples (expected about 100/s of 960)`
    )

    await setAudio(win, { deviceId: null, muted: false, masterVolume: 100, route: 'local' })
    p = await waitPlans(
      app,
      (x) => x[OMT_TITLE]?.local === 'true' && x[OMT_TITLE]?.tap === 'false',
      'HDMI off, route local: OMT plays locally, no tap'
    )
    check(true, 'route Local: OMT window local on, tap off')
    await setAudio(win, { deviceId: null, muted: false, masterVolume: 100, route: 'omt' })
    p = await waitPlans(
      app,
      (x) => x[OMT_TITLE]?.local === 'false' && x[OMT_TITLE]?.tap === 'true',
      'HDMI off, route OMT: tap only'
    )
    check(localCount(p) === 0, 'route OMT: nobody plays locally, the OMT window taps')

    // HDMI shown on a simulated second display, route both: HDMI plays, OMT only taps.
    await setAudio(win, { deviceId: null, muted: false, masterVolume: 100, route: 'both' })
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
    p = await waitPlans(
      app,
      (x) =>
        x[HDMI_TITLE]?.local === 'true' &&
        x[HDMI_TITLE]?.tap === 'false' &&
        x[OMT_TITLE]?.local === 'false' &&
        x[OMT_TITLE]?.tap === 'true',
      'HDMI showing + route both: HDMI plays, OMT taps without local sound'
    )
    check(
      localCount(p) === 1,
      'HDMI showing: exactly one window plays locally (HDMI), the HDMI window never taps'
    )
    // The display goes away: the HDMI window stays but is hidden. Exactly one local window again: OMT.
    await fakeDisplays(app, [primary])
    p = await waitPlans(
      app,
      (x) => x[HDMI_TITLE]?.local === 'false' && x[OMT_TITLE]?.local === 'true',
      'HDMI hidden: the OMT window takes over local sound'
    )
    check(
      localCount(p) === 1 && p[HDMI_TITLE]?.tap === 'false',
      'HDMI hidden, OMT on: exactly ONE window plays local sound (OMT); the HDMI window never taps'
    )
    await win.evaluate(() => window.api.setHdmi({ enabled: false, displayId: null }))
    await fakeDisplays(app, null)
    await setAudio(win, { deviceId: null, muted: false, masterVolume: 100, route: 'local' })

    // ---- 'no-sound' warning arrives in the status through the OMT window's own channel.
    // The worklet failure itself is not forced here (it needs a broken module URL);
    // this proves the renderer -> main -> status path with the real preload API.
    await app.evaluate(
      ({ BrowserWindow }, title) =>
        BrowserWindow.getAllWindows()
          .find((w) => w.getTitle() === title)
          .webContents.executeJavaScript(`window.api.reportOmtWarning('no-sound')`),
      OMT_TITLE
    )
    await waitStatus(win, (s) => s.warning === 'no-sound', 'status carries the no-sound warning')
    check(true, "the OMT window's report puts warning 'no-sound' in the OMT status")

    // ---- event canvas 3840x1080 -> frames 3840x1080
    const sess = await win.evaluate(() => window.api.getSession())
    await win.evaluate(
      (id) => window.api.setEventCanvas(id, { width: 3840, height: 1080 }),
      sess.eventId
    )
    const big = await waitDbg(
      app,
      (d) => d.frames && d.frames.sizes.join() === '3840x1080' && d.frames.count > 10,
      'frames become 3840x1080 after the event canvas change (sender restarted)',
      20_000
    )
    check(
      true,
      `event canvas 3840x1080: frames are ${big.frames.sizes} (${big.frames.count} so far)`
    )
    await waitDbg(
      app,
      (d) => d.frames.lastPx && !isBlackPx(d.frames.lastPx),
      'wide canvas shows content'
    )
    await win.evaluate((id) => window.api.setEventCanvas(id, null), sess.eventId)
    await waitDbg(
      app,
      (d) => d.frames && d.frames.sizes.join() === '1920x1080' && d.frames.count > 10,
      'frames go back to 1920x1080',
      20_000
    )
    check(true, 'canvas back to the default: frames 1920x1080 again')

    // ---- offscreen renderer killed: frames continue (last content, never black), then recover
    await waitDbg(
      app,
      (d) => d.ready && d.frames.lastPx && !isBlackPx(d.frames.lastPx),
      'content before the crash'
    )
    const before = await dbg(app)
    await app.evaluate(
      ({ BrowserWindow }, title) =>
        BrowserWindow.getAllWindows()
          .find((w) => w.getTitle() === title)
          .webContents.forcefullyCrashRenderer(),
      OMT_TITLE
    )
    await sleep(600)
    const during = await dbg(app)
    const cA = during.frames.count
    await sleep(500)
    const cB = (await dbg(app)).frames.count
    check(cB > cA, `after the renderer crash the sender keeps sending (${cA} -> ${cB} frames)`)
    check(
      during.frames.blackAfterContent === before.frames.blackAfterContent &&
        !isBlackPx(during.frames.lastPx),
      'the crash causes no black frame (the last content repeats)'
    )
    const rec = await waitDbg(
      app,
      (d) => d.windowCreates > before.windowCreates && d.ready,
      'the OMT window is recreated and ready',
      20_000
    )
    check(
      true,
      `renderer recovers: window recreated (${before.windowCreates} -> ${rec.windowCreates}) and ready`
    )
    await win.keyboard.press('Space')
    await waitDbg(
      app,
      (d) => d.frames.lastPx && isBluePx(d.frames.lastPx) === false,
      'new content after recovery',
      8000
    )
    check(
      (await dbg(app)).frames.blackAfterContent === before.frames.blackAfterContent,
      'still no black frame after the recovery and a Next'
    )

    // ---- OMT off: window and worker gone
    await setOmt(win, { enabled: false, name: 'Bridgecast', fps: 30 })
    const off = await waitDbg(
      app,
      (d) => !d.windowExists && !d.workerAlive,
      'OMT off removes window and worker'
    )
    check(off.status.state === 'off', 'OMT off: status off, controller has no window and no worker')
    check((await omtWindows(app)) === 0, 'OMT off: no OMT BrowserWindow left')

    // ---- quit while sending exits cleanly and quickly
    await setOmt(win, { enabled: true, name: 'Bridgecast', fps: 30 })
    await waitDbg(
      app,
      (d) => d.sending && d.frames && d.frames.count > 5,
      'sending again before quit'
    )
    const proc = app.process()
    const exited = new Promise((resolve) =>
      proc.once('exit', (code, sig) => resolve({ code, sig }))
    )
    const tq = Date.now()
    await app.evaluate(({ app: a }) => a.quit()).catch(() => undefined)
    const r = await Promise.race([exited, sleep(10_000).then(() => null)])
    check(r !== null, `quit while sending: the app process exits (${Date.now() - tq} ms)`)
    check(r.code === 0, `quit while sending exits with code 0 (code ${r.code}, signal ${r.sig})`)
    check(Date.now() - tq < 6000, `quit while sending finished within 6 s (${Date.now() - tq} ms)`)
    check(errors.length === 0, `no page errors in the operator window ${JSON.stringify(errors)}`)
  } finally {
    await app.close().catch(() => undefined)
  }
}

// ---------------------------------------------------------------- scenario 2: library missing
async function missingLibraryScenario() {
  const emptyDir = mkTmp('ppt-share-net-nolib-')
  const { app, win } = await launch({ PPT_OMT_FAKE: '', PPT_LIBOMT_DIR: emptyDir })
  const PROBE_ID = 515152
  try {
    await setOmt(win, { enabled: true, name: 'Bridgecast', fps: 30 })
    const s = await waitStatus(
      win,
      (x) => x.state === 'error',
      'OMT reports an error without its library'
    )
    check(s.message === LIB_MISSING, `library missing: status error "${s.message}"`)
    // HDMI keeps working with OMT in error.
    const prim = await app.evaluate(({ screen }) => {
      const d = screen.getPrimaryDisplay()
      return { id: d.id, label: d.label, bounds: d.bounds }
    })
    const b = prim.bounds
    await fakeDisplays(app, [
      {
        id: prim.id,
        label: prim.label || 'Display 1',
        width: b.width,
        height: b.height,
        primary: true,
        bounds: b
      },
      {
        id: PROBE_ID,
        label: 'E2E OUTPUT',
        width: 1920,
        height: 1080,
        primary: false,
        bounds: { x: b.x + b.width - 960, y: b.y + b.height - 540, width: 960, height: 540 }
      }
    ])
    await win.evaluate((id) => window.api.setHdmi({ enabled: true, displayId: id }), PROBE_ID)
    await win.evaluate(
      () =>
        new Promise((resolve, reject) => {
          const end = Date.now() + 15_000
          const t = setInterval(async () => {
            if ((await window.api.getHdmiStatus()).state === 'showing') {
              clearInterval(t)
              resolve(true)
            } else if (Date.now() > end) {
              clearInterval(t)
              reject(new Error('HDMI never showed'))
            }
          }, 100)
        })
    )
    const hdmiWins = await app.evaluate(
      ({ BrowserWindow }, title) =>
        BrowserWindow.getAllWindows().filter(
          (w) => !w.isDestroyed() && w.getTitle() === title && w.isVisible()
        ).length,
      HDMI_TITLE
    )
    check(hdmiWins === 1, 'library missing: the HDMI output still shows its window')
    check(
      (await omtStatus(win)).state === 'error',
      'library missing: OMT stays in error while HDMI runs'
    )
  } finally {
    await app.close().catch(() => undefined)
  }
}

// ---------------------------------------------------------------- scenario 3: OMT + NDI together
const setNdi = (win, n) => win.evaluate((v) => window.api.setNdi(v), n)
const ndiStatus = (win) => win.evaluate(() => window.api.getNdiStatus())
const net = (app) => app.evaluate(() => globalThis.__pptNet)
const NDI_MISSING =
  'NDI could not start: the NDI Runtime is not installed. Install it from ndi.video, then turn NDI off and on.'
const OMT_ON = { enabled: true, name: 'Bridgecast', fps: 30 }
const NDI_ON = { enabled: true, name: 'Bridgecast NDI' }
const NDI_OFF = { enabled: false, name: 'Bridgecast NDI' }

async function waitNet(app, pred, what, timeout = 20_000) {
  const end = Date.now() + timeout
  let d = null
  while (Date.now() < end) {
    d = await net(app)
    if (d && pred(d)) return d
    await sleep(150)
  }
  throw new Error(
    `ASSERT: ${what} (last: ${JSON.stringify(d && { ...d, targets: d.targets.map((t) => ({ id: t.id, n: t.frames.length, last: t.frames.at(-1) })) })})`
  )
}
const target = (d, id) => d.targets.find((t) => t.id === id)
const lastOf = (d, id) => target(d, id)?.frames.at(-1)
const countOf = (d, id) => target(d, id)?.frames.length ?? 0
/** Both targets have frames, the last one of each has this size and fps. */
const bothAt = (w, h, fps) => (d) =>
  ['omt', 'ndi'].every((id) => {
    const f = lastOf(d, id)
    return countOf(d, id) > 5 && f && f.width === w && f.height === h && f.fps === fps
  })
const allSame = (d, id, w, h, fps) =>
  target(d, id).frames.every((f) => f.width === w && f.height === h && f.fps === fps)

async function bothScenario() {
  const { app, win, errors } = await launch({ PPT_OMT_FAKE: '1', PPT_NDI_FAKE: '1' })
  try {
    await win.click('.event-btn')
    await win.getByRole('menuitem', { name: 'New event' }).click()
    await win.fill('.event-input', 'Both Event')
    await win.press('.event-input', 'Enter')
    await win.locator('.event-btn', { hasText: 'Both Event' }).waitFor()
    await win.setInputFiles('[data-testid=file-input]', path.join(root, 'fixtures/sample.pdf'))
    await win.locator('.deck .meta', { hasText: '3 slides' }).waitFor({ timeout: 60_000 })
    await win.keyboard.press('Space')
    await win.waitForFunction(
      () => document.querySelector('[data-testid=tally]')?.textContent === 'LIVE'
    )

    const n0 = await net(app)
    check(
      n0.windows === 0 && n0.targets.every((t) => t.frames.length === 0),
      'both off: no window and no frames'
    )

    // ---- both on, HDMI off: one offscreen window, both targets get 1920x1080 at 30 fps
    await setOmt(win, OMT_ON)
    await setNdi(win, NDI_ON)
    const d1 = await waitNet(
      app,
      bothAt(1920, 1080, 30),
      'both targets receive 1920x1080 at 30 fps'
    )
    check(d1.windows === 1, 'OMT and NDI on, HDMI off: exactly one offscreen window')
    check(
      allSame(d1, 'omt', 1920, 1080, 30) && allSame(d1, 'ndi', 1920, 1080, 30),
      'every OMT and NDI frame is 1920x1080 with fps 30'
    )
    check((await omtWindows(app)) === 1, 'exactly one OMT-titled BrowserWindow exists')
    await waitStatus(win, (s) => s.state === 'running', 'OMT running')
    const ns = await waitNdiStatus(win, (s) => s.state === 'running', 'NDI running')
    check(ns.state === 'running', 'NDI status running')
    // Same content: the sample deck's slide 1 is white on both.
    const dc = await waitDbg(
      app,
      (d) => d.frames?.lastPx && isWhitePx(d.frames.lastPx),
      'slide 1 reaches the OMT frames'
    )
    check(isWhitePx(dc.frames.lastPx), 'OMT frames show slide 1 (white)')
    const px = (await waitNet(app, (d) => target(d, 'ndi').lastPx, 'NDI has a last frame')).targets
    const omtPx = px.find((t) => t.id === 'omt').lastPx
    const ndiPx = px.find((t) => t.id === 'ndi').lastPx
    check(
      isWhitePx(ndiPx) && JSON.stringify(ndiPx) === JSON.stringify(omtPx),
      `NDI frames carry the same content as OMT (${JSON.stringify(ndiPx)})`
    )

    // ---- NDI off: OMT keeps flowing, the NDI sender is destroyed.
    // The debug snapshot refreshes every 500 ms, so a pause cannot be seen tick by tick:
    // the frame deficit over a 4 s window around the switch must stay within two ticks
    // (plus 3 for snapshot timing jitter). The frame clock is not restarted by setTargets.
    const snap = async () => {
      const d = await waitDbg(app, (x) => x.frames?.count > 0, 'OMT snapshot')
      return { t: Date.now(), c: d.frames.count }
    }
    let s0 = await snap()
    for (;;) {
      const x = await snap()
      if (x.c !== s0.c) {
        s0 = x
        break
      }
      await sleep(30)
    }
    await setNdi(win, NDI_OFF)
    await sleep(4000)
    let s1 = await snap()
    for (;;) {
      await sleep(30)
      const x = await snap()
      if (x.c !== s1.c) {
        s1 = x
        break
      }
    }
    const expected = ((s1.t - s0.t) / 1000) * 30
    const deficit = expected - (s1.c - s0.c)
    check(s1.c > s0.c, `NDI off: OMT frame count keeps rising (${s0.c} -> ${s1.c})`)
    check(
      deficit <= 2 + 3,
      `NDI off: OMT lost no more than two ticks (${s1.c - s0.c} frames in ${((s1.t - s0.t) / 1000).toFixed(2)} s, expected about ${expected.toFixed(0)})`
    )
    const st = await waitNdiStatus(win, (s) => s.state === 'off', 'NDI status off')
    check(st.state === 'off', 'NDI off: status off')
    const ndiFrozen = countOf(await net(app), 'ndi')
    await sleep(600)
    check(
      countOf(await net(app), 'ndi') === ndiFrozen,
      'NDI off: the NDI target no longer receives frames (destroyed)'
    )
    check((await net(app)).windows === 1, 'NDI off, OMT on: the offscreen window stays')

    // ---- NDI on again: a fresh target receives frames
    await setNdi(win, NDI_ON)
    await waitNet(
      app,
      (d) => countOf(d, 'ndi') > 5 && lastOf(d, 'ndi').width === 1920,
      'NDI receives frames again after it is switched back on'
    )
    check(true, 'NDI on again: the NDI target receives frames again')

    // ---- 60 fps applies to both and restarts both once
    const wc = (await dbg(app)).windowCreates
    await setOmt(win, { ...OMT_ON, fps: 60 })
    const d60 = await waitNet(app, bothAt(1920, 1080, 60), 'both targets report fps 60')
    check(
      allSame(d60, 'omt', 1920, 1080, 60) && allSame(d60, 'ndi', 1920, 1080, 60),
      'frame rate 60: both targets restarted and every new frame reports fps 60'
    )
    check(
      (await dbg(app)).windowCreates === wc,
      'frame rate 60 keeps the same offscreen window (no extra window)'
    )

    // ---- event canvas 3840x1080 reaches both targets
    const sess = await win.evaluate(() => window.api.getSession())
    await win.evaluate(
      (id) => window.api.setEventCanvas(id, { width: 3840, height: 1080 }),
      sess.eventId
    )
    const dw = await waitNet(app, bothAt(3840, 1080, 60), 'both targets receive 3840x1080')
    check(
      allSame(dw, 'omt', 3840, 1080, 60) && allSame(dw, 'ndi', 3840, 1080, 60),
      'event canvas 3840x1080: both OMT and NDI frames are 3840x1080'
    )
    await win.evaluate((id) => window.api.setEventCanvas(id, null), sess.eventId)
    await waitNet(app, bothAt(1920, 1080, 60), 'canvas back to 1920x1080 on both')

    // ---- both off: window and worker gone
    await setOmt(win, { ...OMT_ON, enabled: false })
    await setNdi(win, NDI_OFF)
    const off = await waitDbg(
      app,
      (d) => !d.windowExists && !d.workerAlive,
      'both off removes window and worker'
    )
    check(!off.windowExists && !off.workerAlive, 'both off: no window and no worker')
    check((await omtWindows(app)) === 0, 'both off: no OMT BrowserWindow left')
    check(errors.length === 0, `no page errors in the operator window ${JSON.stringify(errors)}`)
  } finally {
    await app.close().catch(() => undefined)
  }
}

async function waitNdiStatus(win, pred, what, timeout = 15_000) {
  const end = Date.now() + timeout
  let s = null
  while (Date.now() < end) {
    s = await ndiStatus(win)
    if (pred(s)) return s
    await sleep(150)
  }
  throw new Error(`ASSERT: ${what} (last: ${JSON.stringify(s)})`)
}

async function ndiMissingScenario() {
  const { app, win } = await launch({ PPT_OMT_FAKE: '1', PPT_NDI_FAKE: 'missing' })
  try {
    await setOmt(win, OMT_ON)
    await setNdi(win, NDI_ON)
    const s = await waitNdiStatus(win, (x) => x.state === 'error', 'NDI errors without its runtime')
    check(s.message === NDI_MISSING, `NDI runtime missing: status error "${s.message}"`)
    const before = countOf(
      await waitNet(app, (d) => countOf(d, 'omt') > 5, 'OMT frames flow'),
      'omt'
    )
    await sleep(800)
    const after = countOf(await net(app), 'omt')
    check(after > before, `NDI missing: OMT frames continue (${before} -> ${after})`)
    check((await omtStatus(win)).state === 'running', 'NDI missing: OMT stays running')
    check(countOf(await net(app), 'ndi') === 0, 'NDI missing: the NDI target got no frames')
    await setOmt(win, { ...OMT_ON, enabled: false })
    await setNdi(win, NDI_OFF)
    await waitDbg(
      app,
      (d) => !d.windowExists && !d.workerAlive,
      'both off removes window and worker'
    )
    check(true, 'NDI missing, then both off: window and worker gone')
  } finally {
    await app.close().catch(() => undefined)
  }
}

// ---------------------------------------------------------------- run
try {
  buildChecks()
  await fakeScenario()
  await missingLibraryScenario()
  await bothScenario()
  await ndiMissingScenario()
  console.log('all OMT end-to-end checks passed')
} catch (e) {
  console.error(e)
  process.exitCode = 1
} finally {
  for (const d of tmpDirs) fs.rmSync(d, { recursive: true, force: true })
}
