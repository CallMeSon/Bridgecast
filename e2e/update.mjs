// Auto-update in real Electron (Playwright) with the fake engine (PPT_UPDATE_FAKE=1).
// Run: npm run test:e2e:update  (builds first). Headless: xvfb-run -a -s '-screen 0 2560x1440x24' npm run test:e2e:update
import { _electron as electron } from 'playwright'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import { linuxArgs } from './launch-args.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
let passed = 0
let failed = 0
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
function check(cond, name, detail = '') {
  if (cond) {
    passed++
    console.log(`ok - ${name}`)
  } else {
    failed++
    console.log(`FAIL - ${name}${detail ? ` (${detail})` : ''}`)
  }
}

/** One launch with its own library. The fake engine offers 99.0.0 after ~15 s. */
async function launch(userData) {
  const app = await electron.launch({
    args: [...linuxArgs, root],
    cwd: root,
    env: {
      ...process.env,
      PPT_SHARE_USER_DATA: userData,
      PPT_UPDATE_FAKE: '1',
      PPT_OMT_FAKE: '1',
      PPT_NDI_FAKE: '1',
      PPT_SKIP_HOME: '1',
      PPT_SKIP_TOUR: '1',
      ELECTRON_RENDERER_URL: ''
    }
  })
  const win = await app.firstWindow()
  await win.waitForSelector('.app', { timeout: 30_000 })
  return { app, win }
}

const status = (win) => win.evaluate(() => window.api.getUpdateStatus())

// --- Announcement, key guard, download and the on-air install gate ---
{
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'bridgecast-update-live-'))
  const { app, win } = await launch(userData)
  try {
    const chip = win.getByTestId('update-chip')
    await chip.waitFor({ timeout: 20_000 })
    check((await chip.innerText()).trim() === 'Update 99.0.0', 'header chip shows Update 99.0.0')
    check(await win.getByTestId('update-banner').isVisible(), 'update popover is visible')
    const primary = win.getByTestId('update-primary')
    check((await primary.innerText()).trim() === 'Download', 'the first action is Download')

    // A real fixture deck, imported like the other suites do, so Space can move a slide.
    await win.click('.newbtn')
    await win.fill('[data-testid=new-event-name]', 'Update Event')
    await win.press('[data-testid=new-event-name]', 'Enter')
    await win.locator('[role=tab][aria-selected=true]', { hasText: 'Update Event' }).waitFor()
    await win.setInputFiles('[data-testid=file-input]', path.join(root, 'fixtures/sample.pdf'))
    await win.locator('.deck .meta', { hasText: '3 slides' }).waitFor({ timeout: 60_000 })
    await win.evaluate(() => document.activeElement?.blur())
    await win.keyboard.press('Space')
    await win.waitForFunction(
      () => document.querySelector('[data-testid=tally]')?.textContent === 'LIVE'
    )
    check((await win.getByTestId('pos').innerText()).trim() === '01 / 03', 'fixture deck is live')

    // Space on the focused Download button is Program's Next, not a click on the button.
    await primary.focus()
    check(
      await win.evaluate(() => document.activeElement?.dataset?.testid === 'update-primary'),
      'the Download button has focus'
    )
    await win.keyboard.press('Space')
    await win.waitForFunction(
      () => document.querySelector('[data-testid=pos]')?.textContent === '02 / 03',
      null,
      { timeout: 5000 }
    )
    check(true, 'Space with Download focused moves the Program to the next slide')
    check(
      (await status(win)).kind === 'available',
      'Space with Download focused does not start the download'
    )
    check((await primary.innerText()).trim() === 'Download', 'the button is still Download')

    // Download is allowed while live; install is not.
    await primary.click()
    await win.waitForFunction(
      () =>
        document.querySelector('[data-testid=update-primary]')?.textContent?.trim() ===
        'Restart and install',
      null,
      { timeout: 10_000 }
    )
    check(true, 'Download finishes and the action becomes Restart and install')
    check(await primary.isDisabled(), 'install is disabled while a slide is live')
    check(
      (await win.getByTestId('update-on-air-reason').innerText()).trim() ===
        'Something is on air. Take it off air or wait until the show ends.',
      'the popover shows the on-air reason'
    )
    check(
      (await win.evaluate(() => window.api.installUpdate())) === false,
      'installUpdate() is refused while on air'
    )
    check((await status(win)).kind === 'ready', 'the app is still running with the update ready')
  } finally {
    await app.close()
  }
}

// --- Skip this version hides the UI and survives a relaunch ---
{
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'bridgecast-update-skip-'))
  {
    const { app, win } = await launch(userData)
    try {
      await win.getByTestId('update-chip').waitFor({ timeout: 20_000 })
      await win.getByTestId('update-skip').click()
      await win.getByTestId('update-chip').waitFor({ state: 'detached' })
      await win.getByTestId('update-banner').waitFor({ state: 'detached' })
      check(true, 'Skip this version hides the chip and the popover')
      check((await status(win)).kind === 'idle', 'skipping leaves the update status idle')
    } finally {
      await app.close()
    }
  }
  {
    const { app, win } = await launch(userData)
    try {
      // Wait past the 15 s first check: the fake still offers 99.0.0, so an unskipped
      // build would announce it again here.
      await sleep(18_000)
      check(
        (await win.getByTestId('update-chip').count()) === 0,
        'no chip after relaunch (skip survived)'
      )
      check((await win.getByTestId('update-banner').count()) === 0, 'no popover after relaunch')
      check((await status(win)).kind === 'idle', 'the relaunch stays idle after its fresh check')
    } finally {
      await app.close()
    }
  }
}

console.log(`\nUPDATE: ${passed} ok, ${failed} FAIL`)
if (failed) process.exit(1)
