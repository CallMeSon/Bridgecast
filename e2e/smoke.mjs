// Smoke test of the built app in real Electron (Playwright).
// Run: npm run test:e2e   (builds first, then launches out/main/index.js)
import { _electron as electron } from 'playwright'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import { PDFDocument } from 'pdf-lib'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const shot = path.join(root, '.superpowers/sdd/2026-10-06-ppt-share/task-6-smoke.png')
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'ppt-share-e2e-'))

function check(cond, msg) {
  if (!cond) throw new Error(`ASSERT: ${msg}`)
  console.log(`ok - ${msg}`)
}

const frameDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ppt-share-frames-'))
const W = 1920
const H = 1080

const app = await electron.launch({
  args: [root],
  cwd: root,
  env: {
    ...process.env,
    PPT_SHARE_USER_DATA: userData,
    PPT_OUTPUT_DUMP: frameDir,
    ELECTRON_RENDERER_URL: ''
  }
})

// --- Program output helpers ---
// Program is read back from the HDMI output window (capturePage: its own
// compositor). The main flow shows that window on a simulated second display
// (see startProbe), so one real screen is enough. Points are given in
// 1920×1080 frame coordinates and scaled to the captured size.
let dumpSeq = 0

/** Samples [r,g,b] at points of the HDMI window; `save` also writes it as PNG. */
async function dumpFrame(points, save = false) {
  // Playwright occasionally reports "Resulting promise was garbage collected"
  // when a main-process GC hits during evaluate; retry that.
  for (let attempt = 1; ; attempt++) {
    try {
      return await dumpFrameOnce(points, save)
    } catch (e) {
      if (attempt >= 3 || !/garbage collected/.test(String(e))) throw e
    }
  }
}

async function dumpFrameOnce(points, save) {
  const f = await app.evaluate(
    async ({ BrowserWindow }, [title, pts, fw, fh, png]) => {
      const w = BrowserWindow.getAllWindows().find(
        (x) => !x.isDestroyed() && x.getTitle() === title
      )
      if (!w) return null
      const img = await w.webContents.capturePage()
      const { width, height } = img.getSize()
      if (!width || !height) return null
      const bmp = img.toBitmap() // BGRA
      const px = pts.map(([x, y]) => {
        const sx = Math.min(width - 1, Math.floor((x * width) / fw))
        const sy = Math.min(height - 1, Math.floor((y * height) / fh))
        const i = (sy * width + sx) * 4
        return [bmp[i + 2], bmp[i + 1], bmp[i]]
      })
      return { width, height, px, png: png ? img.toPNG().toString('base64') : null }
    },
    [HDMI_TITLE, points, W, H, save]
  )
  if (!f) return null
  let file = null
  if (f.png) {
    file = path.join(frameDir, `output-${++dumpSeq}.png`)
    fs.writeFileSync(file, Buffer.from(f.png, 'base64'))
  }
  return { file, width: f.width, height: f.height, px: f.px }
}

const lum = ([r, g, b]) => Math.max(r, g, b)
const isBlack = (p) => lum(p) <= 8
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
// Slide 2 of sample.pdf has a light-blue background (232,240,255); 1 and 3 are white.
const blue = (p) => p[0] < 245 && p[2] > 245

/** Polls output frames until `pred(px)` holds; returns the frame. */
async function waitFrame(points, pred, what, timeout = 5000) {
  const end = Date.now() + timeout
  let f = null
  while (Date.now() < end) {
    f = await dumpFrame(points)
    if (f && pred(f.px)) return f
    await sleep(150)
  }
  throw new Error(`ASSERT: ${what} (last frame: ${JSON.stringify(f?.px)})`)
}

/**
 * Runs in a renderer for `ms`: on every animation frame, records 1 if the
 * topmost visible slide layer has a decoded image, else 0. A 0 on any frame
 * is a black flash between two slides.
 */
function layerRecorder(sel, ms) {
  return new Promise((resolve) => {
    const frames = []
    const end = performance.now() + ms
    const tick = () => {
      // The topmost visible layer covers the rest (it has a black background).
      const top = [...document.querySelectorAll(sel)]
        .filter((l) => Number(getComputedStyle(l).opacity) > 0)
        .pop()
      const img = top?.querySelector('img')
      frames.push(img && img.complete && img.naturalWidth > 0 ? 1 : 0)
      if (performance.now() < end) requestAnimationFrame(tick)
      else resolve(frames)
    }
    requestAnimationFrame(tick)
  })
}
const recorderSrc = (sel, ms) => `(${layerRecorder.toString()})(${JSON.stringify(sel)}, ${ms})`

/** Runs `action` (one slide change) and checks Program and HDMI never show a black frame. */
async function noBlackGap(win, action, what) {
  const ms = 900
  const operator = win.evaluate(recorderSrc('.screen .pgm-layer', ms))
  const hdmi = app.evaluate(
    ({ BrowserWindow }, [title, src]) =>
      BrowserWindow.getAllWindows()
        .find((w) => w.getTitle() === title)
        .webContents.executeJavaScript(src),
    [HDMI_TITLE, recorderSrc('.output-layer', ms)]
  )
  await sleep(100)
  await action()
  const [op, out] = await Promise.all([operator, hdmi])
  check(
    op.length > 10 && op.every((n) => n >= 1) && out.length > 10 && out.every((n) => n >= 1),
    `${what}: no black frame between slides (Program ${op.length} frames, min ${Math.min(...op)}; HDMI ${out.length} frames, min ${Math.min(...out)})`
  )
}

/**
 * A PDF of full-page noise images: slow to decode, so a slide change that does
 * not wait for decoding shows a black frame (plain test pages decode in time).
 */
async function noisePdf(file, pages) {
  const pngs = await app.evaluate(({ nativeImage }, n) => {
    const w = 1920
    const h = 1080
    return Array.from({ length: n }, (_, k) => {
      const buf = Buffer.alloc(w * h * 4)
      for (let i = 0; i < buf.length; i += 4) {
        buf[i] = (Math.random() * 255) | 0
        buf[i + 1] = (Math.random() * 255) | 0
        buf[i + 2] = 120 + k * 40
        buf[i + 3] = 255
      }
      return nativeImage.createFromBitmap(buf, { width: w, height: h }).toPNG().toString('base64')
    })
  }, pages)
  const doc = await PDFDocument.create()
  for (const b64 of pngs) {
    const img = await doc.embedPng(Buffer.from(b64, 'base64'))
    doc.addPage([960, 540]).drawImage(img, { x: 0, y: 0, width: 960, height: 540 })
  }
  fs.writeFileSync(file, await doc.save())
}

/** Writes a solid-colour 16:9 PNG (the KV, KV_RGB) made in the main process, like noisePdf's pages. */
const KV_RGB = [220, 40, 160]
const isKv = (p) =>
  Math.abs(p[0] - KV_RGB[0]) < 25 &&
  Math.abs(p[1] - KV_RGB[1]) < 25 &&
  Math.abs(p[2] - KV_RGB[2]) < 25
async function kvPng(file) {
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
  fs.writeFileSync(file, Buffer.from(b64, 'base64'))
}

// Centre column above the "Halaman n" text (the exact centre is dark text).
const CENTRE = [W / 2, 300]
const GRID = []
for (let gx = 0; gx < 12; gx++) {
  for (let gy = 0; gy < 7; gy++) GRID.push([5 + gx * 173, 5 + gy * 178])
}
// A 4:3 slide in a 16:9 frame (1920×1080 coordinates) is 1440 wide: x 240..1679.
const BARS = [
  [10, 540],
  [230, 540],
  [1690, 540],
  [1910, 540]
]
const INSIDE_43 = [
  [250, 540],
  [1670, 540],
  [960, 20],
  [960, 1060]
]
// --- Drag and drop (Task 9) ---
// Playwright cannot start an OS-level drag from Explorer into Electron. The
// closest real path: real files are attached to a scratch <input type=file>
// (so they are path-backed File objects exactly like an Explorer drop, and
// webUtils.getPathForFile works), put into a DataTransfer, and dispatched as
// dragenter/dragover/drop DragEvents on the window. Reordering uses the same
// synthetic HTML5 drag events on the deck rows and thumbnails.

/** A DataTransfer holding real, path-backed files. */
async function filesTransfer(win, paths) {
  await win.evaluate(() => {
    if (document.getElementById('e2e-drop-src')) return
    const i = document.createElement('input')
    i.type = 'file'
    i.multiple = true
    i.id = 'e2e-drop-src'
    i.style.display = 'none'
    document.body.appendChild(i)
  })
  await win.setInputFiles('#e2e-drop-src', paths)
  return win.evaluateHandle(() => {
    const dt = new DataTransfer()
    for (const f of document.getElementById('e2e-drop-src').files) dt.items.add(f)
    return dt
  })
}

const fireDrag = (win, selector, type, dt) =>
  win.evaluate(
    ([sel, t, d]) =>
      document
        .querySelector(sel)
        .dispatchEvent(new DragEvent(t, { dataTransfer: d, bubbles: true, cancelable: true })),
    [selector, type, dt]
  )

