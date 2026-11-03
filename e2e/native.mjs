// End-to-end checks of native slideshow decks in real Electron (Playwright), with the
// in-memory FakeEngine (PPT_ENGINE_FAKE=1) instead of PowerPoint.
// Run: npm run test:e2e:native   (builds first, then launches out/main/index.js)
//
// Separate from smoke.mjs on purpose: smoke is red at baseline ("a hidden output window
// mutes its video") and stops at its first failed check, so checks added there would
// never run. The library is seeded on disk (a native deck with clicks [3,0,1], a vector
// PDF deck, a PDF deck whose source.pdf is broken, a second native deck). The window
// ids of the FakeEngine are not real windows, so the capture never gives a frame and the
// output shows the slide's PNG under the stream layer: the checks read the HDMI window's
// real pixels and layer DOM. Hooks (only with PPT_OUTPUT_DUMP): globalThis.__pptEngine
// (opens, crash()) and an export stand-in for Edit in PowerPoint. What is NOT covered
// here (needs Windows): the real PowerPoint window capture, its sound path (the
// Black/KV silence of PowerPoint's sound is unit tested; the fake engine has no sound
// route to observe), click accuracy. See docs/test-checklist.md "Putar PPT asli".
// Headless Linux: xvfb-run -a -s '-screen 0 2560x1440x24' npm run test:e2e:native
import { _electron as electron } from 'playwright'
import * as crypto from 'node:crypto'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import * as zlib from 'node:zlib'
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

// ---------------------------------------------------------------- fixtures on disk
const crcTable = new Int32Array(256).map((_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c
})
const crc32 = (buf) => {
  let c = -1
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8)
  return (c ^ -1) >>> 0
}
const chunk = (type, data) => {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([len, body, crc])
}
/** A solid-colour 192x108 PNG. */
function png([r, g, b]) {
  const w = 192
  const h = 108
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0)
  ihdr.writeUInt32BE(h, 4)
  ihdr[8] = 8
  ihdr[9] = 2
  const row = Buffer.concat([Buffer.from([0]), Buffer.from(Array(w).fill([r, g, b]).flat())])
  const raw = Buffer.concat(Array(h).fill(row))
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0))
  ])
}
const RED = [220, 40, 40]
const GREEN = [40, 200, 60]
const BLUE = [40, 80, 220]
const colors = [RED, GREEN, BLUE]

function seed(userData) {
  const ids = {
    native: crypto.randomUUID(),
    native2: crypto.randomUUID(),
    vector: crypto.randomUUID(),
    broken: crypto.randomUUID()
  }
  const mk = (id, name, source, playback, slides, files) => {
    const dir = path.join(userData, 'decks', id)
    fs.mkdirSync(dir, { recursive: true })
    slides.forEach((s, i) => fs.writeFileSync(path.join(dir, s.file), png(colors[i % 3])))
    for (const [f, data] of Object.entries(files)) fs.writeFileSync(path.join(dir, f), data)
    fs.writeFileSync(
      path.join(dir, 'deck.json'),
      JSON.stringify({ id, name, source, width: 1920, height: 1080, slides, playback })
    )
  }
  const slide = (i, clicks) => ({
    file: `${String(i + 1).padStart(3, '0')}.png`,
    notes: '',
    ...(clicks ? { clicks } : {})
  })
  const pptx = { 'original.pptx': 'v1', 'source.pptx': 'v1' }
  mk(ids.native, 'Native A', 'pptx', 'native', [slide(0, 3), slide(1, 0), slide(2, 1)], pptx)
  mk(ids.native2, 'Native B', 'pptx', 'native', [slide(0, 0), slide(1, 0)], pptx)
  mk(ids.vector, 'Vector', 'pdf', 'vector', [slide(0), slide(1), slide(2)], {
    'source.pdf': fs.readFileSync(path.join(root, 'fixtures/sample.pdf'))
  })
  mk(ids.broken, 'Broken PDF', 'pdf', 'vector', [slide(0), slide(1), slide(2)], {
    'source.pdf': 'this is not a pdf'
  })
  const eventId = crypto.randomUUID()
  fs.writeFileSync(
    path.join(userData, 'events.json'),
    JSON.stringify([
      {
        id: eventId,
        name: 'Native Event',
        deckIds: [ids.native, ids.native2, ids.vector, ids.broken]
      }
    ])
  )
  return { ids, eventId, dir: (id) => path.join(userData, 'decks', id) }
}

