// Settings dialog check in real Electron: open, change accent and theme, Escape, reload, Tab trap.
// Run: npx electron-vite build && node e2e/settings.mjs
import { _electron as electron } from 'playwright'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'ppt-share-e2e-'))
const check = (c, m) => {
  if (!c) throw new Error(`ASSERT: ${m}`)
  console.log(`ok - ${m}`)
}
const app = await electron.launch({
  args: [root],
  cwd: root,
  env: { ...process.env, PPT_SHARE_USER_DATA: userData, ELECTRON_RENDERER_URL: '' }
})
try {
  const page = await app.firstWindow()
  await page.waitForSelector('header')
  const attr = (n) => page.evaluate((k) => document.documentElement.dataset[k], n)
  // Controls > Output open behind the dialog, to watch it follow the Sound section.
  const ctl = page.getByRole('tab', { name: 'Controls' })
  if ((await ctl.getAttribute('aria-selected')) !== 'true') await ctl.click()
  const outPanel = page.getByTestId('output-panel')
  const outHead = outPanel.getByRole('button', { name: 'Output', exact: true })
  if ((await outHead.getAttribute('aria-expanded')) !== 'true') await outHead.click()
  await page.getByTestId('audio-route').waitFor()
  const checked = (tid) =>
    page.evaluate(
      (t) => document.querySelector(`[data-testid=${t}] [aria-checked=true]`)?.textContent ?? null,
      tid
    )
  const savedAudio = () =>
    JSON.parse(fs.readFileSync(path.join(userData, 'settings.json'), 'utf8')).audio
  await page.click('button.gear')
  await page.waitForSelector('[data-testid=settings-dialog]')
  check(
    await page.evaluate(() => document.activeElement?.dataset.testid === 'settings-close'),
    'focus on close'
  )
  check(/\d/.test(await page.textContent('.about-line')), 'version shown')
  await page.click('[data-testid=accent-violet]')
  check((await attr('accent')) === 'violet', 'accent violet applied')
  await page.click('[data-testid=settings-theme] >> text=Light')
  check((await attr('theme')) === 'light', 'theme light applied')
  await page.click('[data-testid=accent-custom]')
  await page.fill('[data-testid=custom-accent-input]', '#ffee00')
  check(
    await page.evaluate(() => document.documentElement.style.getPropertyValue('--accent') !== ''),
    'custom accent sets variables'
  )
  await page.click('[data-testid=settings-reduce-motion]')
  check((await attr('reduceMotion')) !== undefined, 'reduce motion attr set')
  // Sound section: route and device mirror Controls > Output, both directions.
  await page.waitForSelector('[data-testid=settings-audio-device]')
  check((await checked('settings-audio-route')) === (await checked('audio-route')), 'routes match')
  await page.click('[data-testid=settings-audio-route] >> text=Both')
  await page.waitForFunction(
    () =>
      document.querySelector('[data-testid=audio-route] [aria-checked=true]')?.textContent ===
      'Both'
  )
  check(savedAudio().route === 'both', 'route saved from Settings; Output section follows')
  await page.evaluate(() => window.api.patchAudio({ route: 'omt' }))
  await page.reload()
  await page.waitForSelector('header')
  check((await checked('audio-route')) === 'Network', 'route from the API persists after reload')
  await page.click('button.gear')
  await page.waitForSelector('[data-testid=settings-audio-device]')
  check((await checked('settings-audio-route')) === 'Network', 'Settings shows the saved route')
  // A saved device that is not connected shows in both pickers.
  await page.evaluate(() => window.api.patchAudio({ deviceId: 'gone-device' }))
  await page.getByTestId('settings-audio-missing').waitFor()
  await page.getByTestId('audio-missing').waitFor()
  check(true, 'missing saved device warns in Settings and in Output')
  await page.evaluate(() => window.api.patchAudio({ deviceId: null, route: 'local' }))
  await page.getByTestId('settings-audio-missing').waitFor({ state: 'detached' })
  // Tab reaches the select.
  await page.focus('[data-testid=settings-reduce-motion]')
  let hitSelect = false
  for (let i = 0; i < 12 && !hitSelect; i++) {
    await page.keyboard.press('Tab')
    hitSelect = await page.evaluate(
      () => document.activeElement?.dataset.testid === 'settings-audio-device'
    )
  }
  check(hitSelect, 'Tab reaches the Output device select')
  for (let i = 0; i < 25; i++) {
    await page.keyboard.press('Tab')
    const inside = await page.evaluate(() =>
      document.querySelector('[data-testid=settings-dialog]').contains(document.activeElement)
    )
    if (!inside)
      throw new Error(
        'ASSERT: focus left dialog ' +
          i +
          ' ' +
          (await page.evaluate(() => document.activeElement?.outerHTML.slice(0, 120)))
      )
  }
  console.log('ok - Tab stays inside')
  await page.keyboard.press('Escape')
  check((await page.locator('[data-testid=settings-dialog]').count()) === 0, 'Escape closes')
  check(
    await page.evaluate(() => document.activeElement?.classList.contains('gear')),
    'focus returns to gear'
  )
  await page.reload()
  await page.waitForSelector('header')
  check(
    (await attr('accent')) === 'custom' && (await attr('theme')) === 'light',
    'persists after reload'
  )
  check((await attr('reduceMotion')) !== undefined, 'reduce motion persists')
  await page.screenshot({ path: path.join(os.tmpdir(), 'settings-closed.png') })
  await page.click('button.gear')
  await page.screenshot({ path: path.join(os.tmpdir(), 'settings-open.png') })
  console.log('PASS')
} finally {
  await app.close()
}