/** HTML5 drag of element `from` onto element `to` (both CSS selectors). */
const dragOnto = (win, from, to) =>
  win.evaluate(
    ([f, t]) => {
      const a = document.querySelector(f)
      const b = document.querySelector(t)
      const dt = new DataTransfer()
      const fire = (el, type) =>
        el.dispatchEvent(new DragEvent(type, { dataTransfer: dt, bubbles: true, cancelable: true }))
      fire(a, 'dragstart')
      fire(b, 'dragenter')
      fire(b, 'dragover')
      fire(b, 'drop')
      fire(a, 'dragend')
    },
    [from, to]
  )

const thumbs = (win) =>
  win.$$eval('[data-testid=strip] .th', (els) =>
    els.map((e) => {
      const img = e.querySelector('img')
      return {
        file: e.dataset.file,
        role: e.dataset.role ?? null,
        src: img?.getAttribute('src'),
        loaded: !!img && img.complete && img.naturalWidth > 0
      }
    })
  )

/** Colour of a stored slide image (by deck + file) at (10,10), read in main from disk. */
const fileCorner = (deckId, file) =>
  app.evaluate(
    ({ nativeImage }, p) => {
      const img = nativeImage.createFromPath(p)
      const bmp = img.toBitmap()
      const i = (10 * img.getSize().width + 10) * 4
      return [bmp[i + 2], bmp[i + 1], bmp[i]]
    },
    path.join(userData, 'decks', deckId, file)
  )

async function dragAndDropChecks(win, tally, pos, cap) {
  const overlay = win.getByTestId('drop-overlay')
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ppt-share-drop-'))
  const pdf = path.join(tmp, 'dropped.pdf')
  const txt = path.join(tmp, 'catatan.txt')
  fs.copyFileSync(path.join(root, 'fixtures/sample.pdf'), pdf)
  fs.writeFileSync(txt, 'bukan slide')
  const dropList = [pdf, txt]
  const pptE2E = process.env.PPT_E2E === '1'
  if (pptE2E) {
    // A copy of the fixture: never a user's own PowerPoint document.
    const pptx = path.join(tmp, 'dropped-pptx.pptx')
    fs.copyFileSync(path.join(root, 'fixtures/sample-4x3.pptx'), pptx)
    dropList.unshift(pptx)
  }

  try {
    // Overlay: counter-based, only for drags carrying Files.
    const dt = await filesTransfer(win, dropList)
    const resolved = await win.evaluate(
      (d) => [...d.files].map((f) => window.api.pathForFile(f)),
      dt
    )
    check(
      JSON.stringify(resolved) === JSON.stringify(dropList),
      `dropped files are path-backed like an Explorer drop (pathForFile: ${JSON.stringify(resolved)})`
    )
    check(!(await overlay.isVisible()), 'drop overlay hidden before a drag')
    await fireDrag(win, 'main', 'dragenter', dt)
    await overlay.waitFor({ state: 'visible' })
    await fireDrag(win, '.left', 'dragenter', dt)
    await fireDrag(win, 'main', 'dragleave', dt)
    check(await overlay.isVisible(), 'overlay stays while the drag moves between elements')
    await win.screenshot({ path: path.join(path.dirname(shot), 'task-9-overlay.png') })
    await fireDrag(win, '.left', 'dragleave', dt)
    await overlay.waitFor({ state: 'hidden' })
    check(true, 'overlay appears on dragenter with files and hides when the drag leaves')
    await dragOnto(
      win,
      '[data-testid=strip] .th:nth-child(1)',
      '[data-testid=strip] .th:nth-child(1)'
    )
    check(!(await overlay.isVisible()), 'reordering drags (no files) never show the overlay')

    // Drop: PDF imported into the active event, .txt becomes a "Tidak didukung" row.
    await fireDrag(win, 'main', 'dragenter', dt)
    await fireDrag(win, 'main', 'dragover', dt)
    await fireDrag(win, 'main', 'drop', dt)
    await overlay.waitFor({ state: 'hidden' })
    const errRow = win.getByTestId('import-error').filter({ hasText: 'catatan.txt' })
    await errRow.waitFor({ timeout: 2000 })
    check(
      (await errRow.locator('.meta').textContent()) === 'Tidak didukung' &&
        /PPTX, PPT, atau PDF/.test(await errRow.locator('.msg').textContent()),
      `unsupported file shows an error row: "${await errRow.textContent()}"`
    )
    const dropped = win.locator('.deck', { has: win.locator('.name', { hasText: /^dropped$/ }) })
    await dropped.locator('.meta', { hasText: '3 slide' }).waitFor({ timeout: 60_000 })
    check(true, 'dropped PDF imported as a 3-slide deck into the active event')
    if (pptE2E) {
      const pptDeck = win.locator('.deck:not(.busy) .name', { hasText: /^dropped-pptx$/ })
      await pptDeck.waitFor({ timeout: 180_000 })
      check(true, 'dropped PPTX imported through the queue')
    }
    check((await tally.textContent()) === 'LIVE', 'dropping files does not change the output')
    await errRow.click()
    await errRow.waitFor({ state: 'detached' })
    check(true, 'clicking the error row removes it')

    // Reorder slides of the LIVE deck: move the live slide 2 (blue, 002.png) to the front.
    const sample = win.locator('.deck', { has: win.locator('.name', { hasText: /^sample$/ }) })
    const deckId = await sample.getAttribute('data-deck-id')
    check((await pos.textContent()) === '2 / 3', 'live deck "sample" on slide 2 before reordering')
    const t0 = await thumbs(win)
    check(
      t0.map((t) => t.file).join() === '001.png,002.png,003.png' && t0[1].role === 'live',
      `thumbnails before: ${JSON.stringify(t0.map((t) => [t.file, t.role]))}`
    )
    await dragOnto(
      win,
      '[data-testid=strip] .th:nth-child(2)',
      '[data-testid=strip] .th:nth-child(1)'
    )
    await win.waitForFunction(
      () => document.querySelector('[data-testid=pos]')?.textContent === '1 / 3'
    )
    // The output must keep the same slide the whole time (never another image).
    for (let i = 0; i < 8; i++) {
      const f = await dumpFrame([[10, 10]])
      check(blue(f.px[0]), `output still shows the moved live slide (frame ${i + 1}/8)`)
      await sleep(100)
    }
    await win.waitForFunction(() =>
      [...document.querySelectorAll('[data-testid=strip] .th img')].every(
        (i) => i.complete && i.naturalWidth > 0
      )
    )
    const t1 = await thumbs(win)
    check(
      t1.map((t) => t.file).join() === '002.png,001.png,003.png' &&
        t1[0].role === 'live' &&
        t1.every((t, i) => t.src === `slide://${deckId}/${t.file}` && t.loaded && i >= 0),
      `thumbnails after: ${JSON.stringify(t1.map((t) => [t.file, t.role, t.src]))}`
    )
    const colours = []
    for (const t of t1) colours.push(await fileCorner(deckId, t.file))
    check(
      blue(colours[0]) && !blue(colours[1]) && !blue(colours[2]),
      `thumbnail images are the moved slides (corner colours ${JSON.stringify(colours)})`
    )
    const programSrc = await win.locator('.screen img').getAttribute('src')
    check(
      programSrc === t1[0].src && (await tally.textContent()) === 'LIVE',
      `Program shows the same image as the live thumbnail (${programSrc})`
    )
    check(
      (await cap.textContent()) === 'Slide 2' &&
        (await win.locator('.next-card img').getAttribute('src')) === t1[1].src,
      'Next panel shows the new slide 2 (001.png)'
    )
    const saved = JSON.parse(
      fs.readFileSync(path.join(userData, 'decks', deckId, 'deck.json'), 'utf8')
    )
    check(
      saved.slides.map((s) => s.file).join() === '002.png,001.png,003.png',
      'new slide order saved in deck.json'
    )
    await win.screenshot({ path: path.join(path.dirname(shot), 'task-9-reorder.png') })

    // Navigation follows the new order: Space shows 001.png (white), ArrowLeft back to blue.
    await win.keyboard.press('Space')
    await win.waitForFunction(
      () => document.querySelector('[data-testid=pos]')?.textContent === '2 / 3'
    )
    await waitFrame([[10, 10]], (px) => !blue(px[0]) && lum(px[0]) > 200, 'Space shows 001.png')
    await win.keyboard.press('ArrowLeft')
    await waitFrame([[10, 10]], (px) => blue(px[0]), 'ArrowLeft shows 002.png again')
    check(true, 'Next/Prev follow the new slide order')

    // Moving a slide that is not live leaves the output alone.
    await dragOnto(
      win,
      '[data-testid=strip] .th:nth-child(3)',
      '[data-testid=strip] .th:nth-child(2)'
    )
    await win.waitForFunction(
      () =>
        [...document.querySelectorAll('[data-testid=strip] .th')]
          .map((e) => e.dataset.file)
          .join() === '002.png,003.png,001.png'
    )
    check(
      (await pos.textContent()) === '1 / 3' && blue((await dumpFrame([[10, 10]])).px[0]),
      'moving another slide keeps the live slide and position'
    )

    // Reorder decks: drag "dropped" (last ready deck) onto the first row.
    const names = () =>
      win.$$eval('[data-testid=decks] .deck:not(.busy):not(.err) .name', (e) =>
        e.map((x) => x.textContent)
      )
    const before = await names()
    const fromIdx = before.indexOf('dropped') + 1
    await dragOnto(
      win,
      `[data-testid=decks] > .deck:nth-child(${fromIdx})`,
      '[data-testid=decks] > .deck:nth-child(1)'
    )
    await win.waitForFunction(
      () => document.querySelector('[data-testid=decks] .deck .name')?.textContent === 'dropped'
    )
    const after = await names()
    const events = JSON.parse(fs.readFileSync(path.join(userData, 'events.json'), 'utf8'))
    check(
      after[0] === 'dropped' &&
        after.length === before.length &&
        events[0].deckIds.length === after.length,
      `decks reordered: ${JSON.stringify(before)} -> ${JSON.stringify(after)} (saved)`
    )
    check(
      (await tally.textContent()) === 'LIVE' &&
        (await pos.textContent()) === '1 / 3' &&
        blue((await dumpFrame([[10, 10]])).px[0]),
      'reordering decks does not change the output or position'
    )

    // Delete the live deck: right-click → "Hapus deck…" → inline confirmation.
    await sample.click({ button: 'right' })
    await win.getByTestId('deck-menu').getByRole('menuitem', { name: 'Hapus deck…' }).click()
    const confirm = win.getByTestId('confirm-remove')
    await confirm.waitFor()
    check(
      (await confirm.textContent()).includes('Hapus deck ini?'),
      'inline confirmation "Hapus deck ini?" (no modal)'
    )
    await confirm.screenshot({ path: path.join(path.dirname(shot), 'task-9-confirm.png') })
    await confirm.getByRole('button', { name: 'Batal' }).click()
    await sample.waitFor()
    check((await tally.textContent()) === 'LIVE', 'Batal keeps the deck and the output')
    await sample.click({ button: 'right' })
    await win.getByRole('menuitem', { name: 'Hapus deck…' }).click()
    await confirm.getByRole('button', { name: 'Hapus' }).click()
    await win.waitForFunction(
      () => document.querySelector('[data-testid=tally]')?.textContent === 'STANDBY'
    )
    await sample.waitFor({ state: 'detached' })
    check(
      (await win.locator('.screen img').count()) === 0 &&
        (await win.locator('.screen').textContent()).includes('Belum ada slide'),
      'Program shows the empty card, no image'
    )
    await waitFrame(GRID, (px) => px.every(isBlack), 'deleting the live deck blacks out the output')
    check(true, `deleting the live deck makes the output black (${GRID.length} sample points)`)
    check(
      !fs.existsSync(path.join(userData, 'decks', deckId)),
      'deleted deck folder is removed from disk'
    )
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true })
  }
}