// ---------------------------------------------------------------- app helpers
async function launch(userData) {
  const app = await electron.launch({
    args: [root],
    cwd: root,
    env: {
      ...process.env,
      PPT_SHARE_USER_DATA: userData,
      PPT_OUTPUT_DUMP: mkTmp('ppt-share-native-dump-'),
      PPT_ENGINE_FAKE: '1',
      PPT_SKIP_HOME: '1',
      ELECTRON_RENDERER_URL: ''
    }
  })
  const errors = []
  const win = await app.firstWindow()
  win.on('pageerror', (e) => errors.push(String(e)))
  await win.waitForSelector('.app')
  return { app, win, errors }
}
const session = (win) => win.evaluate(() => window.api.getSession())
const dispatch = async (win, a) => {
  await win.evaluate((x) => window.api.dispatch(x), a)
  return (await session(win)).state
}
async function until(fn, pred, what, timeout = 10_000) {
  const end = Date.now() + timeout
  let v = null
  while (Date.now() < end) {
    v = await fn()
    if (pred(v)) return v
    await sleep(100)
  }
  throw new Error(`ASSERT: ${what} (last: ${JSON.stringify(v)})`)
}
const waitState = (win, pred, what, t) =>
  until(async () => (await session(win)).state, pred, what, t)
const status = (win) => win.evaluate(() => window.api.slideshowStatus())
const waitEngine = (win, deckId, st) =>
  until(
    () => status(win),
    (s) => s.decks[deckId] === st,
    `deck ${st}`
  )

/** The HDMI window: layers (kind, canvas, img) and [r,g,b] of its centre pixel. */
const hdmi = (app) =>
  app.evaluate(async ({ BrowserWindow }, title) => {
    const w = BrowserWindow.getAllWindows().find((x) => !x.isDestroyed() && x.getTitle() === title)
    if (!w) return null
    const img = await w.webContents.capturePage()
    const { width, height } = img.getSize()
    const bmp = img.toBitmap() // BGRA
    const i = (Math.floor(height / 2) * width + Math.floor(width / 2)) * 4
    const dom = await w.webContents.executeJavaScript(
      `[...document.querySelectorAll('[data-state]')].map((l) => ({
        state: l.dataset.state, kind: l.dataset.kind || null,
        canvas: !!l.querySelector('canvas:not(.stream-still)'),
        stream: !!l.querySelector('.stream-layer, [data-source]'),
        poster: !!l.querySelector('img') }))`
    )
    return { px: [bmp[i + 2], bmp[i + 1], bmp[i]], layers: dom }
  }, HDMI_TITLE)
const near = (px, c) => px.every((v, i) => Math.abs(v - c[i]) < 40)
const waitHdmi = (app, pred, what, t = 12_000) =>
  until(
    () => hdmi(app),
    (h) => h && pred(h),
    what,
    t
  )
const top = (h) => h.layers[h.layers.length - 1]

