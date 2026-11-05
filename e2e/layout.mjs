// Layout regression across window sizes, themes and states, in real Electron (Playwright).
// Run: npm run test:e2e:layout   (builds first)
// Prints `ok - <name>` or `FAIL - <name>` for every check, never stops at the first failure,
// and exits 1 when any failed. Checks for controls that a later fix adds (tab overflow menu,
// focus ring, ...) print FAIL when the control is missing instead of throwing.
// Headless: xvfb-run -a -s '-screen 0 2640x1520x24' node e2e/layout.mjs
// (the screen must be larger than the biggest size: a window as large as it comes out 1 px short)
import { _electron as electron } from 'playwright'
import * as fs from 'node:fs'
import * as http from 'node:http'
import * as os from 'node:os'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import { linuxArgs } from './launch-args.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'bridgecast-layout-'))
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const SIZES = [
  [1024, 640],
  [1024, 900],
  [1180, 700],
  [1280, 720],
  [1366, 768],
  [1440, 900],
  [1600, 900],
  [1920, 640],
  [1920, 1080],
  [2560, 1440]
]
const LONG_NAME =
  'Opening Keynote: The Future of Regional Trade and Long Deck Names That Keep Going'
const SHORT_WAIT = 1500

let failed = 0
let passed = 0
/** Prints one result; never throws. */
function check(name, cond, detail = '') {
  if (cond) {
    passed++
    console.log(`ok - ${name}`)
  } else {
    failed++
    console.log(`FAIL - ${name}${detail ? ` (${detail})` : ''}`)
  }
}

const app = await electron.launch({
  args: [...linuxArgs, root],
  cwd: root,
  env: {
    ...process.env,
    PPT_SHARE_USER_DATA: userData,
    PPT_OUTPUT_DUMP: fs.mkdtempSync(path.join(os.tmpdir(), 'bridgecast-layout-dump-')),
    PPT_OMT_FAKE: '1',
    PPT_NDI_FAKE: '1',
    ELECTRON_RENDERER_URL: ''
  }
})
const win = await app.firstWindow()
const pageErrors = []
win.on('pageerror', (e) => pageErrors.push(String(e)))

const fixture = fs.readFileSync(path.join(root, 'fixtures/web/index.html'))
const server = http.createServer((_q, s) => {
  s.writeHead(200, { 'content-type': 'text/html' })
  s.end(fixture)
})
await new Promise((r) => server.listen(0, '127.0.0.1', r))
const base = `http://127.0.0.1:${server.address().port}`

class FatalSize extends Error {}

const api = (fn, ...a) => win.evaluate(([f, args]) => window.api[f](...args), [fn, a])

/** Sizes the operator window's content area and reads the size back; a mismatch aborts the run. */
async function setSize(w, h) {
  await app.evaluate(
    ({ BrowserWindow }, [cw, ch]) => {
      const b = BrowserWindow.getAllWindows().find(
        (x) =>
          x.getTitle().startsWith('Bridgecast') && !x.getTitle().includes('HDMI') && x.isVisible()
      )
      b.setContentSize(cw, ch)
    },
    [w, h]
  )
  await sleep(350)
  const real = await win.evaluate(() => [innerWidth, innerHeight])
  if (real[0] !== w || real[1] !== h) {
    throw new FatalSize(`window is ${real[0]}x${real[1]}, asked ${w}x${h}`)
  }
}

/** Switches the theme and confirms it took effect; false when it did not. */
async function setTheme(t) {
  const cur = () => win.evaluate(() => document.documentElement.dataset.theme)
  if ((await cur()) === t) return true
  await win.locator('header button', { hasText: t === 'dark' ? 'Dark' : 'Light' }).click()
  await sleep(250)
  return (await cur()) === t
}

/** Runs one phase; a crash in it is a FAIL and the run goes on. */
async function phase(name, fn) {
  try {
    await fn()
  } catch (e) {
    if (e instanceof FatalSize) throw e
    failed++
    console.log(`FAIL - phase "${name}" crashed: ${String(e).split('\n')[0]}`)
  }
}