// --- HDMI output (Task 11) ---
const NO_SECOND =
  'Layar kedua tidak terdeteksi. Sambungkan HDMI lalu atur Windows ke mode Extend (Win+P → Extend).'
const HDMI_TITLE = 'PPT Share HDMI'
const hdmiDebug = () => app.evaluate(() => globalThis.__pptHdmi)
const hdmiWindows = () =>
  app.evaluate(
    ({ BrowserWindow }, title) =>
      BrowserWindow.getAllWindows()
        .filter((w) => !w.isDestroyed() && w.getTitle() === title)
        .map((w) => ({
          bounds: w.getBounds(),
          visible: w.isVisible(),
          focusable: w.isFocusable(),
          focused: w.isFocused(),
          onTop: w.isAlwaysOnTop(),
          offscreen: w.webContents.isOffscreen(),
          url: w.webContents.getURL()
        })),
    HDMI_TITLE
  )
const sameBounds = (a, b) =>
  a && b && a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height
/**
 * The fake display is a corner of the real screen at an arbitrary DIP
 * position; at fractional scaling getBounds() reports the enclosing DIP rect
 * of the window's pixels, so it may be 1 DIP larger on each side.
 */
const nearBounds = (a, b) =>
  a &&
  b &&
  Math.abs(a.x - b.x) <= 1 &&
  Math.abs(a.y - b.y) <= 1 &&
  Math.abs(a.x + a.width - (b.x + b.width)) <= 1 &&
  Math.abs(a.y + a.height - (b.y + b.height)) <= 1

/** [r,g,b] at the top centre of the HDMI window, captured from its own compositor. */
const hdmiCentre = () =>
  app.evaluate(async ({ BrowserWindow }, title) => {
    const w = BrowserWindow.getAllWindows().find((x) => x.getTitle() === title)
    const img = await w.webContents.capturePage()
    const { width, height } = img.getSize()
    if (!width || !height) return null
    const bmp = img.toBitmap()
    // Same spot as CENTRE: above the slide's dark "Halaman n" text.
    const i = (Math.floor((height * 300) / 1080) * width + Math.floor(width / 2)) * 4
    return [bmp[i + 2], bmp[i + 1], bmp[i]]
  }, HDMI_TITLE)

async function waitHdmiCentre(pred, what, timeout = 5000) {
  const end = Date.now() + timeout
  let px = null
  while (Date.now() < end) {
    px = await hdmiCentre()
    if (px && pred(px)) return px
    await sleep(150)
  }
  throw new Error(`ASSERT: ${what} (last ${JSON.stringify(px)})`)
}

const fakeDisplays = (list) => app.evaluate((_e, l) => globalThis.__pptHdmiFakeDisplays(l), list)

/**
 * Program probe for the main flow: a simulated 1920×1080 second display (a
 * 960×540 DIP corner of the real primary screen) with HDMI on it.
 */
