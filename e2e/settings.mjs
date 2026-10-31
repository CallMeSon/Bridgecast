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
  await page.click('button.gear')
  await page.waitForSelector('[data-testid=settings-dialog]')
  check(await page.evaluate(() => document.activeElement?.dataset.testid === 'settings-close'), 'focus on close')
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
  for (let i = 0; i < 25; i++) {
    await page.keyboard.press('Tab')
    const inside = await page.evaluate(() =>
      document.querySelector('[data-testid=settings-dialog]').contains(document.activeElement)
    )
    if (!inside) throw new Error('ASSERT: focus left dialog')
  }
  console.log('ok - Tab stays inside')
  await page.keyboard.press('Escape')
  check((await page.locator('[data-testid=settings-dialog]').count()) === 0, 'Escape closes')
  check(await page.evaluate(() => document.activeElement?.classList.contains('gear')), 'focus returns to gear')
  await page.reload()
  await page.waitForSelector('header')
  check((await attr('accent')) === 'custom' && (await attr('theme')) === 'light', 'persists after reload')
  check((await attr('reduceMotion')) !== undefined, 'reduce motion persists')
  await page.screenshot({ path: path.join(os.tmpdir(), 'settings-closed.png') })
  await page.click('button.gear')
  await page.screenshot({ path: path.join(os.tmpdir(), 'settings-open.png') })
  console.log('PASS')
} finally {
  await app.close()
}
