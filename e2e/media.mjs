// E2E of the media player: a video file becomes a deck, the operator MediaBar drives the
// output's <video> through the shared clock. Needs ffmpeg on PATH (else it skips, exit 0).
// Run: npm run test:e2e:media
import { _electron as electron } from 'playwright'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { linuxArgs } from './launch-args.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const HDMI_TITLE = 'Bridgecast HDMI'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function check(cond, msg) {
  if (!cond) throw new Error(`ASSERT: ${msg}`)
  console.log(`ok - ${msg}`)
}

const ffmpeg = (args) => spawnSync('ffmpeg', ['-v', 'error', '-y', ...args], { encoding: 'utf8' })
if (ffmpeg(['-version']).status !== 0) {
  console.log('skip - ffmpeg not found on PATH, media e2e not run')
  process.exit(0)
}

// --- Fixtures (generated, never committed) ---
const media = fs.mkdtempSync(path.join(os.tmpdir(), 'ppt-share-media-'))
const src = ['-f', 'lavfi', '-i', 'testsrc=duration=6:size=640x360:rate=25']
const tone = ['-f', 'lavfi', '-i', 'sine=frequency=440:duration=6']
const mp4 = path.join(media, 'clip.mp4')
const webm = path.join(media, 'clip2.webm')
let r = ffmpeg([...src, ...tone, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', mp4])
if (r.status !== 0) {
  r = ffmpeg([...src, ...tone, '-c:v', 'mpeg4', '-c:a', 'aac', mp4])
}
check(r.status === 0, `ffmpeg made clip.mp4 ${r.stderr ?? ''}`)
r = ffmpeg([
  ...src,
  ...tone,
  ...['-c:v', 'libvpx-vp9', '-deadline', 'realtime', '-cpu-used', '8', '-c:a', 'libopus', webm]
])
check(r.status === 0, `ffmpeg made clip2.webm ${r.stderr ?? ''}`)
const badAvi = path.join(media, 'bad.avi')
const badMkv = path.join(media, 'garbage.mkv')
fs.writeFileSync(badAvi, randomBytes(4096))
fs.writeFileSync(badMkv, randomBytes(4096))

const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'ppt-share-e2e-media-'))
const app = await electron.launch({
  args: [...linuxArgs, root],
  cwd: root,
  env: {
    ...process.env,
    PPT_SHARE_USER_DATA: userData,
    PPT_OUTPUT_DUMP: fs.mkdtempSync(path.join(os.tmpdir(), 'ppt-share-media-dump-')),
    PPT_SKIP_HOME: '1',
    PPT_SKIP_TOUR: '1',
    ELECTRON_RENDERER_URL: ''
  }
})
const errors = []