async function main() {
  const userData = mkTmp('ppt-share-native-')
  const fx = seed(userData)
  const { app, win, errors } = await launch(userData)
  try {
    await win.evaluate((e) => window.api.selectEvent?.(e), fx.eventId).catch(() => undefined)
    await win.locator('.deck', { hasText: 'Native A' }).waitFor()
    const { ids } = fx

    // ---- HDMI output on a simulated second display
    const prim = await app.evaluate(({ screen }) => {
      const d = screen.getPrimaryDisplay()
      return { id: d.id, label: d.label, bounds: d.bounds }
    })
    const b = prim.bounds
    await app.evaluate(
      (_e, l) => globalThis.__pptHdmiFakeDisplays(l),
      [
        {
          id: prim.id,
          label: 'Display 1',
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
      ]
    )
    await win.evaluate((id) => window.api.setHdmi({ enabled: true, displayId: id }), PROBE_ID)
    await until(
      () => win.evaluate(() => window.api.getHdmiStatus()),
      (s) => s.state === 'showing',
      'HDMI showing',
      15_000
    )

    // ---- the operator position is on the first native deck: the engine opens it and the next one
    await win.locator('.deck', { hasText: 'Native A' }).click()
    // ---- the engine opens the native decks; the chips say Native · Ready
    await waitEngine(win, ids.native, 'ready')
    check(
      (await app.evaluate(() => globalThis.__pptEngine)).fake === true,
      'the FakeEngine is the slide show engine'
    )
    await win.locator('.deck', { hasText: 'Native A' }).getByText('Native · Ready').waitFor()
    check(true, 'the native deck chip says Native · Ready')

    // ---- take: native, slide 1 with 3 steps
    let st = await dispatch(win, { type: 'selectDeck', deckId: ids.native })
    check(st.shown?.playback === 'native' && st.shown.index === 0, 'take puts the native deck live')
    const take0 = st.take
    let h = await waitHdmi(app, (x) => near(x.px, RED), 'HDMI shows slide 1')
    check(near(h.px, RED), 'the output shows slide 1 (no black)')

    // ---- Next walks the steps, take changes only at the slide change
    const upNext = win.getByRole('complementary', { name: 'Up next' })
    for (const n of [1, 2, 3]) {
      await upNext.getByText(`Next: step ${n} of 3 on this slide`).waitFor({ timeout: 8000 })
      check(true, `Up next says "Next: step ${n} of 3 on this slide"`)
      st = await dispatch(win, { type: 'next' })
      await waitState(win, (s) => s.shown?.step === n, `step ${n}`)
      await win.getByText(`step ${n}/3`).first().waitFor({ timeout: 5000 })
      check(true, `the step label says step ${n}/3`)
      st = (await session(win)).state
      check(
        st.shown.index === 0 && st.take === take0,
        `step ${n}: still slide 1, take unchanged (${st.take})`
      )
    }
    check(
      (await upNext.getByText(/Next: step/).count()) === 0,
      'no step text once the steps are done'
    )
    st = await dispatch(win, { type: 'next' })
    st = await waitState(win, (s) => s.shown?.index === 1, 'next slide')
    check(
      st.shown.playback === 'native' && st.take > take0,
      'the 4th Next moves to slide 2 (new take)'
    )
    await waitHdmi(app, (x) => near(x.px, GREEN), 'HDMI shows slide 2')

    // ---- engine crash: the output shows the PNG of the same slide, never black
    await app.evaluate(() => globalThis.__pptEngine.crash(4000))
    await win.getByTestId('native-warning').waitFor({ timeout: 8000 })
    const warnText = await win.getByTestId('native-warning').textContent({ timeout: 3000 })
    check(
      warnText.includes('PowerPoint is not responding'),
      'the fallback warning appears after the engine crashed'
    )
    st = (await session(win)).state
    check(
      st.shown.playback === 'images' && st.shown.index === 1,
      'fallen back: still slides, same slide'
    )
    for (let i = 0; i < 4; i++) {
      h = await hdmi(app)
      check(near(h.px, GREEN), `after the crash the output shows the same slide's PNG (${h.px})`)
      await sleep(250)
    }
    check(
      !top(h).kind && top(h).poster === true,
      `the layer is the PNG, not a stream (${JSON.stringify(top(h))})`
    )

    // ---- the engine restarts in the background; once the slide show is open again the deck
    // goes back to native by itself (the Resume button is for a session that was already open).
    await app.evaluate(() => globalThis.__pptEngine.reopenNow())
    st = await waitState(win, (s) => s.shown?.playback === 'native', 'native again', 20_000)
    check(st.shown.index === 1, 'the slide show returns to native on the same slide')
    await win.getByTestId('native-warning').waitFor({ state: 'detached' })
    check(true, 'the fallback warning is gone once the slide show is back')
    h = await waitHdmi(app, (x) => near(x.px, GREEN), 'output after the restart')
    check(top(h).kind === 'stream', 'the output layer is the slide show stream again')
    await waitEngine(win, ids.native, 'ready')

    // ---- Edit in PowerPoint while the deck is live: the saved edit stays pending
    await win.evaluate((d) => window.api.editDeck(d), ids.native)
    const edit = path.join(fx.dir(ids.native), 'edit.pptx')
    check(fs.existsSync(edit), 'Edit in PowerPoint prepared the working copy edit.pptx')
    fs.writeFileSync(edit, 'v2 edited')
    await win.getByText('Changes apply when this deck leaves air.').waitFor({ timeout: 15_000 })
    check(true, 'a save while live shows "Changes apply when this deck leaves air."')
    check(
      fs.readFileSync(path.join(fx.dir(ids.native), 'source.pptx'), 'utf8') === 'v1',
      'the live deck still uses its old file while the edit is pending'
    )
    // The deck leaves air: the pending version is applied.
    await dispatch(win, { type: 'selectDeck', deckId: ids.native2 })
    await win
      .getByText('Changes apply when this deck leaves air.')
      .waitFor({ state: 'detached', timeout: 15_000 })
    await until(
      async () => fs.readFileSync(path.join(fx.dir(ids.native), 'source.pptx'), 'utf8'),
      (t) => t === 'v2 edited',
      'the edit is applied once the deck left air',
      15_000
    )
    check(true, 'the pending edit is applied after the deck left air')
    check(
      fs.readFileSync(path.join(fx.dir(ids.native), 'original.pptx'), 'utf8') === 'v1',
      'original.pptx is never modified'
    )
    await win.evaluate((d) => window.api.editDeckDone(d), ids.native)

    // ---- a PDF (vector) deck renders a <canvas> layer
    st = await dispatch(win, { type: 'selectDeck', deckId: ids.vector })
    check(st.shown?.playback === 'vector', 'the PDF deck goes live as vector')
    h = await waitHdmi(app, (x) => top(x).canvas === true, 'a canvas layer', 15_000)
    check(top(h).canvas && !top(h).poster, 'a vector deck renders a <canvas> layer on the output')

    // ---- a broken source.pdf falls back to that slide's PNG
    st = await dispatch(win, { type: 'selectDeck', deckId: ids.broken })
    check(st.shown?.deckId === ids.broken, 'the broken PDF deck goes live')
    h = await waitHdmi(
      app,
      (x) => top(x).poster === true && !top(x).canvas && near(x.px, RED),
      'the broken page falls back to its PNG',
      15_000
    )
    check(true, 'a broken source.pdf shows the slide PNG (not black)')
    st = await dispatch(win, { type: 'next' })
    h = await waitHdmi(app, (x) => near(x.px, GREEN) && top(x).poster === true, 'slide 2 PNG')
    check(true, 'the next page of the broken PDF also shows its PNG')

    check(errors.length === 0, `no page errors in the operator window ${JSON.stringify(errors)}`)
  } finally {
    await app.close().catch(() => undefined)
  }
}

try {
  await main()
  console.log('all native end-to-end checks passed')
} catch (e) {
  console.error(e)
  process.exitCode = 1
} finally {
  for (const d of tmpDirs) fs.rmSync(d, { recursive: true, force: true })
}
