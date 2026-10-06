// Smoke test of the built app in real Electron (Playwright).
// Run: npm run test:e2e   (builds first, then launches out/main/index.js)
import { _electron as electron } from 'playwright'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'

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

// --- Output frame helpers (main-process debug hook, only with PPT_OUTPUT_DUMP) ---
const counters = () =>
  app.evaluate(() => {
    const d = globalThis.__pptOutput
    return { paints: d.paints, sent: d.sent, lastLength: d.lastLength, restarts: d.restarts }
  })

/** Dumps the latest output frame as PNG, decodes it with nativeImage, samples [r,g,b] at points. */
async function dumpFrame(points) {
  // Playwright occasionally reports "Resulting promise was garbage collected"
  // when a main-process GC (8 MB frames) hits during evaluate; retry that.
  for (let attempt = 1; ; attempt++) {
    try {
      return await dumpFrameOnce(points)
    } catch (e) {
      if (attempt >= 3 || !/garbage collected/.test(String(e))) throw e
    }
  }
}

const dumpFrameOnce = (points) =>
  app.evaluate(({ nativeImage }, pts) => {
    const file = globalThis.__pptOutput.dump()
    if (!file) return null
    const img = nativeImage.createFromPath(file)
    const { width, height } = img.getSize()
    const bmp = img.toBitmap() // BGRA
    const px = pts.map(([x, y]) => {
      const i = (y * width + x) * 4
      return [bmp[i + 2], bmp[i + 1], bmp[i]]
    })
    return { file, width, height, bytes: bmp.length, px }
  }, points)

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
  throw new Error(`ASSERT: ${what} (last frame ${f?.file}: ${JSON.stringify(f?.px)})`)
}

