// E2E: a video deck with HDMI off, with no output at all and with OMT only: the operator monitor
// plays it on the clock either way (it never needs an output window). Also a clip bigger than
// one range chunk with its moov atom at the end (no faststart), as cameras and exporters write.
// Run: npm run test:e2e:media-omt  (needs ffmpeg on PATH, else skips; PPT_CLIP=<mp4> to use a given clip)
import { _electron as electron } from 'playwright'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { linuxArgs } from './launch-args.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const OMT_TITLE = 'Bridgecast OMT'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
function check(cond, msg) {
  if (!cond) throw new Error(`ASSERT: ${msg}`)
  console.log(`ok - ${msg}`)
}
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ppt-share-media-omt-'))
let mp4 = process.env.PPT_CLIP
if (!mp4) {
  mp4 = path.join(tmp, 'clip.mp4')
  const r = spawnSync(
    'ffmpeg',
    [
      '-v',
      'error',
      '-y',
      '-f',
      'lavfi',
      '-i',
      'testsrc2=duration=20:size=1280x720:rate=25',
      '-f',
      'lavfi',
      '-i',
      'sine=frequency=440:duration=20',
      '-c:v',
      'libx264',
      '-b:v',
      '20000k',
      '-pix_fmt',
      'yuv420p',
      '-c:a',
      'aac',
      '-ar',
      '44100',
      mp4
    ],
    { encoding: 'utf8' }
  )
  if (r.status !== 0) {
    console.log('skip - ffmpeg not found on PATH, media-omt e2e not run')
    process.exit(0)
  }
}
async function scenario(omtOn) {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'ppt-share-e2e-mediaomt-'))
  const app = await electron.launch({
    args: [...linuxArgs, root],
    cwd: root,
    env: {
      ...process.env,
      PPT_SHARE_USER_DATA: userData,
      PPT_OMT_FAKE: '1',
      PPT_SKIP_HOME: '1',
      PPT_SKIP_TOUR: '1',
      ELECTRON_RENDERER_URL: ''
    }
  })
  const logs = []
  try {
    const win = await app.firstWindow()
    win.on('console', (m) => logs.push(`[op] ${m.text()}`))
    await win.waitForSelector('.app')
    await win.click('.newbtn')
    await win.fill('[data-testid=new-event-name]', 'Omt Media')
    await win.press('[data-testid=new-event-name]', 'Enter')
    await win.locator('[role=tab][aria-selected=true]', { hasText: 'Omt Media' }).waitFor()
    if (omtOn)
      await win.evaluate(() => window.api.setOmt({ enabled: true, name: 'Bridgecast', fps: 30 }))
    await win.evaluate(() =>
      window.api.setAudio({
        deviceId: null,
        muted: false,
        masterVolume: 100,
        route: 'local',
        monitor: false
      })
    )
    await win.setInputFiles('[data-testid=file-input]', [mp4])
    const deck = win.locator('.deck:not(.busy):not(.err)').first()
    await deck.waitFor({ timeout: 60_000 })
    await deck.click()
    await win.getByTestId('media').waitFor({ timeout: 10_000 })
    const monitor = () =>
      win.evaluate(() => {
        const v = [...document.querySelectorAll('.screen .pgm-layer video')].pop()
        return v
          ? { t: v.currentTime, paused: v.paused, ready: v.readyState, muted: v.muted }
          : null
      })
    const omt = () =>
      app.evaluate(async ({ BrowserWindow }, title) => {
        const w = BrowserWindow.getAllWindows().find(
          (x) => !x.isDestroyed() && x.getTitle() === title
        )
        if (!w) return 'no-window'
        return w.webContents.executeJavaScript(`(() => {
        const v = [...document.querySelectorAll('.output-layer video')].pop()
        const o = document.querySelector('.output')
        return { local: o?.dataset.local, tap: o?.dataset.tap, layers: document.querySelectorAll('.output-layer').length,
          imgs: document.querySelectorAll('.output-layer img').length,
          video: v ? { t: v.currentTime, paused: v.paused, ready: v.readyState, muted: v.muted, vol: v.volume } : null }
      })()`)
      }, OMT_TITLE)
    await sleep(1500)
    const m1 = await monitor()
    const o1 = await omt()
    await sleep(800)
    const m2 = await monitor()
    const o2 = await omt()
    console.log(JSON.stringify({ omtOn, m1, m2, o1, o2 }))
    const what = omtOn ? 'OMT only' : 'no output'
    console.log(logs.join('\n'))
    check(
      !!m1 && !!m2 && !m2.paused && m2.t > m1.t + 0.3,
      `${what}: monitor <video> plays with the clock`
    )
    check(
      !logs.some((l) => l.includes('failed, showing its poster')),
      `${what}: the video did not fail`
    )
    if (omtOn) {
      check(
        o2 !== 'no-window' && o2.video && !o2.video.paused && o2.video.t > o1.video.t + 0.3,
        'OMT window <video> plays'
      )
      check(o2.local === 'true' && !o2.video.muted, 'OMT window plays the sound locally')
    } else {
      check(o2 === 'no-window', 'no output window exists, so nothing plays the sound')
    }

    // The operator window is the one that plays when no output does, and the meter moves with it.
    const meter = () =>
      win.evaluate(() => {
        const m = document.querySelector('[data-testid=audio-meter]')
        const v = [...document.querySelectorAll('.screen .pgm-layer video')].pop()
        return m
          ? {
              local: m.dataset.local,
              sound: m.dataset.sound,
              state: m.dataset.state,
              vmuted: v?.muted
            }
          : null
      })
    const waitMeter = async (want, ms = 5000) => {
      for (let i = 0; i < ms / 100; i++) {
        const m = await meter()
        if (m && want(m)) return m
        await sleep(100)
      }
      return meter()
    }
    const base = await waitMeter((m) => m.state === 'live')
    check(base?.state === 'live', `${what}: the level meter moves with the video sound`)
    check(base.vmuted === false, `${what}: the operator <video> is not muted at the element`)
    if (omtOn) {
      check(
        base.local === 'false' && base.sound === 'off',
        'OMT plays locally: the operator is silent'
      )
      await win.click('[data-testid=transport-monitor]')
      const on = await waitMeter((m) => m.local === 'true')
      check(on.local === 'true' && on.sound === 'monitor', 'Monitor makes the operator play too')
      check(
        (await win.evaluate(() => window.api.getSettings())).audio.monitor === true,
        'Monitor is saved in the settings'
      )
      await win.click('[data-testid=transport-monitor]')
      const off = await waitMeter((m) => m.local === 'false')
      check(off.local === 'false', 'Monitor off: the operator is silent again')
    } else {
      check(
        base.local === 'true' && base.sound === 'auto',
        'no output: the operator plays the sound'
      )
    }
    await win.click('[data-testid=transport-mute]')
    const muted = await waitMeter((m) => m.state === 'muted')
    check(muted.state === 'muted', `${what}: muted shows the muted state on the meter`)
    check(
      (await win.locator('[data-testid=audio-meter] .ameter-note').textContent()) === 'Muted',
      `${what}: the muted state says Muted in words`
    )
    await win.click('[data-testid=transport-mute]')
  } finally {
    await app.close().catch(() => {})
    fs.rmSync(userData, { recursive: true, force: true })
  }
}

await scenario(false)
await scenario(true)
console.log('MEDIA OMT E2E PASSED')
fs.rmSync(tmp, { recursive: true, force: true })
