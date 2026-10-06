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

const app = await electron.launch({
  args: [root],
  cwd: root,
  env: { ...process.env, PPT_SHARE_USER_DATA: userData, ELECTRON_RENDERER_URL: '' }
})
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
    const w = BrowserWindow.getAllWindows()[0]
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

  await win.keyboard.press('Space')
  await win.waitForFunction(
    () => document.querySelector('[data-testid=pos]')?.textContent === '2 / 3'
  )
  check((await tally.textContent()) === 'LIVE', 'Space puts the next slide LIVE')
  check((await cap.textContent()) === 'Slide 3', 'Next panel shows slide 3')
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
  await win.keyboard.press('b')
  await win.waitForFunction(
    () => document.querySelector('[data-testid=tally]')?.textContent === 'BLACK'
  )
  check(true, 'B shows BLACK')
  await win.keyboard.press('b')
  await win.keyboard.press('f')
  await win.waitForFunction(
    () => document.querySelector('[data-testid=tally]')?.textContent === 'LIVE'
  )
  check(true, 'B and F again return to LIVE')

  // Layout at 1280×720: controls fully visible above the strip.
  const ctr = await win.locator('.controls').boundingBox()
  const foot = await win.locator('footer').boundingBox()
  check(ctr && foot && ctr.y + ctr.height <= foot.y, 'controls fit above the strip at 1280×720')
  const stage = await win.locator('.stage-col').evaluate((e) => e.scrollHeight <= e.clientHeight)
  check(stage, 'stage column does not scroll at 1280×720')

  await win.screenshot({ path: shot })
  console.log(`screenshot: ${shot}`)

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
}
console.log(failed ? 'SMOKE FAILED' : 'SMOKE PASSED')
process.exit(failed ? 1 : 0)
