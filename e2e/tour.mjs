// First-run tour in real Electron (Playwright): cards, spotlights, the keys it takes, the done
// flag across a restart, and Settings > About replay.
// Run: npm run test:e2e:tour   (builds first). No PPT_OUTPUT_DUMP here: the tour is off under it.
import { _electron as electron } from 'playwright'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import { linuxArgs } from './launch-args.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'bridgecast-tour-'))
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
const launch = async () => {
  const app = await electron.launch({
    args: [...linuxArgs, root],
    cwd: root,
    env: {
      ...process.env,
      PPT_SHARE_USER_DATA: userData,
      PPT_OMT_FAKE: '1',
      PPT_NDI_FAKE: '1',
      ELECTRON_RENDERER_URL: ''
    }
  })
  const win = await app.firstWindow()
  await win.waitForSelector('.app, [data-testid=home]', { timeout: 30000 })
  return { app, win }
}
const tour = (win) => win.locator('[data-testid=app-tour]')
const flag = (win) => win.evaluate(() => localStorage.getItem('app-tour'))

// ---- first run: the tour opens over Home
{
  const { app, win } = await launch()
  try {
    await tour(win).waitFor({ timeout: 15000 })
    check(
      await win
        .locator('#tour-title')
        .innerText()
        .then((t) => t === 'Welcome to Bridgecast'),
      'first run opens the tour on card 1'
    )
    await win.click('[data-testid=app-tour-next]')
    check(
      await win
        .locator('#tour-title')
        .innerText()
        .then((t) => t === 'Built for running the show'),
      'card 2 follows'
    )
    await win.click('[data-testid=app-tour-next]')
    await win.locator('[data-testid=app-tour-next]', { hasText: 'Get started' }).waitFor()
    await win.click('[data-testid=app-tour-next]')
    await sleep(700)
    await win
      .locator('.tour-tip #tour-tip-title', { hasText: 'Create your first event' })
      .waitFor({ timeout: 5000 })
    await win.locator('.tour-ring').waitFor({ timeout: 5000 })
    check(true, 'card 3 hands over to spotlight 1 (Home New event), with a ring on the control')
    check((await win.locator('.tour-count').innerText()) === '1 / 3', 'spotlight is numbered 1 / 3')

    // A spotlight has no Next: only Skip. It waits for a click on the highlighted control.
    check(
      (await win.locator('[data-testid=app-tour-next]').count()) === 0,
      'a spotlight has no Next button'
    )
    check(
      (await win.locator('.tour-tip button').count()) === 1,
      'a spotlight has Skip and nothing else'
    )
    await sleep(800)
    check(
      (await win.locator('.tour-tip #tour-tip-title').innerText()) === 'Create your first event',
      'a spotlight does not move on by itself'
    )

    // Clicking the highlighted New event moves on to spotlight 2 (the console is not there yet).
    await win.click('[data-testid=home-new]')
    await win
      .locator('.tour-tip #tour-tip-title', { hasText: 'Add your first deck' })
      .waitFor({ timeout: 5000 })
    check(true, 'clicking New event moves the tour to spotlight 2 (Add files)')
    await win.fill('[data-testid=new-event-name]', 'Tour Event')
    await win.press('[data-testid=new-event-name]', 'Enter')
    await win.locator('[data-testid=add-files]').waitFor({ timeout: 10000 })
    await win.locator('.tour-ring').waitFor({ timeout: 5000 })
    await sleep(800)
    check(
      (await win.locator('.tour-tip #tour-tip-title').innerText()) === 'Add your first deck',
      'creating the event alone does not move spotlight 2 on'
    )

    // Clicking the highlighted Add files moves on to spotlight 3 and opens the file chooser.
    const [chooser] = await Promise.all([
      win.waitForEvent('filechooser'),
      win.click('[data-testid=add-files]')
    ])
    await win
      .locator('.tour-tip #tour-tip-title', { hasText: 'Bring in a web page' })
      .waitFor({ timeout: 5000 })
    check(true, 'clicking Add files moves the tour to spotlight 3 (Add web page)')
    await chooser.setFiles(path.join(root, 'fixtures/sample.pdf'))
    await win.locator('.deck .meta', { hasText: '3 slides' }).waitFor({ timeout: 60000 })
    check(
      (await win.locator('.tour-ring').count()) === 1,
      'spotlight 3 rings the Web page button until its dialog opens'
    )

    // The tour owns the keys: Space must not take a slide to air.
    await win.keyboard.press('Space')
    await sleep(400)
    const screen = await win.locator('.screen').first().innerText()
    check(
      /Press Space to put slide 1 on air/.test(screen),
      'Space does nothing to the Program while the tour is open',
      screen.slice(0, 80)
    )
    check((await tour(win).count()) === 1, 'the tour is still open after Space')

    // The last step finishes when the Add web page dialog has been shown and is closed again.
    await win.click('[data-testid=add-web]')
    await win.locator('[data-testid=add-web-dialog]').waitFor({ timeout: 5000 })
    await sleep(600)
    check((await tour(win).count()) === 1, 'opening the dialog does not finish the tour')
    await win.locator('[data-testid=add-web-dialog] button', { hasText: 'Cancel' }).click()
    await tour(win).waitFor({ state: 'detached', timeout: 5000 })
    check((await flag(win)) === 'done', 'closing the Add web page dialog finishes the tour')
  } finally {
    await app.close()
  }
}

// ---- restart: the tour does not come back once it is done
{
  const { app, win } = await launch()
  try {
    await sleep(1500)
    check((await tour(win).count()) === 0, 'after a restart the tour stays closed (done)')
    // Settings > About: Show the tour again.
    await win.click('[aria-label=Settings]')
    await win.click('[data-testid=show-tour]')
    await tour(win).waitFor({ timeout: 5000 })
    check(true, 'Settings > About replays the tour')
    await win.keyboard.press('Escape')
    await tour(win).waitFor({ state: 'detached', timeout: 5000 })
    check(true, 'Escape skips the tour')
    // Skip on a spotlight ends the whole tour, not just that step.
    await win.click('[aria-label=Settings]')
    await win.click('[data-testid=show-tour]')
    await tour(win).waitFor({ timeout: 5000 })
    for (let i = 0; i < 3; i++) await win.click('[data-testid=app-tour-next]')
    await win.locator('.tour-tip').waitFor({ timeout: 5000 })
    await win.click('[data-testid=app-tour-skip]')
    await tour(win).waitFor({ state: 'detached', timeout: 5000 })
    check(true, 'Skip on a spotlight ends the whole tour')
  } finally {
    await app.close()
  }
}

console.log(`\nTOUR: ${passed} ok, ${failed} FAIL`)
if (failed) process.exit(1)
