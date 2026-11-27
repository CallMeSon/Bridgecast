// Global clicker: keys are claimed only while no Bridgecast window has focus, and a press steps the Program.
// Run: npm run test:e2e:clicker  (builds first)
import { _electron as electron } from 'playwright'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import { linuxArgs } from './launch-args.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'bridgecast-clicker-'))
let failed = 0
const check = (c, m) => {
  console.log(`${c ? 'ok' : 'FAIL'} - ${m}`)
  if (!c) failed++
}
const app = await electron.launch({
  args: [...linuxArgs, root],
  cwd: root,
  env: {
    ...process.env,
    PPT_SHARE_USER_DATA: userData,
    PPT_OUTPUT_DUMP: path.join(userData, 'dump.json'),
    PPT_OMT_FAKE: '1',
    PPT_NDI_FAKE: '1',
    PPT_SKIP_TOUR: '1',
    PPT_SKIP_HOME: '1',
    ELECTRON_RENDERER_URL: ''
  }
})
const status = () => app.evaluate(() => globalThis.__pptClicker.status())
const press = (k) => app.evaluate((_e, key) => globalThis.__pptClicker.press(key), k)
// OS focus cannot be moved reliably from a test: force what BrowserWindow.isFocused reports and
// fire the window events main listens to.
const setFocus = (on) =>
  app.evaluate(({ BrowserWindow, app: a }, f) => {
    BrowserWindow.prototype.isFocused = () => f
    a.emit(f ? 'browser-window-focus' : 'browser-window-blur', {}, BrowserWindow.getAllWindows()[0])
  }, on)
try {
  const page = await app.firstWindow()
  await page.waitForSelector('header')
  const prog = () => page.evaluate(async () => (await window.api.getSession()).state)
  const index = async () => (await prog()).shown?.index

  await page.click('.newbtn')
  await page.fill('[data-testid=new-event-name]', 'Clicker')
  await page.press('[data-testid=new-event-name]', 'Enter')
  await page.waitForSelector('.otab')
  await page.setInputFiles('[data-testid=file-input]', path.join(root, 'fixtures', 'sample.pdf'))
  await page.waitForFunction(
    () =>
      document.querySelectorAll('[data-testid=decks] .deck[data-deck-id]:not(.busy)').length >= 1,
    null,
    { timeout: 60_000 }
  )
  await page.locator('[data-testid=decks] .deck').first().click()
  await page.evaluate(() => document.activeElement?.blur())
  await page.keyboard.press('Space')
  await page.waitForFunction(
    () => document.querySelector('[data-testid=tally]')?.textContent === 'LIVE'
  )

  await setFocus(true)
  let st = await status()
  check(st.enabled && !st.active, 'focused: global keys are not claimed')
  check((await press('PageDown')) === false, 'focused: no handler to press')

  await setFocus(false)
  st = await status()
  check(
    st.enabled && (st.active || st.failed.length > 0),
    `blurred: keys are claimed or reported as failed (${JSON.stringify(st)})`
  )
  if (st.active) {
    const before = await index()
    check(await press('PageDown'), 'blurred: PageDown handler exists')
    const after = await index()
    check(after === before + 1, `PageDown advances the Program (${before} -> ${after})`)
    await press('PageUp')
    check((await index()) === before, 'PageUp goes back')
  }

  await setFocus(true)
  check(!(await status()).active, 'focus again: keys released')

  await setFocus(false)
  await page.evaluate(() => window.api.setClicker(false))
  st = await status()
  check(!st.enabled && !st.active, 'turned off: keys released while in the background')
  await page.evaluate(() => window.api.setClicker(true))
  check((await status()).enabled, 'turned on again')
} finally {
  await app.close()
}
process.exit(failed ? 1 : 0)