// Centre column above the "Halaman n" text (the exact centre is dark text).
const CENTRE = [W / 2, 300]
const GRID = []
for (let gx = 0; gx < 12; gx++) {
  for (let gy = 0; gy < 7; gy++) GRID.push([5 + gx * 173, 5 + gy * 178])
}
// A 4:3 slide at 1920×1080 is 1440 wide: x 240..1679.
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
/** Header NDI status + popover, settings apply/rebuild, real sender (grandi). */
async function ndiChecks(win, tally, pos) {
  const status = win.getByTestId('ndi-status')
  await win.locator('[data-testid=ndi-status][data-tone=ok]').waitFor({ timeout: 15_000 })
  check(
    (await status.textContent()) === 'NDI PPT Share · 1920×1080 · 30 fps',
    `header NDI status is green while sending: "${await status.textContent()}"`
  )
  const ndi0 = await app.evaluate(() => globalThis.__pptNdi)
  check(
    ndi0.sent > 0 && /\(PPT Share\)$/.test(ndi0.source),
    `sender is sending as "${ndi0.source}" (${ndi0.sent} frames, ${ndi0.dropped} dropped, ${(ndi0.sendMsTotal / ndi0.sent).toFixed(1)} ms avg / ${ndi0.sendMsMax.toFixed(1)} ms max per send round trip incl. main-thread latency)`
  )

  if (ndi0.slow.length)
    console.log(`  slow NDI sends (at ms since start: ms): ${JSON.stringify(ndi0.slow)}`)
  await status.click()
  const pop = win.getByTestId('ndi-popover')
  await pop.waitFor()
  check(
    (await pop.locator('.pop-status').first().textContent()).startsWith('Mengirim sebagai'),
    `popover shows the source name: "${await pop.locator('.pop-status').first().textContent()}"`
  )
  await pop.screenshot({ path: path.join(path.dirname(shot), 'task-8-popover.png') })

  // Shortcuts stay ignored while focus is inside the popover.
  const pos0 = await pos.textContent()
  const tally0 = await tally.textContent()
  const name = pop.getByLabel('Nama source')
  await name.click()
  await win.keyboard.press('End')
  await win.keyboard.type(' bf')
  await win.keyboard.press('Space')
  check(
    (await name.inputValue()) === 'PPT Share bf ' &&
      (await tally.textContent()) === tally0 &&
      (await pos.textContent()) === pos0,
    'typing B/F/Space in the name field does not trigger shortcuts'
  )
  await name.fill('PPT Share')
  const sw = pop.getByRole('switch', { name: 'Output NDI aktif' })
  await sw.focus()
  await win.keyboard.press('Space')
  check(
    (await sw.getAttribute('aria-checked')) === 'false' &&
      (await pos.textContent()) === pos0 &&
      (await tally.textContent()) === tally0,
    'Space on the popover switch toggles it and does not take the next slide'
  )
  await win.keyboard.press('Space')

  // 60 fps: Terapkan rebuilds the output window and the repeater doubles its rate.
  await pop.getByRole('radio', { name: '60 fps' }).click()
  await pop.getByRole('button', { name: 'Terapkan' }).click()
  await win
    .locator('[data-testid=ndi-status][data-tone=ok]', { hasText: '60 fps' })
    .waitFor({ timeout: 15_000 })
  const deadline = Date.now() + 10_000
  while (Date.now() < deadline) {
    const o = await app.evaluate(() => {
      const d = globalThis.__pptOutput
      return d && { fps: d.options.fps, paints: d.paints }
    })
    if (o && o.fps === 60 && o.paints > 0) break
    await sleep(100)
  }
  const c60 = await counters()
  const n60 = await app.evaluate(() => globalThis.__pptNdi)
  await sleep(2000)
  const c60b = await counters()
  const n60b = await app.evaluate(() => globalThis.__pptNdi)
  const rate = c60b.sent - c60.sent
  const ndiRate = n60b.sent - n60.sent
  check(
    rate >= 105 && rate <= 135,
    `after 60 fps apply the new output sends ${rate} frames in 2 s; NDI sent ${ndiRate}, dropped ${n60b.dropped - n60.dropped}`
  )
  check(c60b.lastLength === W * H * 4, `frames still ${W}×${H}×4 bytes after rebuild`)
  const saved = JSON.parse(fs.readFileSync(path.join(userData, 'settings.json'), 'utf8'))
  check(saved.ndi.fps === 60, 'settings.json saved with fps 60')

  // Disable: gray dot, no output window; enable again: green.
  await sw.click()
  await pop.getByRole('button', { name: 'Terapkan' }).click()
  await win.locator('[data-testid=ndi-status][data-tone=off]', { hasText: 'nonaktif' }).waitFor()
  const offscreen = await app.evaluate(
    ({ BrowserWindow }) =>
      BrowserWindow.getAllWindows().filter((w) => w.webContents.isOffscreen()).length
  )
  check(offscreen === 0, `disabled NDI: gray status and no output window (${offscreen})`)
  await sw.click()
  await pop.getByRole('radio', { name: '30 fps' }).click()
  await pop.getByRole('button', { name: 'Terapkan' }).click()
  await win
    .locator('[data-testid=ndi-status][data-tone=ok]', { hasText: '30 fps' })
    .waitFor({ timeout: 15_000 })
  check(true, 'enabled again at 30 fps: green status')

  // Name already used by another NDI sender on this PC → inline error with the fix.
  const { default: grandi } = await import('grandi')
  const other = await grandi.send({ name: 'Smoke Dup' })
  try {
    await name.fill('Smoke Dup')
    await pop.getByRole('button', { name: 'Terapkan' }).click()
    const err = pop.getByTestId('ndi-error')
    await err.waitFor({ timeout: 10_000 })
    const msg = await err.textContent()
    check(
      /sudah dipakai/.test(msg) && /ganti nama source/.test(msg),
      `name in use shows an inline error: "${msg}"`
    )
    check((await status.getAttribute('data-tone')) === 'error', 'header status turns red on error')
  } finally {
    other.destroy()
  }
  await name.fill('PPT Share')
  await pop.getByRole('button', { name: 'Terapkan' }).click()
  await win
    .locator('[data-testid=ndi-status][data-tone=ok]', { hasText: 'PPT Share' })
    .waitFor({ timeout: 15_000 })
  check(true, 'renaming back recovers (green)')
  await win.keyboard.press('Escape')
  await pop.waitFor({ state: 'detached' })
  check(true, 'Escape closes the popover')
}

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
    // Same spot as CENTRE on the NDI frame: above the slide's dark "Halaman n" text.
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

const savedHdmi = () =>
  JSON.parse(fs.readFileSync(path.join(userData, 'settings.json'), 'utf8')).hdmi

