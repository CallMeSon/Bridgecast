// Smoke test of the packaged app (dist/win-unpacked): it starts, imports a
// PDF, and imports a PPTX through PowerPoint with the script from resources/.
// Run after `npm run build:win` (or `build:unpack`): node e2e/packaged.mjs
import { _electron as electron } from 'playwright'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const exe = path.join(root, 'dist/win-unpacked/PPT Share.exe')
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'ppt-share-pkg-'))
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ppt-share-pkg-files-'))

function check(cond, msg) {
  if (!cond) throw new Error(`ASSERT: ${msg}`)
  console.log(`ok - ${msg}`)
}

check(fs.existsSync(exe), `packaged app exists: ${exe}`)
const app = await electron.launch({
  executablePath: exe,
  env: { ...process.env, PPT_SHARE_USER_DATA: userData }
})
let failed = false
try {
  const win = await app.firstWindow()
  await win.waitForSelector('.app')
  check(
    (await app.evaluate(({ app }) => app.isPackaged)) === true,
    'runs as a packaged app (app.isPackaged)'
  )

  await win.click('.event-btn')
  await win.getByRole('menuitem', { name: 'Event baru' }).click()
  await win.fill('.event-input', 'Packaged')
  await win.press('.event-input', 'Enter')
  await win.locator('.event-btn', { hasText: 'Packaged' }).waitFor()

  await win.setInputFiles('[data-testid=file-input]', path.join(root, 'fixtures/sample.pdf'))
  await win.locator('.deck .meta', { hasText: '3 slide' }).waitFor({ timeout: 60_000 })
  check(true, 'PDF imported (pdf.js worker bundled)')

  // A copy of the fixture: never a user's own PowerPoint document.
  const pptx = path.join(tmp, 'packaged-4x3.pptx')
  fs.copyFileSync(path.join(root, 'fixtures/sample-4x3.pptx'), pptx)
  await win.setInputFiles('[data-testid=file-input]', pptx)
  const ok = win.locator('.deck:not(.busy):not(.err) .name', { hasText: /^packaged-4x3$/ })
  const err = win.locator('.deck.err')
  await Promise.race([ok.waitFor({ timeout: 180_000 }), err.first().waitFor({ timeout: 180_000 })])
  if (await err.count()) {
    throw new Error(`PPTX import failed: ${await err.first().textContent()}`)
  }
  check(true, 'PPTX imported through PowerPoint with resources/scripts/export-pptx.ps1')

  await win.keyboard.press('Space')
  await win.waitForFunction(
    () => document.querySelector('[data-testid=tally]')?.textContent === 'LIVE'
  )
  check(true, 'Space takes a slide LIVE')
  check(
    (await win.getByTestId('hdmi-status').textContent()).startsWith('HDMI'),
    'header shows the HDMI status'
  )
} catch (e) {
  failed = true
  console.error(e)
} finally {
  await app.close()
  fs.rmSync(userData, { recursive: true, force: true })
  fs.rmSync(tmp, { recursive: true, force: true })
}
console.log(failed ? 'PACKAGED SMOKE FAILED' : 'PACKAGED SMOKE PASSED')
process.exit(failed ? 1 : 0)
