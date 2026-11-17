// Start on Home only, the Home button, and "New event" with decks (files and a folder).
// Run: npm run test:e2e:new-event  (builds first). Headless: xvfb-run -a -s '-screen 0 2560x1440x24' npm run test:e2e:new-event
import { _electron as electron } from 'playwright'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import { linuxArgs } from './launch-args.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
let passed = 0
let failed = 0
function check(cond, name, detail = '') {
  if (cond) {
    passed++
    console.log(`ok - ${name}`)
  } else {
    failed++
    console.log(`FAIL - ${name}${detail ? ` (${detail})` : ''}`)
  }
}

/** A normal start (no PPT_SKIP_HOME): the operator window opens on Home. */
async function launch(userData) {
  const app = await electron.launch({
    args: [...linuxArgs, root],
    cwd: root,
    env: {
      ...process.env,
      PPT_SHARE_USER_DATA: userData,
      PPT_OUTPUT_DUMP: path.join(userData, 'dump.json'),
      PPT_OMT_FAKE: '1',
      PPT_NDI_FAKE: '1',
      PPT_SKIP_HOME: '',
      ELECTRON_RENDERER_URL: ''
    }
  })
  const win = await app.firstWindow()
  await win.waitForSelector('.app', { timeout: 30_000 })
  return { app, win }
}

const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'bridgecast-new-event-'))
const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'bridgecast-decks-'))
const sample = path.join(root, 'fixtures/sample.pdf')
fs.copyFileSync(sample, path.join(folder, '10 Closing.pdf'))
fs.copyFileSync(sample, path.join(folder, '2 Opening.pdf'))
fs.writeFileSync(path.join(folder, 'notes.txt'), 'not a deck')

{
  const { app, win } = await launch(userData)
  try {
    await win.locator('.home').waitFor()
    check(true, 'a fresh install opens on Home')
    check((await win.locator('.otab').count()) === 0, 'no event tab is open at start')
    const home = win.getByTestId('home-btn')
    check((await home.getAttribute('aria-pressed')) === 'true', 'the Home button is active')
    await home.click()
    check(await win.locator('.home').isVisible(), 'clicking Home on Home keeps Home open')
    check((await home.getAttribute('aria-pressed')) === 'true', 'the Home button stays active')

    await win.click('.evtabs .newbtn')
    await win.getByTestId('new-event-dialog').waitFor()
    await win.fill('[data-testid=new-event-name]', 'Gala')
    await win.setInputFiles('[data-testid=new-event-folder]', folder)
    const rows = win.locator('[data-testid=new-event-list] li')
    await rows.first().waitFor()
    check(
      (await rows.allInnerTexts()).map((t) => t.trim()).join('|') ===
        '2 Opening.pdf|10 Closing.pdf',
      'a chosen folder lists its decks in natural order',
      (await rows.allInnerTexts()).join('|')
    )
    check(
      (await win.getByTestId('new-event-skipped').innerText()).startsWith('1 item was left out'),
      'a file that is not a deck is left out and counted'
    )
    await win.setInputFiles('[data-testid=new-event-files]', sample)
    check((await rows.count()) === 3, 'chosen files are added to the list')
    await win.getByRole('button', { name: 'Remove sample.pdf' }).click()
    check((await rows.count()) === 2, 'a listed deck can be removed')

    await win.getByRole('button', { name: 'Create event' }).click()
    await win.locator('[role=tab][aria-selected=true]', { hasText: 'Gala' }).waitFor()
    check(!(await win.locator('.home').isVisible()), 'creating the event opens its console')
    await win.waitForFunction(
      () =>
        [...document.querySelectorAll('.deck .meta')].filter((m) =>
          m.textContent?.includes('3 slides')
        ).length === 2,
      null,
      { timeout: 90_000 }
    )
    const names = (await win.locator('.deck .name').allInnerTexts()).map((t) => t.trim())
    check(
      names.join('|') === '2 Opening|10 Closing',
      'both decks are imported into the new event in order',
      names.join('|')
    )
    await win.getByTestId('home-btn').click()
    check(await win.locator('.home').isVisible(), 'Home opens from the console')
  } finally {
    await app.close()
  }
}

{
  const { app, win } = await launch(userData)
  try {
    await win.locator('.home').waitFor()
    check(true, 'the next start opens on Home again')
    check((await win.locator('.otab').count()) === 0, 'no tab comes back from the last run')
    check((await win.locator('.home').getByText('Gala').count()) > 0, 'the event is listed on Home')
  } finally {
    await app.close()
  }
}

console.log(`\nNEW EVENT: ${passed} ok, ${failed} FAIL`)
if (failed) process.exit(1)