/** Measures the operator window for the per-size checks. Runs in the page. */
const measure = () => {
  const rect = (sel) => {
    const e = document.querySelector(sel)
    if (!e) return null
    const r = e.getBoundingClientRect()
    return {
      left: r.left,
      right: r.right,
      top: r.top,
      bottom: r.bottom,
      width: r.width,
      height: r.height
    }
  }
  const visible = (el) => {
    const r = el.getBoundingClientRect()
    const cs = getComputedStyle(el)
    return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none'
  }
  const html = document.documentElement
  const stage = document.querySelector('.stage-col')
  const transport = document.querySelector('[data-testid=transport]')
  const where = document.querySelector('.ptitle .where')
  const sub = where?.querySelector('.sub')
  const kv = document.querySelector('[data-testid=kv-block]')
  const add = document.querySelector('.left > .add')
  const spills = [...document.querySelectorAll('[role=radio], .seg button, .k')]
    .filter(visible)
    .filter((e) => getComputedStyle(e).textOverflow !== 'ellipsis')
    .filter((e) => e.scrollWidth > e.clientWidth + 1)
    .map(
      (e) =>
        `${e.className || e.tagName} "${(e.textContent || '').trim().slice(0, 20)}" ${e.clientWidth}/${e.scrollWidth}`
    )
  const deckName =
    [...document.querySelectorAll('.deck .name')].find((e) =>
      (e.textContent || '').startsWith('Opening Keynote')
    ) ?? null
  return {
    innerWidth,
    innerHeight,
    pageW: html.scrollWidth,
    pageH: html.scrollHeight,
    stageScroll: stage ? [stage.scrollWidth, stage.clientWidth] : null,
    transportScroll: transport ? [transport.scrollWidth, transport.clientWidth] : null,
    mute: rect('[data-testid=transport-mute]'),
    transport: rect('[data-testid=transport]'),
    screen: rect('.screen'),
    where: where ? rect('.ptitle .where') : null,
    sub: sub
      ? (() => {
          const r = sub.getBoundingClientRect()
          return { right: r.right, width: r.width }
        })()
      : null,
    spills,
    panelTab:
      document
        .querySelector('[data-testid=right-panel] [role=tab][aria-selected=true]')
        ?.textContent?.trim() ?? 'unknown',
    // The footer is the KV block plus the Add row (siblings at the bottom of the Decks column).
    footer: kv && add ? add.getBoundingClientRect().bottom - kv.getBoundingClientRect().top : null,
    deckName: deckName ? deckName.getBoundingClientRect().width : null
  }
}

/** The Sound button is inside the window and inside the transport bar. */
function soundInView(m) {
  return (
    !!m.mute &&
    !!m.transport &&
    m.mute.right <= m.innerWidth &&
    m.mute.left >= m.transport.left &&
    m.mute.right <= m.transport.right + 1
  )
}