const PROBE_ID = 515151
async function startProbe(win) {
  const p = await app.evaluate(({ screen }) => {
    const d = screen.getPrimaryDisplay()
    return { id: d.id, label: d.label, bounds: d.bounds }
  })
  const b = p.bounds
  await fakeDisplays([
    {
      id: p.id,
      label: p.label || 'Layar 1',
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
  // Through the popover, like the operator: select the display, switch on.
  const pop = await openOutputPopover(win)
  const select = pop.getByLabel('Layar tujuan')
  await select.locator(`option[value="${PROBE_ID}"]`).waitFor({ state: 'attached' })
  await select.selectOption(String(PROBE_ID))
  await pop.getByTestId('hdmi-switch').click()
  await win.locator('[data-testid=hdmi-status][data-tone=ok]').waitFor({ timeout: 15_000 })
  await win.keyboard.press('Escape')
  await pop.waitFor({ state: 'detached' })
  check(true, 'HDMI output on a simulated second display for the Program checks')
}

/** Turns the probe off in the popover (its display id stays saved), back to the real displays. */
async function stopProbe(win) {
  const pop = await openOutputPopover(win)
  await pop.getByTestId('hdmi-switch').click()
  await win.locator('[data-testid=hdmi-status][data-tone=off]').waitFor({ timeout: 5000 })
  await win.keyboard.press('Escape')
  await fakeDisplays(null)
  check((await hdmiWindows()).length === 0, 'probe off: no HDMI window left')
}

const savedHdmi = () =>
  JSON.parse(fs.readFileSync(path.join(userData, 'settings.json'), 'utf8')).hdmi

async function openOutputPopover(win) {
  const pop = win.getByTestId('output-popover')
  if (!(await pop.isVisible())) await win.getByTestId('output-status').click()
  await pop.waitFor()
  return pop
}

/**
 * HDMI: header indicator, the popover section, validation in main, and the
 * window itself. With one real display the toggle shows the "not detected"
 * message; the window path is then driven by simulated displays (a fake
 * second display in a corner of the real screen).
 */
async function hdmiChecks(win) {
  const hStatus = win.getByTestId('hdmi-status')
  check(
    (await hStatus.textContent()) === 'HDMI mati' &&
      (await hStatus.getAttribute('data-tone')) === 'off',
    `header shows the HDMI indicator: "${await win.getByTestId('output-status').textContent()}"`
  )
  const real = await app.evaluate(({ screen }) => ({
    primary: screen.getPrimaryDisplay().id,
    all: screen.getAllDisplays().map((d) => ({ id: d.id, label: d.label, bounds: d.bounds }))
  }))
  console.log(`  displays on this machine: ${JSON.stringify(real.all)}`)

  const seen = await app.evaluate(() =>
    globalThis.__pptHdmi.displays.map(
      (d) => `${d.id} ${d.width}×${d.height} place ${JSON.stringify(d.place)}`
    )
  )
  console.log(`  HDMI sees: ${seen.join(' | ')}`)

  // Main refuses invalid input whatever the UI does.
  const reject = (h) =>
    win.evaluate(
      (x) =>
        window.api.setHdmi(x).then(
          () => 'ok',
          (e) => String(e.message)
        ),
      h
    )
  const primaryErr = await reject({ enabled: true, displayId: real.primary })
  check(
    /Layar utama \(operator\) tidak bisa dipakai/.test(primaryErr),
    `main refuses the primary display: "${primaryErr}"`
  )
  const badErr = await reject({ enabled: true, displayId: 1.5 })
  check(/tidak valid/.test(badErr), `main refuses a non-integer display id: "${badErr}"`)
  const goneErr = await reject({ enabled: true, displayId: 987654321 })
  check(/tidak tersambung/.test(goneErr), `main refuses an unknown display: "${goneErr}"`)

  const pop = await openOutputPopover(win)
  const section = pop.getByTestId('hdmi-section')
  const sw = section.getByTestId('hdmi-switch')
  const msg = section.getByTestId('hdmi-message')
  const select = section.getByLabel('Layar tujuan')

  if (real.all.length === 1) {
    console.log('  HDMI branch: single display (no second screen connected)')
    check((await msg.textContent()) === NO_SECOND, `one display: "${await msg.textContent()}"`)
    // aria-disabled (not disabled): a real click still lands, so force it like a user would.
    await sw.click({ force: true })
    await sleep(500)
    check(
      (await sw.getAttribute('aria-checked')) === 'false' &&
        (await msg.textContent()) === NO_SECOND &&
        (await hdmiWindows()).length === 0,
      'toggling HDMI with one display keeps it off, shows the message, creates no window'
    )
    check(
      (await reject({ enabled: true, displayId: null })).endsWith(`Error: ${NO_SECOND}`),
      'main refuses to enable HDMI with one display (same message)'
    )
    check(
      (await select.isDisabled()) &&
        (await select.locator('option').allTextContents()).some((t) =>
          t.endsWith('(layar utama, operator)')
        ),
      'display select is disabled and marks the primary as "(layar utama, operator)"'
    )
    await pop.screenshot({ path: path.join(path.dirname(shot), 'task-11-popover-single.png') })
  } else {
    console.log('  HDMI branch: a real second display is connected')
    await realHdmiChecks(win, pop, real)
  }

  await simulatedHdmiChecks(win, real)
}

/** Real second display: the window covers exactly its bounds and never takes focus. */
/** Win32 rects in device pixels: windows titled HDMI_TITLE (of this app) and every monitor. */
function winRects() {
  const script = `
Add-Type @"
using System; using System.Text; using System.Runtime.InteropServices;
public class PptW {
  public delegate bool EnumProc(IntPtr h, IntPtr p);
  [StructLayout(LayoutKind.Sequential)] public struct R { public int L, T, Ri, B; }
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc f, IntPtr p);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out R r);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern bool SetProcessDpiAwarenessContext(IntPtr v);
}
"@
[PptW]::SetProcessDpiAwarenessContext([IntPtr]-4) | Out-Null
$out = @()
[PptW]::EnumWindows({ param($h, $p)
  $sb = New-Object System.Text.StringBuilder 256
  [PptW]::GetWindowText($h, $sb, 256) | Out-Null
  if ($sb.ToString() -eq '${HDMI_TITLE}' -and [PptW]::IsWindowVisible($h)) {
    $r = New-Object PptW+R; [PptW]::GetWindowRect($h, [ref]$r) | Out-Null
    $script:out += "W $($r.L) $($r.T) $($r.Ri) $($r.B)"
  }
  $true }, [IntPtr]::Zero) | Out-Null
$out
Add-Type -AssemblyName System.Windows.Forms
[System.Windows.Forms.Screen]::AllScreens | % { "S $($_.Bounds.X) $($_.Bounds.Y) $($_.Bounds.Right) $($_.Bounds.Bottom)" }
`
  const lines = execFileSync('powershell', ['-NoProfile', '-Command', script])
    .toString()
    .trim()
    .split(/\r?\n/)
  const rect = (l) => {
    const [, x, y, r, b] = l.trim().split(' ').map(Number)
    return { x, y, width: r - x, height: b - y }
  }
  return {
    windows: lines.filter((l) => l.startsWith('W ')).map(rect),
    screens: lines.filter((l) => l.startsWith('S ')).map(rect)
  }
}

async function realHdmiChecks(win, pop, real) {
  const section = pop.getByTestId('hdmi-section')
  const target = real.all.find((d) => d.id !== real.primary)
  await section.getByLabel('Layar tujuan').selectOption(String(target.id))
  if ((await section.getByTestId('hdmi-switch').getAttribute('aria-checked')) !== 'true') {
    await section.getByTestId('hdmi-switch').click()
  }
  await win.locator('[data-testid=hdmi-status][data-tone=ok]').waitFor({ timeout: 15_000 })
  const [w] = await hdmiWindows()
  check(
    w && w.visible && !w.offscreen && sameBounds(w.bounds, target.bounds),
    `HDMI window covers real display ${target.id} exactly: ${JSON.stringify(w?.bounds)} vs ${JSON.stringify(target.bounds)}`
  )
  check(!w.focusable && !w.focused, 'HDMI window is not focusable and not focused')
  const shown = await section.getByLabel('Layar tujuan').locator('option:checked').textContent()
  check(
    (await section.getByTestId('hdmi-message').textContent()) === 'Tampil',
    `popover: Tampil on "${shown}"`
  )
  await pop.screenshot({ path: path.join(path.dirname(shot), 'task-11-popover-real.png') })
  // Program is STANDBY here (the live deck was deleted): black.
  const hdmiPx = await waitHdmiCentre(isBlack, 'real HDMI window shows Program (STANDBY: black)')
  check(true, `real HDMI window shows Program: ${JSON.stringify(hdmiPx)}`)
  // Real pixels: the window's Win32 rect equals the monitor's rect exactly.
  const px = winRects()
  console.log(`  Win32: ${JSON.stringify(px)}`)
  const hwndRect = px.windows[0]
  check(
    px.screens.some((r) => sameBounds(r, hwndRect)),
    `HDMI window covers a monitor pixel-exactly: window ${JSON.stringify(hwndRect)}, monitors ${JSON.stringify(px.screens)}`
  )
  await section.getByTestId('hdmi-switch').click()
  await win.locator('[data-testid=hdmi-status][data-tone=off]').waitFor({ timeout: 10_000 })
  check((await hdmiWindows()).length === 0, 'turning HDMI off destroys the window')
  await win.keyboard.press('Escape')
}

/** Window lifecycle with simulated displays (unplug, re-plug with a new id, resolution change). */
async function simulatedHdmiChecks(win, real) {
  const pos = win.getByTestId('pos')
  const primary = real.all.find((d) => d.id === real.primary)
  const fakePrimary = {
    id: primary.id,
    label: primary.label || 'Layar 1',
    width: primary.bounds.width,
    height: primary.bounds.height,
    primary: true,
    bounds: primary.bounds
  }
  // The fake display is a 480×270 corner of the real screen: off-screen
  // coordinates are not mapped like a real display (Windows DPI conversion), so
  // the window covers that corner for a few seconds instead.
  const pb = primary.bounds
  const corner = (w, h, dx = 0) => ({
    x: pb.x + pb.width - w - dx,
    y: pb.y + pb.height - h,
    width: w,
    height: h
  })
  const proj = {
    id: 424242,
    label: 'E2E PROYEKTOR',
    width: 1280,
    height: 720,
    primary: false,
    bounds: corner(480, 270)
  }
  const fake = fakeDisplays

  // Something live on Program: deck "dropped", slide 1 (white).
  if (await win.getByTestId('output-popover').isVisible()) await win.keyboard.press('Escape')
  await win.locator('.deck', { has: win.locator('.name', { hasText: /^dropped$/ }) }).click()
  await win.waitForFunction(
    () => document.querySelector('[data-testid=pos]')?.textContent === '1 / 3'
  )
  await win.keyboard.press('Space')
  await win.waitForFunction(
    () => document.querySelector('[data-testid=tally]')?.textContent === 'LIVE'
  )

  try {
    await fake([fakePrimary, proj])
    const pop = await openOutputPopover(win)
    const section = pop.getByTestId('hdmi-section')
    const select = section.getByLabel('Layar tujuan')
    await select
      .locator('option', { hasText: 'E2E PROYEKTOR · 1280×720' })
      .waitFor({ state: 'attached' })
    const options = await select.locator('option').allTextContents()
    check(
      (await section.getByTestId('hdmi-message').textContent()) === 'Mati',
      `a second display appears in the select (displays:changed): ${JSON.stringify(options)}`
    )
    if (savedHdmi()?.displayId != null) {
      // A display chosen earlier (the real one) is not connected in this simulation.
      check(
        options.includes('Layar tersimpan (tidak tersambung)') &&
          (await select.inputValue()) === String(savedHdmi().displayId),
        'the saved but missing display stays selected as "Layar tersimpan (tidak tersambung)"'
      )
      await select.selectOption(String(proj.id))
      await win.waitForFunction(() => document.querySelector('#hdmi-display')?.value)
    }
    check((await select.inputValue()) === String(proj.id), 'the simulated display is selected')
    await section.getByTestId('hdmi-switch').click()
    await win.locator('[data-testid=hdmi-status][data-tone=ok]').waitFor({ timeout: 15_000 })
    const d1 = await hdmiDebug()
    const [w1] = await hdmiWindows()
    check(
      w1 && w1.visible && !w1.offscreen && w1.onTop && w1.url.endsWith('#/output'),
      `HDMI window shown (visible, on top, renders #/output): ${JSON.stringify(w1)}`
    )
    check(
      nearBounds(w1.bounds, proj.bounds),
      `HDMI window covers the display bounds ${JSON.stringify(w1.bounds)} (display ${JSON.stringify(proj.bounds)})`
    )
    check(
      d1.plans.slice(-2).join() === 'create,show' && d1.ready,
      `shown only after output:ready (plans: ${d1.plans.join(' → ')})`
    )
    check(!w1.focusable && !w1.focused, 'HDMI window is not focusable and never focused')
    check(
      (await section.getByTestId('hdmi-message').textContent()) === 'Tampil' &&
        (await win.getByTestId('hdmi-status').textContent()) === 'HDMI tampil',
      'popover says "Tampil", header "HDMI tampil"'
    )
    check(savedHdmi().enabled && savedHdmi().displayId === proj.id, 'settings.json hdmi saved')
    await pop.screenshot({ path: path.join(path.dirname(shot), 'task-11-popover-showing.png') })
    await win.getByTestId('output-status').screenshot({
      path: path.join(path.dirname(shot), 'task-11-header.png')
    })

    // Program on HDMI; operator shortcuts keep working (focus never moved).
    await win.keyboard.press('Escape')
    await waitHdmiCentre((p) => lum(p) > 200, 'HDMI window shows the live slide')
    await win.keyboard.press('b')
    await win.waitForFunction(
      () => document.querySelector('[data-testid=tally]')?.textContent === 'BLACK'
    )
    await waitHdmiCentre(isBlack, 'B makes the HDMI window black')
    await win.keyboard.press('b')
    await win.waitForFunction(
      () => document.querySelector('[data-testid=tally]')?.textContent === 'LIVE'
    )
    // To slide 1 (white), then Space to slide 2 (light blue).
    while ((await pos.textContent()) !== '1 / 3') {
      const before = await pos.textContent()
      await win.keyboard.press('ArrowLeft')
      await win.waitForFunction(
        (b) => document.querySelector('[data-testid=pos]')?.textContent !== b,
        before
      )
    }
    await waitHdmiCentre((p) => lum(p) > 200 && !blue(p), 'ArrowLeft shows white slide 1 on HDMI')
    await win.keyboard.press('Space')
    await win.waitForFunction(
      () => document.querySelector('[data-testid=pos]')?.textContent === '2 / 3'
    )
    await waitHdmiCentre((p) => blue(p), 'Space takes slide 2 (blue) live on HDMI')
    check(true, 'B and Space in the operator window drive the HDMI window')

    // Unplug: hidden in place (not moved onto the operator screen), amber status.
    await fake([fakePrimary])
    await win.locator('[data-testid=hdmi-status][data-tone=warn]').waitFor({ timeout: 5000 })
    const [w2] = await hdmiWindows()
    check(
      w2 && !w2.visible && nearBounds(w2.bounds, proj.bounds),
      `unplugged: window hidden and not moved (${JSON.stringify(w2?.bounds)})`
    )
    const pop2 = await openOutputPopover(win)
    check(
      (await pop2.getByTestId('hdmi-message').textContent()) ===
        'Tersembunyi, layar tidak tersambung',
      'popover says "Tersembunyi, layar tidak tersambung"'
    )
    await win.keyboard.press('Escape')

    // Re-plugged with a new id (same model and size): shown again, id saved.
    const again = { ...proj, id: 424243, bounds: corner(480, 270, 100) }
    await fake([fakePrimary, again])
    await win.locator('[data-testid=hdmi-status][data-tone=ok]').waitFor({ timeout: 5000 })
    const [w3] = await hdmiWindows()
    check(
      w3.visible && nearBounds(w3.bounds, again.bounds) && savedHdmi().displayId === again.id,
      `re-plugged with a new id: shown again on its bounds, id ${savedHdmi().displayId} saved`
    )
    await waitHdmiCentre((p) => blue(p), 'after re-plug the HDMI window shows the current slide')

    // Resolution change (display-metrics-changed): bounds re-applied.
    const bigger = {
      ...again,
      width: 1920,
      height: 1080,
      bounds: corner(640, 360, 100)
    }
    await fake([fakePrimary, bigger])
    await sleep(300)
    const [w4] = await hdmiWindows()
    check(
      w4.visible && nearBounds(w4.bounds, bigger.bounds),
      `resolution change: bounds follow ${JSON.stringify(w4.bounds)}`
    )
    check(
      (await hdmiDebug()).creates === d1.creates,
      'one HDMI window through unplug, re-plug and resize (never rebuilt)'
    )

    // The window refuses to close; turning HDMI off destroys it.
    await app.evaluate(({ BrowserWindow }, t) => {
      BrowserWindow.getAllWindows()
        .find((w) => w.getTitle() === t)
        .close()
    }, HDMI_TITLE)
    await sleep(300)
    check((await hdmiWindows()).length === 1, 'HDMI window cannot be closed')
    const pop3 = await openOutputPopover(win)
    await pop3.getByTestId('hdmi-switch').click()
    await win.locator('[data-testid=hdmi-status][data-tone=off]').waitFor({ timeout: 5000 })
    check(
      (await hdmiWindows()).length === 0 && savedHdmi().enabled === false,
      'turning HDMI off destroys the window and saves enabled=false'
    )
    await win.keyboard.press('Escape')
  } finally {
    await fake(null)
  }
  check(
    (await win.getByTestId('hdmi-status').textContent()) === 'HDMI mati',
    'back to the real displays: HDMI off'
  )
}

const errors = []
let failed = false
try {
  // The HDMI output window is checked for console errors too.
  app.on('window', (page) => {
    const isOutput = () => page.url().endsWith('#/output')
    page.on('console', (m) => {
      if (isOutput() && m.type() === 'error') errors.push(`[output] ${m.text()}`)
    })
    page.on('pageerror', (e) => {
      if (isOutput()) errors.push(`[output] ${e}`)
    })
  })
  const win = await app.firstWindow()
  win.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text())
  })
  win.on('pageerror', (e) => errors.push(String(e)))
  await win.waitForSelector('.app')

  // 1280×720 window: the Program panel and controls must stay on screen.
  await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x.getTitle() !== 'PPT Share HDMI')
    w.setMinimumSize(800, 500)
    w.setContentSize(1280, 720)
  })
  await win.waitForTimeout(500)
  console.log('viewport', await win.evaluate(() => [innerWidth, innerHeight, devicePixelRatio]))

  const tally = win.getByTestId('tally')
  const pos = win.getByTestId('pos')
  const cap = win.locator('.next-card .cap')
  check((await tally.textContent()) === 'STANDBY', 'empty app shows STANDBY')
  check((await win.locator('footer').textContent()).includes('Belum ada slide'), 'empty strip')
  await startProbe(win)

  // Create an event through the event menu.
  await win.click('.event-btn')
  await win.getByRole('menuitem', { name: 'Event baru' }).click()
  await win.fill('.event-input', 'Smoke Event')
  await win.press('.event-input', 'Enter')
  await win.locator('.event-btn', { hasText: 'Smoke Event' }).waitFor()
  check(true, 'event created and selected')
  check(
    (await win.locator('.left').textContent()).includes('Belum ada deck di event ini'),
    'empty library message'
  )

  // KV (key visual) while STANDBY: no KV, KV button disabled, output black;
  // upload -> the output shows the KV by itself (tally stays STANDBY); remove
  // -> button disabled and black again.
  const kvPath = path.join(frameDir, 'kv.png')
  await kvPng(kvPath)
  const kvBtn = win.locator('.controls button', { hasText: 'KV' })
  // The image on air in the Program monitor: the newest non-pending layer (a fading
  // layer counts, the pending one is not on screen yet).
  const ON_AIR =
    '.screen .pgm-layer[data-state="shown"] img, .screen .pgm-layer[data-state="fade"] img'
  const waitOnAirSrc = async (prefix, what) => {
    await win.waitForFunction(
      ([sel, pre]) => {
        const imgs = document.querySelectorAll(sel)
        const last = imgs[imgs.length - 1]
        return !!last && (last.getAttribute('src') ?? '').startsWith(pre)
      },
      [ON_AIR, prefix],
      { timeout: 10_000 }
    )
    check(true, what)
    return win.locator(ON_AIR).last().getAttribute('src')
  }
  const kvHapus = () => win.getByTestId('kv-block').getByRole('button', { name: 'Hapus' })
  check(await kvBtn.isDisabled(), 'no KV: the KV button is disabled')
  check(
    (await win.getByTestId('kv-block').textContent()).includes('Belum ada KV'),
    'no KV: the library shows "Belum ada KV"'
  )
  await win.setInputFiles('[data-testid=kv-input]', kvPath)
  await win.locator('[data-testid=kv-thumb] img').waitFor({ timeout: 10_000 })
  await waitFrame(GRID, (px) => px.every(isKv), 'STANDBY shows the KV on the output')
  check(true, `STANDBY with a KV: the output shows the KV colour (${GRID.length} sample points)`)
  check((await tally.textContent()) === 'STANDBY', 'automatic KV keeps the STANDBY tally')
  check(!(await kvBtn.isDisabled()), 'with a KV: the KV button is enabled')
  await waitOnAirSrc('slide://kv/', 'Program monitor shows the KV at STANDBY too')
  // The automatic KV is on air: it cannot be removed, and the hint says why.
  check(await kvHapus().isDisabled(), 'KV on air at STANDBY: Hapus is disabled')
  check(
    (await win.getByTestId('kv-hint').textContent()).includes('Matikan KV dulu'),
    'KV on air: the hint says to turn KV off first'
  )
  // K at STANDBY with a KV: the output really leaves the KV (black, tally BLACK); K again brings it back.
  const tallyNow = async (t) =>
    win.waitForFunction((x) => document.querySelector('[data-testid=tally]')?.textContent === x, t)
  await win.keyboard.press('k')
  await tallyNow('BLACK')
  await waitFrame(GRID, (px) => px.every(isBlack), 'K at STANDBY makes the output black')
  check(
    (await kvBtn.getAttribute('aria-pressed')) === 'false',
    'K at STANDBY: KV button not pressed'
  )
  await win.keyboard.press('k')
  await tallyNow('KV')
  await waitFrame(GRID, (px) => px.every(isKv), 'K again brings the KV back at STANDBY')
  check((await kvBtn.getAttribute('aria-pressed')) === 'true', 'KV back: KV button pressed')
  await win.keyboard.press('k')
  await tallyNow('BLACK')
  check(!(await kvHapus().isDisabled()), 'KV off: Hapus is enabled again')
  check((await win.getByTestId('kv-hint').count()) === 0, 'KV off: no hint')
  await kvHapus().click()
  await kvBtn.waitFor()
  await win.waitForFunction(
    () =>
      [...document.querySelectorAll('.controls button')].find((b) => b.textContent.includes('KV'))
        ?.disabled
  )
  await waitFrame(GRID, (px) => px.every(isBlack), 'removing the KV makes STANDBY black again')
  check(true, 'KV removed: button disabled and STANDBY black again')
  // Clear the Black left over from turning the KV off with K, so the next slide shows.
  await win.keyboard.press('b')
  await win.waitForFunction(
    () =>
      [...document.querySelectorAll('.controls button')]
        .find((b) => b.textContent.includes('Black'))
        ?.getAttribute('aria-pressed') === 'false'
  )
  await win.setInputFiles('[data-testid=kv-input]', path.join(root, 'fixtures/sample.pdf'))
  await win.getByTestId('kv-error').waitFor()
  check(
    (await win.getByTestId('kv-error').textContent()).includes('Format KV tidak didukung'),
    'a non-image KV is refused with an inline error'
  )

  // Import the PDF through the Library footer's file input (pdf.js in the renderer).
  await win.setInputFiles('[data-testid=file-input]', path.join(root, 'fixtures/sample.pdf'))
  await win
    .locator('.deck .meta', { hasText: '3 slide' })
    .waitFor({ timeout: 60_000 })
    .catch(async (e) => {
      console.error('library:', await win.locator('.left').textContent())
      throw e
    })
  check(true, 'PDF imported as a 3-slide deck')
  check((await pos.textContent()) === '1 / 3', 'position on slide 1 after import')
  check((await tally.textContent()) === 'STANDBY', 'import does not change the output')
  check(
    (await cap.textContent()) === 'Slide 1',
    'STANDBY: Next panel shows slide 1 (what Next takes)'
  )

  // First Space from STANDBY takes slide 1 live (no skip).
  await win.keyboard.press('Space')
  await win.waitForFunction(
    () => document.querySelector('[data-testid=tally]')?.textContent === 'LIVE'
  )
  check((await pos.textContent()) === '1 / 3', 'first Space takes slide 1 LIVE')
  check((await cap.textContent()) === 'Slide 2', 'Next panel then shows slide 2')

  // Output: slide 1 (white 16:9 page) fills the 16:9 HDMI window.
  const f1 = await waitFrame(
    [CENTRE, [10, 10], [1910, 1070]],
    (px) => px.every((p) => lum(p) > 200),
    'output shows slide 1'
  )
  check(
    true,
    `16:9 slide fills the HDMI window (${f1.width}×${f1.height} px), centre ${JSON.stringify(f1.px[0])}`
  )

  await noBlackGap(win, () => win.keyboard.press('Space'), 'Next with Cut')
  await win.waitForFunction(
    () => document.querySelector('[data-testid=pos]')?.textContent === '2 / 3'
  )
  check((await tally.textContent()) === 'LIVE', 'Space puts the next slide LIVE')
  check((await cap.textContent()) === 'Slide 3', 'Next panel shows slide 3')
  await waitFrame([[10, 10]], (px) => blue(px[0]), 'output follows to slide 2')
  check(true, 'output follows Space to slide 2')
  const img = win.locator('.screen img')
  await img.waitFor()
  await win.waitForFunction(() => {
    const i = document.querySelector('.screen img')
    return i && i.complete && i.naturalWidth > 0
  })
  const natural = await img.evaluate((i) => [i.naturalWidth, i.naturalHeight])
  check(
    natural[0] === 1920 && natural[1] === 1080,
    `slide:// image loads at 1920×1080 (${natural})`
  )

  await win.keyboard.press('ArrowRight')
  await win.waitForFunction(
    () => document.querySelector('[data-testid=pos]')?.textContent === '3 / 3'
  )
  check((await cap.textContent()) === 'Tidak ada deck berikutnya', 'end of deck in Next panel')
  await win.keyboard.press('ArrowLeft')
  await win.waitForFunction(
    () => document.querySelector('[data-testid=pos]')?.textContent === '2 / 3'
  )
  check(true, 'ArrowLeft goes back')

  await win.keyboard.press('f')
  await win.waitForFunction(
    () => document.querySelector('[data-testid=tally]')?.textContent === 'FROZEN'
  )
  check(true, 'F shows FROZEN')
  await waitFrame([[10, 10]], (px) => blue(px[0]), 'frozen output still slide 2')
  await win.keyboard.press('Space')
  await win.waitForFunction(
    () => document.querySelector('[data-testid=pos]')?.textContent === '3 / 3'
  )
  await sleep(800)
  const fz = await dumpFrame([[10, 10]])
  check(blue(fz.px[0]), `F then Space keeps the old frame (corner ${JSON.stringify(fz.px[0])})`)
  // Frozen, the right panel previews the position slide (what Unfreeze takes live).
  check((await cap.textContent()) === 'Slide 3', 'frozen: Next panel previews the position slide')
  check(
    (await win.getByTestId('next-pos').textContent()) === '3 / 3',
    'frozen: Next panel shows the position'
  )
  check(
    (await win.locator('aside.right .colhead h2').textContent()) === 'Tayang saat Unfreeze',
    'frozen: Next panel titled Tayang saat Unfreeze'
  )
  // Unfreeze puts the position slide (3, white) live at once.
  await win.keyboard.press('f')
  await win.waitForFunction(
    () => document.querySelector('[data-testid=tally]')?.textContent === 'LIVE'
  )
  await waitFrame([[10, 10]], (px) => !blue(px[0]), 'unfreeze puts slide 3 on the output')
  check(true, 'unfreeze takes the position slide live (output left slide 2, tally LIVE)')
  check(
    (await win.locator('aside.right .colhead h2').textContent()) === 'Slide berikutnya',
    'unfrozen: Next panel title is back'
  )
  await win.keyboard.press('f')
  await win.waitForFunction(
    () => document.querySelector('[data-testid=tally]')?.textContent === 'FROZEN'
  )
  await win.keyboard.press('ArrowLeft')
  await win.waitForFunction(
    () => document.querySelector('[data-testid=pos]')?.textContent === '2 / 3'
  )
  await win.keyboard.press('b')
  await win.waitForFunction(
    () => document.querySelector('[data-testid=tally]')?.textContent === 'BLACK'
  )
  check(true, 'B shows BLACK')
  await waitFrame(GRID, (px) => px.every(isBlack), 'B makes the output frame fully black')
  check(true, `B makes the output fully black (${GRID.length} sample points)`)
  await win.keyboard.press('b')
  await win.keyboard.press('f')
  await win.waitForFunction(
    () => document.querySelector('[data-testid=tally]')?.textContent === 'LIVE'
  )
  check(true, 'B and F again return to LIVE')
  await waitFrame([[10, 10]], (px) => blue(px[0]), 'output returns to slide 2 after B off')
  check(true, 'output shows slide 2 again after B off')

  // KV while a slide is LIVE (slide 2): K -> KV on the output and tally KV; B ->
  // black and KV off; K, K -> KV on and off again, back to the slide.
  await win.setInputFiles('[data-testid=kv-input]', kvPath)
  await win.locator('[data-testid=kv-thumb] img').waitFor({ timeout: 10_000 })
  check((await tally.textContent()) === 'LIVE', 'uploading a KV does not disturb LIVE')
  await waitFrame([[10, 10]], (px) => blue(px[0]), 'output still shows slide 2 after the KV upload')
  const tallyIs = (t) =>
    win.waitForFunction((x) => document.querySelector('[data-testid=tally]')?.textContent === x, t)
  const kvOn = () => kvBtn.getAttribute('aria-pressed')
  await win.keyboard.press('k')
  await tallyIs('KV')
  await waitFrame(GRID, (px) => px.every(isKv), 'K puts the KV on the output')
  check((await kvOn()) === 'true', 'K: KV button pressed')
  await waitOnAirSrc('slide://kv/', 'Program monitor shows exactly the KV on air')
  await win.keyboard.press('b')
  await tallyIs('BLACK')
  await waitFrame(GRID, (px) => px.every(isBlack), 'B over the KV makes the output black')
  check((await kvOn()) === 'false', 'B turns KV off')
  await win.keyboard.press('k')
  await tallyIs('KV')
  await waitFrame(GRID, (px) => px.every(isKv), 'K after B shows the KV again')
  check(
    (await win.locator('.controls button', { hasText: 'Black' }).getAttribute('aria-pressed')) ===
      'false',
    'K turns Black off'
  )
  await win.keyboard.press('k')
  await tallyIs('LIVE')
  await waitFrame([[10, 10]], (px) => blue(px[0]), 'K again returns to slide 2')
  check(true, 'K, B, K, K: KV and Black take turns and the slide comes back')
  // Switching event while the KV is forced on keeps the same KV image on the output.
  await win.keyboard.press('k')
  await tallyIs('KV')
  const kvSrc = await waitOnAirSrc('slide://kv/', 'forced KV on air before the event switch')
  await win.click('.event-btn')
  await win.getByRole('menuitem', { name: 'Event baru' }).click()
  await win.fill('.event-input', 'Event KV')
  await win.press('.event-input', 'Enter')
  await win.locator('.event-btn', { hasText: 'Event KV' }).waitFor()
  await tallyIs('KV')
  await waitFrame(GRID, (px) => px.every(isKv), 'switching event keeps the KV on the output')
  check(
    (await waitOnAirSrc(kvSrc, 'same KV image on air after the event switch')) === kvSrc,
    'the KV image on air is unchanged by the event switch'
  )
  await win.click('.event-btn')
  await win.getByRole('menuitem', { name: 'Smoke Event' }).click()
  await win.locator('.event-btn', { hasText: 'Smoke Event' }).waitFor()
  await tallyIs('KV')
  // A KV on air cannot be removed: Hapus is disabled with a hint; turn KV off first.
  check(await kvHapus().isDisabled(), 'KV on air while LIVE: Hapus is disabled')
  check((await win.getByTestId('kv-hint').count()) === 1, 'KV on air while LIVE: hint shown')
  await win.keyboard.press('k')
  await tallyIs('LIVE')
  await kvHapus().click()
  await tallyIs('LIVE')
  await waitFrame([[10, 10]], (px) => blue(px[0]), 'removing the KV on air returns to slide 2')
  check(await kvBtn.isDisabled(), 'KV removed on air: KV button disabled, slide back on the output')

  // Layout at 1280×720: controls fully visible above the strip.
  const ctr = await win.locator('.controls').boundingBox()
  const foot = await win.locator('footer').boundingBox()
  check(ctr && foot && ctr.y + ctr.height <= foot.y, 'controls fit above the strip at 1280×720')
  const stage = await win.locator('.stage-col').evaluate((e) => e.scrollHeight <= e.clientHeight)
  check(stage, 'stage column does not scroll at 1280×720')

  // Resizable panels: drag, double-click reset, persistence, keyboard.
  const widths = () =>
    win.evaluate(() => ({
      left: document.querySelector('.left').getBoundingClientRect().width,
      stage: document.querySelector('.stage-col').getBoundingClientRect().width
    }))
  const w0 = await widths()
  const grip = await win.getByTestId('splitter-left').boundingBox()
  const gx = grip.x + grip.width / 2
  const gy = grip.y + grip.height / 2
  await win.mouse.move(gx, gy)
  await win.mouse.down()
  await win.mouse.move(gx + 80, gy, { steps: 5 })
  await win.mouse.up()
  const w1 = await widths()
  check(
    Math.abs(w1.left - (w0.left + 80)) <= 2 && w1.stage < w0.stage,
    'dragging the deck splitter widens Library and narrows Program'
  )
  await win.reload()
  await win.waitForSelector('.app')
  check(Math.abs((await widths()).left - w1.left) <= 1, 'panel width is restored after reload')
  // Narrowest Program column: every control stays visible (two rows), no sideways scroll.
  const g2 = await win.getByTestId('splitter-left').boundingBox()
  await win.mouse.move(g2.x + g2.width / 2, g2.y + g2.height / 2)
  await win.mouse.down()
  await win.mouse.move(g2.x + 900, g2.y + g2.height / 2, { steps: 5 })
  await win.mouse.up()
  const narrow = await win.evaluate(() => {
    const stage = document.querySelector('.stage-col')
    const box = stage.getBoundingClientRect()
    const btns = [...document.querySelectorAll('.controls button')].map((b) =>
      b.getBoundingClientRect()
    )
    return {
      width: box.width,
      sideways: stage.scrollWidth > stage.clientWidth,
      inside: btns.every((r) => r.left >= box.left - 1 && r.right <= box.right + 1)
    }
  })
  check(
    !narrow.sideways && narrow.inside,
    `narrow Program (${Math.round(narrow.width)}px): all controls visible, no sideways scroll`
  )
  await win.getByTestId('splitter-left').dblclick()
  check(Math.abs((await widths()).left - w0.left) <= 1, 'double-click resets the splitter')
  const posBefore = await pos.textContent()
  await win.getByTestId('splitter-strip').focus()
  await win.keyboard.press('ArrowUp')
  const sh = await win.evaluate(
    () => document.querySelector('footer').getBoundingClientRect().height
  )
  check(
    Math.abs(sh - 144) <= 1 && (await pos.textContent()) === posBefore,
    `ArrowUp on the strip splitter resizes it without changing slides (strip ${sh}px)`
  )
  await win.getByTestId('splitter-strip').dblclick()
  await win.locator('.stage-col').click({ position: { x: 5, y: 5 } })

  await win.screenshot({ path: shot })
  console.log(`screenshot: ${shot}`)

  // 4:3 deck (PDF, no PowerPoint needed): letterboxed with black bars, taken with a Fade.
  await win.setInputFiles('[data-testid=file-input]', path.join(root, 'fixtures/sample-4x3.pdf'))
  const deck43 = win.locator('.deck', { has: win.locator('.name', { hasText: 'sample-4x3' }) })
  await deck43.locator('.meta', { hasText: '2 slide' }).waitFor({ timeout: 60_000 })
  check(true, '4:3 PDF imported')
  await win.getByRole('radio', { name: 'Fade' }).click()
  await win.waitForFunction(
    () => document.querySelector('[role=radio][aria-checked=true]')?.textContent === 'Fade'
  )
  // Sample where the left bar will be while the fade runs: blue slide 2 → black.
  const t0 = Date.now()
  await deck43.click()
  const seen = []
  while (Date.now() - t0 < 1000) {
    const f = await dumpFrame([[100, 540]])
    if (f) seen.push([Date.now() - t0, f.px[0][0]])
  }
  const mid = seen.filter(([, r]) => r > 20 && r < 215)
  check(
    mid.length > 0,
    `Fade shows intermediate frames (${mid.length} of ${seen.length} samples mid-way: ${JSON.stringify(mid.slice(0, 6))})`
  )
  const f43 = await waitFrame(
    [...BARS, ...INSIDE_43, CENTRE],
    (px) =>
      BARS.every((_, i) => isBlack(px[i])) && px.slice(BARS.length).every((p) => lum(p) > 200),
    '4:3 slide letterboxed'
  )
  check(
    true,
    `4:3 slide: black bars ${JSON.stringify(f43.px.slice(0, 4))}, content ${JSON.stringify(f43.px.slice(4))}`
  )
  const saved43 = await dumpFrame([CENTRE], true)
  fs.copyFileSync(saved43.file, path.join(path.dirname(shot), 'task-7-output-4x3.png'))
  await noBlackGap(win, () => win.keyboard.press('Space'), 'Next with Fade')
  await win.getByRole('radio', { name: 'Cut' }).click()
  // Back to the 16:9 deck at slide 2 for the remaining steps.
  await win.locator('.deck', { has: win.locator('.name', { hasText: /^sample$/ }) }).click()
  await win.waitForFunction(
    () => document.querySelector('[data-testid=pos]')?.textContent === '1 / 3'
  )
  await win.keyboard.press('Space')
  await win.waitForFunction(
    () => document.querySelector('[data-testid=pos]')?.textContent === '2 / 3'
  )

  // Auto advance (default off): a clicker cannot run into the next deck.
  const waitPos = (p) =>
    win.waitForFunction((x) => document.querySelector('[data-testid=pos]')?.textContent === x, p)
  const autoSw = win.getByTestId('auto-advance')
  const nextBtn = win.locator('.cbtn.next')
  const savedAuto = () =>
    JSON.parse(fs.readFileSync(path.join(userData, 'settings.json'), 'utf8')).autoAdvance
  check((await autoSw.getAttribute('aria-checked')) === 'false', 'auto advance is off by default')
  await win.keyboard.press('PageDown') // clicker Next
  await waitPos('3 / 3')
  check(
    (await cap.textContent()) === 'Next berhenti di sini. Pilih sample-4x3 untuk lanjut.' &&
      (await nextBtn.isDisabled()),
    `off: end of deck says Next stops, Next disabled ("${await cap.textContent()}")`
  )
  await win.keyboard.press('PageDown')
  await win.keyboard.press('Space')
  await sleep(300)
  check(
    (await pos.textContent()) === '3 / 3' &&
      (await win.locator('.deck.live .name').textContent()) === 'sample',
    'off: PageDown and Space on the last slide stay in the live deck'
  )
  await autoSw.click()
  await win.locator('[data-testid=auto-advance][aria-checked=true]').waitFor()
  check(
    (await cap.textContent()) === 'Berikutnya: sample-4x3' && !(await nextBtn.isDisabled()),
    'on: Next panel names the next deck, Next enabled'
  )
  await win.keyboard.press('PageDown')
  await waitPos('1 / 2')
  check(true, 'on: PageDown on the last slide goes on to the next deck')
  await win.keyboard.press('PageUp')
  await waitPos('3 / 3')
  check(true, 'on: PageUp on the first slide goes back to the previous deck')
  check(savedAuto() === true, 'auto advance saved in settings.json')
  await autoSw.click()
  await win.locator('[data-testid=auto-advance][aria-checked=false]').waitFor()
  check(savedAuto() === false, 'turning it off is saved too')
  await win.keyboard.press('PageUp')
  await waitPos('2 / 3')

  // Optional: PPTX through PowerPoint COM (needs PowerPoint installed).
  if (process.env.PPT_E2E === '1') {
    await win.setInputFiles('[data-testid=file-input]', path.join(root, 'fixtures/sample-4x3.pptx'))
    await win.locator('.deck.busy .meta', { hasText: 'Mengonversi' }).waitFor()
    check(true, 'PPTX row shows Mengonversi')
    await win
      .locator('.deck .name', { hasText: 'sample-4x3' })
      .and(win.locator('.deck:not(.busy) .name'))
      .waitFor({ timeout: 180_000 })
    check((await win.locator('.deck.err').count()) === 0, 'PPTX imported without error')
    check((await tally.textContent()) === 'LIVE', 'PPTX import does not change the output')
  }

  // Switching to a new (empty) event keeps the output as it is.
  await win.click('.event-btn')
  await win.getByRole('menuitem', { name: 'Event baru' }).click()
  await win.fill('.event-input', 'Event Kedua')
  await win.press('.event-input', 'Enter')
  await win.locator('.event-btn', { hasText: 'Event Kedua' }).waitFor()
  await win.locator('.empty-lib').waitFor()
  check((await tally.textContent()) === 'LIVE', 'output stays LIVE after switching event')
  await win.click('.event-btn')
  await win.getByRole('menuitem', { name: 'Smoke Event' }).click()
  await win.waitForFunction(
    () => document.querySelector('[data-testid=pos]')?.textContent === '2 / 3'
  )
  check(true, 'switching back restores the position')

  // Theme toggle persists across reloads.
  await win.getByRole('button', { name: 'Tema terang' }).click()
  check(
    (await win.evaluate(() => document.documentElement.dataset.theme)) === 'light',
    'theme toggles to light'
  )
  await win.reload()
  await win.waitForSelector('.app')
  check(
    (await win.evaluate(() => document.documentElement.dataset.theme)) === 'light',
    'theme persists after reload'
  )

  // HDMI renderer crash: the window is rebuilt and shows the slide again.
  const before = (await hdmiDebug()).creates
  await app.evaluate(
    ({ BrowserWindow }, t) =>
      BrowserWindow.getAllWindows()
        .find((w) => w.getTitle() === t)
        .webContents.forcefullyCrashRenderer(),
    HDMI_TITLE
  )
  const end = Date.now() + 10_000
  let after = await hdmiDebug()
  while (Date.now() < end) {
    after = await hdmiDebug()
    if (after.creates === before + 1 && after.visible && after.ready) break
    await sleep(200)
  }
  check(
    after.creates === before + 1 && after.visible,
    `HDMI window rebuilt after a renderer crash (creates ${before} -> ${after.creates})`
  )
  await waitFrame([[10, 10]], (px) => blue(px[0]), 'rebuilt HDMI window shows slide 2')
  const outputs = (await hdmiWindows()).length
  check(outputs === 1, `rebuilt output shows slide 2; single HDMI window (${outputs})`)

  await dragAndDropChecks(win, tally, pos, cap)

  // Heavy slides: Next never shows a black frame on Program or HDMI, Cut or Fade.
  const noise = path.join(frameDir, 'noise.pdf')
  await noisePdf(noise, 4)
  await win.setInputFiles('[data-testid=file-input]', noise)
  const noiseDeck = win.locator('.deck', { has: win.locator('.name', { hasText: /^noise$/ }) })
  await noiseDeck.locator('.meta', { hasText: '4 slide' }).waitFor({ timeout: 120_000 })
  await noiseDeck.click()
  // From STANDBY the first Next takes slide 1 live.
  if ((await tally.textContent()) !== 'LIVE') await win.keyboard.press('Space')
  await win.waitForFunction(() =>
    document.querySelector('[data-testid=tally]')?.textContent?.includes('LIVE')
  )
  await sleep(800)
  await noBlackGap(win, () => win.keyboard.press('Space'), 'heavy slides, Next with Cut')
  await win.getByRole('radio', { name: 'Fade' }).click()
  await noBlackGap(win, () => win.keyboard.press('Space'), 'heavy slides, Next with Fade')
  await win.getByRole('radio', { name: 'Cut' }).click()

  // Rename a deck: right-click > Ganti nama, F2, Escape cancels, empty is refused.
  const noiseId = await noiseDeck.getAttribute('data-deck-id')
  await noiseDeck.click({ button: 'right' })
  await win
    .getByTestId('deck-menu')
    .getByRole('menuitem', { name: /Ganti nama/ })
    .click()
  const renameInput = win.getByTestId('rename-deck').locator('input')
  await renameInput.fill('Sesi 1 - Pengenalan materi')
  await renameInput.press('Enter')
  const renamed = win.locator('.deck', {
    has: win.locator('.name', { hasText: /^Sesi 1 - Pengenalan materi$/ })
  })
  await renamed.waitFor()
  const savedDeck = JSON.parse(
    fs.readFileSync(path.join(userData, 'decks', noiseId, 'deck.json'), 'utf8')
  )
  check(
    savedDeck.name === 'Sesi 1 - Pengenalan materi' && savedDeck.slides.length === 4,
    'rename from the deck menu saves the new name, slides untouched'
  )
  await renamed.focus()
  await win.keyboard.press('F2')
  await renameInput.fill('Tidak jadi')
  await renameInput.press('Escape')
  await renamed.waitFor()
  check((await win.getByTestId('rename-deck').count()) === 0, 'F2 opens rename, Escape cancels it')
  await renamed.focus()
  await win.keyboard.press('F2')
  await renameInput.fill('   ')
  await renameInput.press('Enter')
  const renameErr = win.getByTestId('rename-deck').getByRole('alert')
  await renameErr.waitFor()
  check(/kosong/.test(await renameErr.textContent()), 'an empty name is refused with a message')
  await renameInput.press('Escape')
  await renamed.waitFor()

  await stopProbe(win)

  await hdmiChecks(win)

  const relevant = errors.filter((e) => !/Electron Security Warning/.test(e))
  check(
    relevant.length === 0,
    `no console errors${relevant.length ? ': ' + relevant.join(' | ') : ''}`
  )
} catch (e) {
  failed = true
  console.error(e)
  if (errors.length) console.error('console errors:', errors)
} finally {
  await app.close()
  fs.rmSync(userData, { recursive: true, force: true })
  if (failed) console.error(`output frames kept in ${frameDir}`)
  else fs.rmSync(frameDir, { recursive: true, force: true })
}
console.log(failed ? 'SMOKE FAILED' : 'SMOKE PASSED')
process.exit(failed ? 1 : 0)
