// Smoke test of the built app in real Electron (Playwright).
// Run: npm run test:e2e   (builds first, then launches out/main/index.js)
import { _electron as electron } from 'playwright'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'

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
const errors = []
let failed = false
try {
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
