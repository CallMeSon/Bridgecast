import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { importPptxLibreOffice } from '../../src/main/import/libreoffice'
import { LibreOfficeEngine, loBridgePath } from '../../src/main/slideshow/libreoffice-engine'
import type { EnginePosition } from '../../src/main/slideshow/engine'

const has = (cmd: string): boolean => {
  try {
    execFileSync(cmd, ['--version'], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}
// Needs LibreOffice Impress with python3-uno and an X11 display (xvfb-run is fine).
const hasSoffice =
  process.platform === 'linux' && has('soffice') && has('python3') && !!process.env.DISPLAY

const root = path.resolve(__dirname, '../..')
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pptshare-lo-'))
const engine = new LibreOfficeEngine({
  script: loBridgePath({ packaged: false, resourcesPath: '', appPath: root }),
  profile: path.join(tmp, 'profile')
})
afterAll(async () => {
  await engine.shutdown()
  fs.rmSync(tmp, { recursive: true, force: true })
})

const importFixture = (name: string) =>
  importPptxLibreOffice(
    path.join(root, 'fixtures', name),
    fs.mkdtempSync(path.join(tmp, 'out-')),
    1280,
    { format: 'original' },
    {
      bridgeImport: (req) => engine.importDeck(req),
      installedFonts: async () => []
    }
  )

describe.skipIf(!hasSoffice)('LibreOffice engine (real soffice)', () => {
  it('imports the animated fixture with click counts', async () => {
    const d = await importFixture('sample-anim.pptx')
    expect(d.slides.length).toBeGreaterThan(0)
    expect(d.slides.some((s) => s.clicks > 0)).toBe(true)
    expect(d.isStatic).toBe(false)
  }, 180_000)

  it('imports the static 4:3 fixture', async () => {
    const d = await importFixture('sample-4x3.pptx')
    expect(d.slides.length).toBeGreaterThan(0)
    expect(d.width / d.height).toBeCloseTo(4 / 3, 1)
  }, 180_000)

  it('opens, steps, closes, and ping fails cleanly after shutdown', async () => {
    const positions: EnginePosition[] = []
    engine.on('position', (p) => positions.push(p))
    const file = path.join(root, 'fixtures', 'sample-anim.pptx')
    const session = await engine.open('11111111-1111-4111-8111-111111111111', file, {
      width: 1280,
      height: 720
    })
    expect(session.windowId).toBeTruthy()
    await session.next()
    await session.next()
    expect(positions.length).toBeGreaterThan(0)
    await session.close()
    await engine.shutdown()
    // No bridge running: ping is a no-op, it must not hang or throw.
    await expect(engine.ping()).resolves.toBeUndefined()
  }, 240_000)
})