function sizeChecks(m, size) {
  const at = ` at ${size}`
  check(
    'page does not scroll' + at,
    m.pageW <= m.innerWidth && m.pageH <= m.innerHeight,
    `${m.pageW}x${m.pageH}`
  )
  check(
    'stage does not scroll sideways' + at,
    !!m.stageScroll && m.stageScroll[0] <= m.stageScroll[1],
    String(m.stageScroll)
  )
  check(
    'transport fits' + at,
    !!m.transportScroll && m.transportScroll[0] <= m.transportScroll[1],
    String(m.transportScroll)
  )
  check(
    'sound button in view' + at,
    soundInView(m),
    m.mute && m.transport
      ? `mute ${Math.round(m.mute.left)}..${Math.round(m.mute.right)}, transport ${Math.round(m.transport.left)}..${Math.round(m.transport.right)}`
      : 'missing'
  )
  check(
    'monitor is 16:9' + at,
    !!m.screen && Math.abs(m.screen.width / m.screen.height - 16 / 9) < 0.02,
    m.screen ? `${m.screen.width}x${m.screen.height}` : 'missing'
  )
  check(
    'program title keeps "/ Program"' + at,
    !!m.sub && !!m.where && m.sub.right <= m.where.right + 1 && m.sub.width > 0,
    m.sub && m.where
      ? `sub right ${Math.round(m.sub.right)}, title right ${Math.round(m.where.right)}, width ${Math.round(m.sub.width)}`
      : 'missing'
  )
  check(
    'no text spills from a control' + at,
    m.spills.length === 0,
    `right panel tab: ${m.panelTab}` + (m.spills.length ? `; ${m.spills.join('; ')}` : '')
  )
  check(
    'decks footer is compact' + at,
    m.footer !== null && m.footer <= 150,
    m.footer === null ? 'kv-block or Add row missing' : `${Math.round(m.footer)}px`
  )
  check(
    'deck name has its own row' + at,
    m.deckName !== null && m.deckName >= 130,
    `${Math.round(m.deckName ?? -1)}px`
  )
}

async function sweep(theme) {
  if (!(await setTheme(theme))) {
    failed++
    console.log(`FAIL - theme ${theme} did not apply, sweep skipped`)
    return
  }
  // Right panel on Controls, so its rows are the ones measured by the spill check.
  await win
    .getByRole('tab', { name: 'Controls' })
    .click({ timeout: SHORT_WAIT })
    .catch(() => {})
  await sleep(150)
  for (const [w, h] of SIZES) {
    await setSize(w, h)
    const m = await win.evaluate(measure)
    sizeChecks(m, `${w}x${h}${theme === 'dark' ? ' (dark)' : ''}`)
  }
}

const tagOf = (deckId) =>
  win.evaluate((id) => {
    const e = document.querySelector(`.deck[data-deck-id="${id}"] .stag`)
    return e ? (e.textContent || '').trim() : ''
  }, deckId)

const monitorText = () => win.locator('.screen').first().innerText({ timeout: SHORT_WAIT })

let eventId = ''
let pdfId = ''
let webId = ''

