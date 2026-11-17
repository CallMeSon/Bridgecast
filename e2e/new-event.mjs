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

    // Canvas and Outputs start from this PC's settings; here the event asks for 4K and OMT.
    const settings = () => win.evaluate(() => window.api.getSettings())
    const before = await settings()
    check(!before.omt.enabled && !before.ndi.enabled, 'OMT and NDI are off before the event')
    check(
      (await win.getByTestId('new-event-out-omt').getAttribute('aria-checked')) === 'false',
      'the Outputs switches show what is on now'
    )
    await win.getByTestId('new-event-canvas').selectOption('custom')
    await win.getByRole('button', { name: 'Create event' }).click()
    check(
      (await win.getByTestId('new-event-canvas-error').innerText()).includes('320 to 7680'),
      'an empty custom size is refused with the reason'
    )
    await win.getByTestId('new-event-canvas').selectOption('3840x2160')
    await win.getByTestId('new-event-out-omt').click()

    await win.getByRole('button', { name: 'Create event' }).click()
    await win.locator('[role=tab][aria-selected=true]', { hasText: 'Gala' }).waitFor()
    check(!(await win.locator('.home').isVisible()), 'creating the event opens its console')
    const gala = (await win.evaluate(() => window.api.listEvents())).find((e) => e.name === 'Gala')
    check(
      gala?.canvas?.width === 3840 && gala?.canvas?.height === 2160,
      'the event keeps the canvas chosen in the dialog'
    )
    check(
      gala?.outputs?.omt === true && gala?.outputs?.ndi === false,
      'the event keeps the outputs chosen in the dialog'
    )
    await win.waitForFunction(() => window.api.getSettings().then((s) => s.omt.enabled))
    check(true, 'opening the event (nothing else on the output) turns OMT on')
    const session = () => win.evaluate(() => window.api.getSession())
    check(
      (await session()).state.canvas.width === 3840 &&
        (await session()).state.canvas.origin === 'event',
      'the output canvas follows the event'
    )
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
    // A switch flipped in the Output panel is remembered by the event that owns the output.
    await win.evaluate(async () => {
      const s = await window.api.getSettings()
      await window.api.setNdi({ ...s.ndi, enabled: true })
    })
    const galaNow = (await win.evaluate(() => window.api.listEvents())).find(
      (e) => e.name === 'Gala'
    )
    check(galaNow?.outputs?.ndi === true, 'the event remembers an output switched in the panel')

    // A second event with everything off: nothing changes until it takes the output.
    await win.click('.evtabs .newbtn')
    await win.getByTestId('new-event-dialog').waitFor()
    await win.fill('[data-testid=new-event-name]', 'Quiet')
    // OMT was switched by main (the window was told); NDI above went past the window's own
    // state on purpose, so its switch still reads off.
    check(
      (await win.getByTestId('new-event-out-omt').getAttribute('aria-checked')) === 'true',
      'the next dialog starts from the outputs that are on now'
    )
    await win.getByTestId('new-event-out-omt').click()
    await win.setInputFiles('[data-testid=new-event-files]', sample)
    await win.getByRole('button', { name: 'Create event' }).click()
    await win.locator('[role=tab][aria-selected=true]', { hasText: 'Quiet' }).waitFor()
    await win.locator('.deck .meta', { hasText: '3 slides' }).waitFor({ timeout: 90_000 })
    const held = await settings()
    check(
      held.omt.enabled && held.ndi.enabled,
      'opening another event leaves the outputs of the event that owns the output'
    )
    await win.keyboard.press('Space')
    await win.waitForFunction(() =>
      window.api.getSettings().then((s) => !s.omt.enabled && !s.ndi.enabled)
    )
    check(true, 'taking a slide of the second event switches to its outputs')
    check(
      (await session()).state.canvas.origin === 'default',
      'and the output canvas is the default again'
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