async function openOutputPopover(win) {
  const pop = win.getByTestId('ndi-popover')
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
    `header shows the HDMI indicator next to NDI: "${await win.getByTestId('output-status').textContent()}"`
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
          t.endsWith('— Layar utama (operator)')
        ),
      'display select is disabled and marks the primary as "Layar utama (operator)"'
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
  // Same Program as NDI (STANDBY here: black).
  const ndiPx = (await dumpFrame([CENTRE])).px[0]
  const hdmiPx = await waitHdmiCentre(
    (p) => Math.abs(lum(p) - lum(ndiPx)) <= 8,
    'real HDMI window shows the same as NDI'
  )
  check(
    true,
    `real HDMI window shows the same as NDI: ${JSON.stringify(hdmiPx)} vs ${JSON.stringify(ndiPx)}`
  )
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
  const fake = (list) => app.evaluate((_e, l) => globalThis.__pptHdmiFakeDisplays(l), list)

  // Something live on Program: deck "dropped", slide 1 (white).
  if (await win.getByTestId('ndi-popover').isVisible()) await win.keyboard.press('Escape')
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

    // Same Program as NDI; operator shortcuts keep working (focus never moved).
    await win.keyboard.press('Escape')
    await waitHdmiCentre((p) => lum(p) > 200, 'HDMI window shows the live slide')
    await win.keyboard.press('b')
    await win.waitForFunction(
      () => document.querySelector('[data-testid=tally]')?.textContent === 'BLACK'
    )
    await waitHdmiCentre(isBlack, 'B makes the HDMI window black')
    await waitFrame([CENTRE], (px) => isBlack(px[0]), 'B makes NDI black too')
    await win.keyboard.press('b')
    await win.waitForFunction(
      () => document.querySelector('[data-testid=tally]')?.textContent === 'LIVE'
    )
    // To slide 1 (white), then Space to slide 2 (light blue), as on NDI.
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
    check(true, 'B and Space in the operator window drive the HDMI window like NDI')

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
        'Tersembunyi — layar tidak tersambung',
      'popover says "Tersembunyi — layar tidak tersambung"'
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
  // Output windows (NDI offscreen, HDMI) are checked for console errors too.
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
    const w = BrowserWindow.getAllWindows().find((x) => !x.webContents.isOffscreen())
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

  // Output: slide 1 (white 16:9 page) fills the 1920×1080 frame.
  const f1 = await waitFrame(
    [CENTRE, [10, 10], [1910, 1070]],
    (px) => px.every((p) => lum(p) > 200),
    'output shows slide 1'
  )
  const c1 = await counters()
  check(
    c1.lastLength === W * H * 4,
    `raw output frame is ${W}×${H}×4 BGRA bytes (${c1.lastLength})`
  )
  check(f1.width === W && f1.height === H, `dumped frame is ${f1.width}×${f1.height}`)
  check(true, `16:9 slide fills the frame, centre ${JSON.stringify(f1.px[0])}`)

  // Repeater: a static slide still produces ~30 frames per second.
  await sleep(2000)
  const c2 = await counters()
  const sent = c2.sent - c1.sent
  const paints = c2.paints - c1.paints
  check(
    sent >= 50 && sent <= 70,
    `repeater sent ${sent} frames in 2 s on a static slide (paint events: ${paints})`
  )

  // Display scaling: the window is sized in DIP so frames are never resampled.
  const ps = await app.evaluate(() => globalThis.__pptOutput.paint)
  check(
    ps.mode !== 'resize',
    `no resampling: scale ${ps.scaleFactor}, window ${ps.windowDip.width}×${ps.windowDip.height} DIP, painted ${ps.painted.width}×${ps.painted.height}, mode ${ps.mode}, ${(ps.totalMs / ps.count).toFixed(1)} ms avg / ${ps.maxMs.toFixed(1)} ms max per paint (${ps.count} paints)`
  )

  await win.keyboard.press('Space')
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

  // Layout at 1280×720: controls fully visible above the strip.
  const ctr = await win.locator('.controls').boundingBox()
  const foot = await win.locator('footer').boundingBox()
  check(ctr && foot && ctr.y + ctr.height <= foot.y, 'controls fit above the strip at 1280×720')
  const stage = await win.locator('.stage-col').evaluate((e) => e.scrollHeight <= e.clientHeight)
  check(stage, 'stage column does not scroll at 1280×720')

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
    const p = await app.evaluate(() => globalThis.__pptOutput.pixel(100, 540))
    seen.push([Date.now() - t0, p[2]])
    await sleep(10)
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
  fs.copyFileSync(f43.file, path.join(path.dirname(shot), 'task-7-output-4x3.png'))
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
  await win.getByRole('button', { name: 'Ganti tema' }).click()
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

  // The hidden output window refuses to close (only app quit destroys it).
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()
      .find((w) => w.webContents.isOffscreen())
      .close()
  )
  await sleep(300)
  const alive = await app.evaluate(
    ({ BrowserWindow }) =>
      BrowserWindow.getAllWindows().filter((w) => w.webContents.isOffscreen()).length
  )
  check(alive === 1, 'output window cannot be closed')

  // Output renderer crash: the window is recreated and shows the slide again.
  const before = await counters()
  await app.evaluate(() => globalThis.__pptOutput.crash())
  const end = Date.now() + 10_000
  let after = before
  while (Date.now() < end) {
    after = await counters()
    if (after.restarts === before.restarts + 1 && after.paints > before.paints) break
    await sleep(200)
  }
  check(after.restarts === before.restarts + 1, 'output window recreated after renderer crash')
  await waitFrame([[10, 10]], (px) => blue(px[0]), 'recreated output shows slide 2')
  const outputs = await app.evaluate(
    ({ BrowserWindow }) =>
      BrowserWindow.getAllWindows().filter((w) => w.webContents.isOffscreen()).length
  )
  check(outputs === 1, `recreated output shows slide 2; single output window (${outputs})`)

  await dragAndDropChecks(win, tally, pos, cap)

  await ndiChecks(win, tally, pos)

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