try {
  const win = await app.firstWindow()
  win.on('pageerror', (e) => errors.push(String(e)))
  await win.waitForSelector('.app')

  // --- Output: a simulated second display with HDMI on it (same as smoke.mjs) ---
  const fakeDisplays = (list) => app.evaluate((_e, l) => globalThis.__pptHdmiFakeDisplays(l), list)
  const PROBE_ID = 515151
  const p = await app.evaluate(({ screen }) => {
    const d = screen.getPrimaryDisplay()
    return { id: d.id, label: d.label, bounds: d.bounds }
  })
  const b = p.bounds
  await fakeDisplays([
    {
      id: p.id,
      label: p.label || 'Display 1',
      width: b.width,
      height: b.height,
      primary: true,
      bounds: b
    },
    {
      id: PROBE_ID,
      label: 'E2E OUTPUT',
      width: 1920,
      height: 1080,
      primary: false,
      bounds: { x: b.x + b.width - 960, y: b.y + b.height - 540, width: 960, height: 540 }
    }
  ])
  // Output chip in the header opens the HDMI popover.
  const pop = win.locator('[data-testid=output-popover][data-popover=hdmi]')
  if (!(await pop.isVisible().catch(() => false))) await win.getByTestId('output-chip-hdmi').click()
  await pop.waitFor()
  const select = pop.getByLabel('Target display')
  await select.locator(`option[value="${PROBE_ID}"]`).waitFor({ state: 'attached' })
  await select.selectOption(String(PROBE_ID))
  await pop.getByTestId('hdmi-switch').click()
  await win.locator('[data-testid=hdmi-status][data-tone=ok]').waitFor({ timeout: 15_000 })
  check(true, 'HDMI output on a simulated second display')

  /** Runs `fn(arg)` in the HDMI window; returns its (JSON) result. */
  const inOutput = (fn, arg) =>
    app.evaluate(
      ({ BrowserWindow }, [title, code, a]) => {
        const w = BrowserWindow.getAllWindows().find(
          (x) => !x.isDestroyed() && x.getTitle() === title
        )
        return w.webContents.executeJavaScript(`(${code})(${JSON.stringify(a ?? null)})`)
      },
      [HDMI_TITLE, fn.toString(), arg]
    )
  /** State of the topmost visible output layer: its video, or whether it is an image. */
  const outVideo = () =>
    inOutput(() => {
      const top = [...document.querySelectorAll('.output-layer')]
        .filter((l) => Number(getComputedStyle(l).opacity) > 0)
        .pop()
      const v = top?.querySelector('video')
      return {
        layers: document.querySelectorAll('.output-layer').length,
        hasImg: !!top?.querySelector('img'),
        video: v
          ? {
              t: v.currentTime,
              paused: v.paused,
              loop: v.loop,
              controls: v.hasAttribute('controls'),
              ready: v.readyState
            }
          : null,
        mediabar: !!document.querySelector('[data-testid=media], .mediabar'),
        inputs: document.querySelectorAll('input, button').length
      }
    })
  async function waitOut(pred, what, timeout = 6000) {
    const end = Date.now() + timeout
    let s = null
    while (Date.now() < end) {
      s = await outVideo()
      if (pred(s)) return s
      await sleep(120)
    }
    throw new Error(`ASSERT: ${what} (last ${JSON.stringify(s)})`)
  }

  // --- Event + imports ---
  await win.click('.newbtn')
  await win.fill('[data-testid=new-event-name]', 'Media Event')
  await win.press('[data-testid=new-event-name]', 'Enter')
  await win.locator('[role=tab][aria-selected=true]', { hasText: 'Media Event' }).waitFor()

  await win.setInputFiles('[data-testid=file-input]', [mp4, webm])
  const deck = (name) =>
    win.locator('.deck:not(.busy):not(.err)', {
      has: win.locator('.name', { hasText: new RegExp(`^${name}$`) })
    })
  await deck('clip').waitFor({ timeout: 60_000 })
  await deck('clip2').waitFor({ timeout: 60_000 })
  await win.locator('[data-testid=import-busy]').waitFor({ state: 'detached', timeout: 10_000 })
  check(
    (await deck('clip').locator('.sub').textContent()).startsWith('Video') &&
      (await deck('clip2').locator('.sub').textContent()).startsWith('Video'),
    'mp4 and webm import as decks showing "Video"; no import row is left busy'
  )
  check(
    (await win.getByTestId('import-error').count()) === 0,
    'good videos leave no import error row'
  )

  await win.setInputFiles('[data-testid=file-input]', [badAvi, badMkv])
  const errRow = (name) => win.getByTestId('import-error').filter({ hasText: name })
  await errRow('bad.avi').waitFor({ timeout: 10_000 })
  check(
    (await errRow('bad.avi').locator('.meta').textContent()) === 'Unsupported',
    'bad.avi is rejected as Unsupported'
  )
  await errRow('garbage.mkv').waitFor({ timeout: 30_000 })
  check(
    /cannot play here/.test(await errRow('garbage.mkv').locator('.msg').textContent()),
    'garbage.mkv is rejected with the MEDIA_UNPLAYABLE message'
  )
  check(
    (await win.locator('.deck:not(.busy):not(.err)').count()) === 2,
    'rejected files create no decks'
  )

  // A non-media deck, for the "take another deck" step.
  await win.setInputFiles('[data-testid=file-input]', path.join(root, 'fixtures/sample.pdf'))
  await win.locator('.deck .meta', { hasText: '3 slides' }).waitFor({ timeout: 60_000 })

  // --- Take the mp4 deck ---
  const media$ = win.getByTestId('media')
  check((await media$.count()) === 0, 'no MediaBar before a media deck is on air')
  await deck('clip').click()
  await media$.waitFor({ timeout: 10_000 })
  check(true, 'taking the video deck shows the operator MediaBar')
  const s1 = await waitOut((s) => s.video && !s.video.paused && s.video.t > 0.2, 'video playing')
  await sleep(700)
  const s2 = await outVideo()
  check(
    !s1.video.controls && s2.video.t > s1.video.t + 0.3 && !s2.video.paused,
    `output <video> has no controls and plays (${s1.video.t.toFixed(2)} -> ${s2.video.t.toFixed(2)})`
  )
  check(!s2.mediabar, 'no media bar in the output window')

  // The operator monitor plays the same clock (muted), never a still.
  const monitorPlays = async (what) => {
    const read = () =>
      win.evaluate(() => {
        const v = [...document.querySelectorAll('.screen .pgm-layer video')].pop()
        return v ? { t: v.currentTime, paused: v.paused, ready: v.readyState } : null
      })
    const a = await read()
    await sleep(700)
    const b = await read()
    check(
      !!a && !!b && !b.paused && b.t !== a.t,
      `monitor <video> plays ${what} (${JSON.stringify(a)} -> ${JSON.stringify(b)})`
    )
  }
  await monitorPlays('after the take')

  // --- Pause / Play ---
  await win.getByRole('button', { name: 'Pause video' }).click()
  await waitOut((s) => s.video?.paused, 'output paused after Pause')
  const pa = (await outVideo()).video.t
  await sleep(900)
  const pb = (await outVideo()).video.t
  check(Math.abs(pb - pa) < 0.1, `paused output holds its position (${pa.toFixed(2)})`)
  await win.getByRole('button', { name: 'Play video' }).click()
  await waitOut((s) => s.video && !s.video.paused && s.video.t > pb + 0.3, 'output resumes on Play')
  check(true, 'Play resumes the output')

  // --- Seek ---
  // Real pointer click on the bar: the pointer x maps exactly to time (no thumb offset).
  const seek = async (to) => {
    const dur = await win.evaluate(() => {
      const m = document
        .querySelector('[data-testid=media-time] small')
        .textContent.match(/(\d+):(\d+)/)
      return Number(m[1]) * 60 + Number(m[2])
    })
    const box = await win.locator('[data-testid=media-seek]').boundingBox()
    await win.mouse.click(box.x + (box.width * to) / dur, box.y + box.height / 2)
  }
  await win.getByRole('button', { name: 'Pause video' }).click()
  await waitOut((s) => s.video?.paused, 'paused before seeking')
  await seek(4)
  const sk = await waitOut((s) => s.video && Math.abs(s.video.t - 4) <= 0.6, 'output seeks to 4 s')
  check(true, `Seek to 4.0 s moves the output to ${sk.video.t.toFixed(2)} s`)
  // The thumb keeps the released spot (never snaps back), and the arrow keys step 1 s.
  const thumb = win.locator('[aria-label="Seek video"]')
  check(Math.abs(Number(await thumb.getAttribute('aria-valuenow')) - 4) < 0.6, 'thumb at 4 s')
  await thumb.focus()
  await win.keyboard.press('ArrowRight')
  await waitOut((s) => s.video && Math.abs(s.video.t - 5) <= 0.6, 'ArrowRight seeks +1 s')
  check(true, 'ArrowRight on the seek slider moves 1 s')

  // --- Restart ---
  await win.getByRole('button', { name: 'Restart video' }).click()
  const rs = await waitOut((s) => s.video && s.video.t <= 0.6, 'Restart goes back to the start')
  check(true, `Restart returns the output to ${rs.video.t.toFixed(2)} s`)

  // --- Loop ---
  const loopBtn = win.getByRole('button', { name: 'Loop video' })
  await loopBtn.click()
  await waitOut((s) => s.video?.loop === true, 'Loop sets loop on the output video')
  check((await loopBtn.getAttribute('aria-pressed')) === 'true', 'Loop is on (output video loops)')

  // --- Black / Black off while playing ---
  await seek(1)
  await waitOut((s) => s.video && !s.video.paused && s.video.t > 1, 'playing before Black')
  const black = win.getByRole('button', { name: /^Black/ })
  await black.click()
  await win.waitForFunction(
    () =>
      [...document.querySelectorAll('.transport button')]
        .find((x) => x.textContent.includes('Black'))
        ?.getAttribute('aria-pressed') === 'true'
  )
  await sleep(1200)
  await black.click()
  const back = await waitOut(
    (s) => !s.hasImg && s.video && !s.video.paused && s.video.ready >= 2,
    'video returns as a <video>, not the poster'
  )
  // Clock: it started at 1.0 s and ran about 1.2+ s of Black; looping, so t is in [1.0, 6).
  check(
    back.video.t >= 1.0 && back.video.t < 6,
    `Black off brings the video back as a playing <video> at ${back.video.t.toFixed(2)} s`
  )

  await monitorPlays('after Black off')

  // --- Leave the media deck: MediaBar goes away ---
  await deck('clip2').click()
  await sleep(300)
  check((await media$.count()) === 1, 'taking another video deck keeps a MediaBar')
  await monitorPlays('after taking another video deck')
  await win.locator('.deck', { has: win.locator('.name', { hasText: /^sample$/ }) }).click()
  await media$.waitFor({ state: 'detached', timeout: 5000 })
  check(true, 'taking a non-media deck removes the MediaBar')

  await deck('clip').click()
  await media$.waitFor()
  await monitorPlays('when a video deck follows a non-media deck')
  await win.getByTestId('header-offair').click()
  await win.getByTestId('header-offair-yes').click()
  await media$.waitFor({ state: 'detached', timeout: 5000 })
  check(true, 'Off air removes the MediaBar')

  check(errors.length === 0, `no page errors (${errors.join(' | ')})`)
  console.log('MEDIA E2E PASSED')
} finally {
  await app.close().catch(() => {})
  fs.rmSync(media, { recursive: true, force: true })
  fs.rmSync(userData, { recursive: true, force: true })
}