try {
  await win.waitForSelector('[data-testid=home]', { timeout: 30000 })
  if (!(await setTheme('light'))) {
    failed++
    console.log('FAIL - theme light did not apply')
  }

  // ---- Empty event: first event, made through the dialog, nothing on air.
  await phase('empty event', async () => {
    await win.click('[data-testid=home-new]')
    await win.fill('[data-testid=new-event-name]', 'Annual Leadership Summit 2026')
    await win.press('[data-testid=new-event-name]', 'Enter')
    await win.waitForSelector('[data-testid=transport]')
    await sleep(300)
    check('empty event says No slides yet', (await monitorText()).includes('No slides yet'))
    eventId = (await api('getSession')).eventId
  })

  // ---- Seed: PDF through the real file input (pdf.js runs in the renderer), video deck, web deck.
  await phase('seed', async () => {
    await win.setInputFiles('[data-testid=file-input]', [path.join(root, 'fixtures/sample.pdf')])
    await win.locator('.deck .meta', { hasText: '3 slides' }).waitFor({ timeout: 60000 })
    await api('importDecks', eventId, [
      { id: 'video-1', path: path.join(root, 'fixtures/video-deck') }
    ])
    await sleep(2500)
    const web = await api('addWebDeck', eventId, `${base}/`, 'Live Poll Page')
    webId = web.id
    await sleep(2500)
    let decks = await api('listDecks', eventId)
    decks = decks.decks ?? decks
    const pdf = decks.find((d) => d.slides?.length === 3 && d.source !== 'web')
    if (!pdf) throw new Error('PDF deck not found after import')
    pdfId = pdf.id
    // Renamed through the UI (F2) so the Library shows the long name at once.
    await win.locator(`.deck[data-deck-id="${pdfId}"]`).focus()
    await win.keyboard.press('F2')
    const input = win.locator('[data-testid=rename-deck] input')
    await input.fill(LONG_NAME)
    await input.press('Enter')
    await win
      .locator('.deck .name', { hasText: 'Opening Keynote' })
      .first()
      .waitFor({ timeout: 5000 })
  })

  // ---- Standby with slides: decks exist, nothing on air.
  await phase('standby', async () => {
    await sleep(200)
    check(
      'standby card does not say No slides yet',
      !(await monitorText()).includes('No slides yet')
    )
  })

  // ---- On air, both themes, every size.
  await phase('on air', async () => {
    await api('dispatch', { type: 'selectDeck', deckId: pdfId })
    await sleep(800)
  })
  await phase('sweep light', () => sweep('light'))
  await phase('sweep dark', () => sweep('dark'))
  await setTheme('light')

  // ---- Splitter sweep: Program column width, dragged as smoke.mjs does.
  await phase('splitter sweep', async () => {
    await setSize(1920, 1080)
    const stageWidth = () =>
      win.evaluate(() => document.querySelector('.stage-col').getBoundingClientRect().width)
    for (const target of [420, 460, 480, 506, 520, 560]) {
      await win.getByTestId('splitter-left').dblclick()
      await sleep(150)
      const grip = await win.getByTestId('splitter-left').boundingBox()
      const gx = grip.x + grip.width / 2
      const gy = grip.y + grip.height / 2
      const delta = (await stageWidth()) - target
      await win.mouse.move(gx, gy)
      await win.mouse.down()
      await win.mouse.move(gx + delta, gy, { steps: 5 })
      await win.mouse.up()
      await sleep(250)
      const got = Math.round(await stageWidth())
      if (Math.abs(got - target) > 3) {
        failed++
        console.log(`FAIL - Program column reached ${target}px (got ${got}px)`)
        continue
      }
      const m = await win.evaluate(measure)
      check(
        `sound button in view at Program ${target}`,
        soundInView(m),
        m.mute
          ? `mute ${Math.round(m.mute.left)}..${Math.round(m.mute.right)}, transport ${Math.round(m.transport.left)}..${Math.round(m.transport.right)}, Program ${got}px`
          : 'missing'
      )
    }
    await win.getByTestId('splitter-left').dblclick()
  })

  // ---- Black, then KV, on the deck row.
  await phase('black', async () => {
    await setSize(1440, 900)
    await api('dispatch', { type: 'toggleBlack' })
    await sleep(500)
    const tagText = await tagOf(pdfId)
    check('deck row shows BLACK', tagText === 'BLACK', `"${tagText}"`)
    await api('dispatch', { type: 'toggleBlack' })
    await sleep(300)
  })
  await phase('kv', async () => {
    await win.setInputFiles('[data-testid=kv-input]', path.join(root, 'resources/icon.png'))
    await sleep(900)
    await api('dispatch', { type: 'toggleKv' })
    await sleep(500)
    const tagText = await tagOf(pdfId)
    check('deck row shows KV', tagText === 'KV', `"${tagText}"`)
    await api('dispatch', { type: 'toggleKv' })
    await sleep(300)
  })

  // ---- Web deck live.
  await phase('web deck', async () => {
    await api('dispatch', { type: 'selectDeck', deckId: webId })
    await sleep(3000)
    const live = (await api('getSession')).state.shown?.web?.deckId === webId
    check('web deck is live', live)
    const transportText = await win
      .locator('[data-testid=transport]')
      .innerText({ timeout: SHORT_WAIT })
    const metaText = await win.locator('.pgm-meta').innerText({ timeout: SHORT_WAIT })
    check(
      'web deck has no slide position',
      live && !/\d+\s*\/\s*\d+/.test(transportText),
      JSON.stringify(transportText.replace(/\s+/g, ' '))
    )
    check(
      'web deck says page',
      metaText.includes('web page'),
      JSON.stringify(metaText.replace(/\s+/g, ' '))
    )
    const rowOf = () =>
      win.evaluate((id) => {
        const d = document.querySelector(`.deck[data-deck-id="${id}"]`)
        if (!d) return null
        const r = d.getBoundingClientRect()
        const kids = [...d.querySelectorAll('.stag, .chip, .sub, .name')].map((e) =>
          e.getBoundingClientRect()
        )
        return {
          tag: (d.querySelector('.stag')?.textContent || '').trim(),
          h: Math.round(r.height),
          spill: d.scrollWidth > d.clientWidth + 1 || kids.some((k) => k.right > r.right + 1),
          col: Math.round(r.width)
        }
      }, webId)
    for (const [w, h] of [
      [1440, 900],
      [1024, 640]
    ]) {
      await setSize(w, h)
      const row = await rowOf()
      check(
        `web deck row shows LIVE at ${w}x${h}`,
        live && row !== null && row.tag === 'LIVE' && row.h === 52 && !row.spill,
        JSON.stringify(row)
      )
    }
    await api('dispatch', { type: 'selectDeck', deckId: pdfId })
    await sleep(600)
  })

  // ---- Popovers at 1024x640.
  await phase('popovers', async () => {
    await setSize(1024, 640)
    await win.getByRole('tab', { name: 'Controls' }).click({ timeout: SHORT_WAIT })
    let rect = null
    try {
      await win.locator('button:has-text("Change")').first().click({ timeout: SHORT_WAIT })
      await win.locator('[role=dialog]').first().waitFor({ timeout: SHORT_WAIT })
      await sleep(200)
      rect = await win
        .locator('[role=dialog]')
        .first()
        .evaluate((e) => {
          const r = e.getBoundingClientRect()
          return { top: r.top, bottom: r.bottom, innerHeight }
        })
    } catch {
      rect = null
    }
    check(
      'canvas dialog fits the window',
      !!rect && rect.bottom <= rect.innerHeight && rect.top >= 0,
      rect
        ? `top ${Math.round(rect.top)}, bottom ${Math.round(rect.bottom)} of ${rect.innerHeight}`
        : 'dialog did not open'
    )
    // Escape in the confirmation closes only the confirmation; a second Escape closes the dialog.
    let esc = null
    try {
      await win
        .locator('.canvas-opt:not(:disabled)[aria-pressed="false"]')
        .first()
        .evaluate((e) => e.click())
      await win.locator('[data-testid=canvas-confirm]').waitFor({ timeout: SHORT_WAIT })
      await win.keyboard.press('Escape')
      await sleep(250)
      const open = () =>
        win.evaluate(() => ({
          confirm: !!document.querySelector('[data-testid=canvas-confirm]'),
          dialog: !!document.querySelector('[data-testid=event-canvas-dialog]')
        }))
      const first = await open()
      await win.keyboard.press('Escape')
      await sleep(250)
      esc = { first, second: await open() }
    } catch (e) {
      esc = { error: String(e).slice(0, 600) }
    }
    check(
      'Escape in the canvas confirmation keeps the dialog',
      !!esc && !esc.error && !esc.first.confirm && esc.first.dialog && !esc.second.dialog,
      JSON.stringify(esc)
    )
    await win.keyboard.press('Escape')
    await sleep(250)

    // First row: the audit's overflow (menu opened high, taller than the room below). Last row: least room.
    const menus = []
    for (const which of ['first', 'last']) {
      let m = null
      try {
        const row = win.locator('.deck-row')[which]()
        await row.hover({ timeout: SHORT_WAIT })
        await row.locator('[data-testid=deck-more]').click({ timeout: SHORT_WAIT })
        await win.locator('[data-testid=deck-menu]').waitFor({ timeout: SHORT_WAIT })
        await sleep(200)
        m = await win.locator('[data-testid=deck-menu]').evaluate((e) => {
          const r = e.getBoundingClientRect()
          return { top: r.top, bottom: r.bottom, innerHeight }
        })
      } catch {
        m = null
      }
      menus.push([which, m])
      await win.keyboard.press('Escape')
      await sleep(250)
    }
    check(
      'deck menu fits the window',
      menus.every(([, m]) => !!m && m.bottom <= m.innerHeight && m.top >= 0),
      menus
        .map(([w, m]) =>
          m
            ? `${w} row: top ${Math.round(m.top)}, bottom ${Math.round(m.bottom)} of ${m.innerHeight}`
            : `${w} row: menu did not open`
        )
        .join('; ')
    )
  })

  // ---- Focus ring: a mouse click then keys must not show one; Tab brings it back.
  await phase('focus', async () => {
    await setSize(1440, 900)
    const ring = () =>
      win.evaluate(() => {
        const e = document.activeElement
        if (!e || e === document.body) return 'none'
        const cs = getComputedStyle(e)
        return cs.outlineStyle === 'none' || parseFloat(cs.outlineWidth) === 0
          ? 'none'
          : `${cs.outlineWidth} ${cs.outlineStyle}`
      })
    await win.getByRole('tab', { name: 'Info' }).click({ timeout: SHORT_WAIT })
    await sleep(150)
    await win.keyboard.press('f')
    await win.keyboard.press('f')
    await sleep(250)
    const afterKeys = await ring()
    check('no ring after click then key', afterKeys === 'none', afterKeys)
    await win.keyboard.press('Tab')
    await sleep(150)
    const afterTab = await ring()
    check('ring back after Tab', afterTab !== 'none', afterTab)
    await win.evaluate(() => document.activeElement?.blur?.())
  })

  // ---- Nine events with OMT and NDI on: the tab overflow menu.
  await phase('events', async () => {
    await api('setOmt', { enabled: true }).catch(() => {})
    await api('setNdi', { enabled: true }).catch(() => {})
    await sleep(1200)
    const names = [
      'Konferensi Nasional Transformasi Digital dan Inovasi Teknologi Indonesia Tahun 2026 Hari Kedua Sesi Pleno',
      'Event 3',
      'Event 4',
      'Event 5',
      'Event 6',
      'Event 7',
      'Event 8',
      'Event 9'
    ]
    for (const n of names) {
      await win.click('[data-testid=home-btn]')
      await win.waitForSelector('[data-testid=home]')
      await win.click('[data-testid=home-new]')
      await win.fill('[data-testid=new-event-name]', n)
      await win.press('[data-testid=new-event-name]', 'Enter')
      await win.waitForSelector('[data-testid=transport]')
      await sleep(150)
    }
    await setSize(1280, 720)
    await sleep(300)
  })
  await phase('tab overflow', async () => {
    const trigger = win
      .locator(
        '.evtabs [aria-haspopup=menu], .evtabs [data-testid=tab-overflow], .evtabs button[aria-label*="more tabs" i], .evtabs button[aria-label*="all tabs" i], .evtabs button[aria-label*="open events" i]:not([role=tablist])'
      )
      .first()
    let menuItems = -1
    let opened = false
    try {
      await trigger.click({ timeout: SHORT_WAIT })
      await win
        .locator('[role=menu] [role=menuitem], [role=menu] [role=menuitemradio]')
        .first()
        .waitFor({ timeout: SHORT_WAIT })
      menuItems = await win
        .locator('[role=menu] [role=menuitem], [role=menu] [role=menuitemradio]')
        .count()
      opened = true
    } catch {
      opened = false
    }
    check(
      'tab overflow menu lists every open tab',
      opened && menuItems === 8,
      opened ? `${menuItems} items` : 'no overflow control'
    )
    let selectedTabName = ''
    if (opened) {
      try {
        await win
          .locator('[role=menu] [role=menuitem], [role=menu] [role=menuitemradio]')
          .filter({ hasText: 'Event 5' })
          .first()
          .click({ timeout: SHORT_WAIT })
        await sleep(400)
        selectedTabName =
          (
            await win
              .locator('.evtabs [role=tab][aria-selected=true] .tn')
              .first()
              .textContent({ timeout: SHORT_WAIT })
          )?.trim() ?? ''
      } catch {
        selectedTabName = ''
      }
    }
    check('tab overflow menu opens the tab', selectedTabName === 'Event 5', `"${selectedTabName}"`)
    await win.keyboard.press('Escape').catch(() => {})
  })

  // ---- A real mouse click reaches every tab with the on-air tab pinned at the list edge, and
  // the chosen tab is scrolled clear of it (scroll-padding on .tabsbar).
  await phase('tab reach', async () => {
    for (const [w, h] of [
      [1024, 640],
      [1180, 700]
    ]) {
      await setSize(w, h)
      await sleep(300)
      const n = await win.locator('.evtabs [role=tab]').count()
      const order = [...Array(n).keys()]
      const bad = []
      for (const i of [...order, ...order.reverse()]) {
        const tab = win.locator('.evtabs [role=tab]').nth(i)
        try {
          await tab.click({ timeout: SHORT_WAIT })
        } catch (e) {
          bad.push(`#${i} ${String(e.message).split('\n')[0].slice(0, 60)}`)
          continue
        }
        await sleep(250)
        const r = await win.evaluate((k) => {
          const list = document.querySelector('.tabsbar').getBoundingClientRect()
          const tabEl = document.querySelectorAll('.evtabs .otab')[k]
          const t = tabEl.getBoundingClientRect()
          const live = document.querySelector('.otab[data-live]')
          const l = live && live !== tabEl ? live.getBoundingClientRect() : null
          const clear = !l || t.right <= l.left + 1 || t.left >= l.right - 1
          return {
            selected: tabEl.hasAttribute('data-selected'),
            listW: Math.round(list.width),
            tw: Math.round(t.width),
            sl: Math.round(document.querySelector('.tabsbar').scrollLeft),
            sw: document.querySelector('.tabsbar').scrollWidth,
            tl: Math.round(t.left - list.left),
            ll: l ? Math.round(l.left - list.left) : null,
            lr: l ? Math.round(l.right - list.left) : null,
            inside: t.left >= list.left - 1 && t.right <= list.right + 1,
            clear
          }
        }, i)
        if (!r.selected || !r.inside || !r.clear) bad.push(`#${i} ${JSON.stringify(r)}`)
      }
      check(
        `every tab is reachable by mouse and scrolled into view at ${w}x${h}`,
        bad.length === 0,
        bad.slice(0, 3).join('; ')
      )
    }
    await setSize(1280, 720)
  })

  // ---- Home with nine events and the guide still showing.
  await phase('home', async () => {
    await setSize(1366, 768)
    await win.click('[data-testid=home-btn]')
    await win.waitForSelector('[data-testid=home]')
    await sleep(500)
    const r = await win.evaluate(() => {
      const e =
        document.querySelector('[data-testid=home-card] .en') ??
        document.querySelector('[data-testid=home-card]')
      if (!e) return null
      const b = e.getBoundingClientRect()
      return { bottom: b.bottom, innerHeight }
    })
    check(
      'first event name is on screen',
      !!r && r.bottom <= r.innerHeight,
      r ? `bottom ${Math.round(r.bottom)} of ${r.innerHeight}` : 'no event card'
    )
  })
} catch (e) {
  failed++
  console.log(
    `FAIL - ${e instanceof FatalSize ? 'window size not applied: ' : 'run aborted: '}${String(e).split('\n')[0]}`
  )
} finally {
  server.close()
  await app.close().catch(() => {})
}

if (pageErrors.length)
  console.log(`note: ${pageErrors.length} page error(s), first: ${pageErrors[0]}`)
console.log(`\nLAYOUT: ${passed} ok, ${failed} FAIL`)
process.exit(failed ? 1 : 0)
