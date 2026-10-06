import { describe, it, expect } from 'vitest'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { orderExportedFiles, importPptx } from './pptx'

describe('orderExportedFiles', () => {
  it('sorts numerically, not lexically', () => {
    expect(orderExportedFiles(['Slide10.PNG', 'Slide2.PNG', 'Slide1.PNG'])).toEqual([
      'Slide1.PNG',
      'Slide2.PNG',
      'Slide10.PNG'
    ])
  })
  it('ignores non-PNG names', () => {
    expect(orderExportedFiles(['Slide2.PNG', 'notes.txt', 'Slide1.png', 'Slide3.jpg'])).toEqual([
      'Slide1.png',
      'Slide2.PNG'
    ])
  })
})

describe.runIf(process.platform === 'win32' && process.env.PPT_E2E === '1')(
  'importPptx (PowerPoint)',
  () => {
    const fx = (n: string): string => path.resolve(__dirname, '../../../fixtures', n)
    const tmp = (): string => fs.mkdtempSync(path.join(os.tmpdir(), 'ppt share e2e '))

    it('imports 4:3 deck with notes', async () => {
      const out = tmp()
      const r = await importPptx(fx('sample-4x3.pptx'), out, 1920)
      expect(r.name).toBe('sample-4x3')
      expect(r.slides).toHaveLength(3)
      expect(r.width).toBe(1920)
      expect(r.height / r.width).toBeCloseTo(0.75, 2)
      expect(r.slides[1].notes).toContain('Catatan slide 2')
      expect(r.slides[0].notes).toBe('')
      for (const s of r.slides) expect(fs.existsSync(s.pngPath)).toBe(true)
    }, 360000)

    it('keeps Slide10 after Slide9 for a 12-slide deck', async () => {
      const out = tmp()
      const r = await importPptx(fx('sample-12.pptx'), out, 1280)
      expect(r.slides).toHaveLength(12)
      expect(r.slides.map((s) => path.basename(s.pngPath))).toEqual(
        Array.from({ length: 12 }, (_, i) => String(i + 1).padStart(3, '0') + '.png')
      )
      expect(r.slides[1].notes).toContain('slide 2')
      expect(r.slides[9].notes).toContain('slide 10')
      expect(r.slides[2].notes).toBe('')
    }, 360000)

    it('reports a missing file in Indonesian', async () => {
      await expect(importPptx(fx('nope.pptx'), tmp(), 1920)).rejects.toThrow(/tidak ditemukan/i)
    }, 60000)
  }
)

describe.runIf(process.platform === 'win32' && process.env.PPT_E2E === '1')(
  'importPptx when the same file is already open',
  () => {
    const ps = (script: string, ...args: string[]): string => {
      const f = path.join(os.tmpdir(), 'ppt-share-test-helper-' + process.pid + '.ps1')
      fs.writeFileSync(f, script)
      try {
        return execFileSync(
          'powershell.exe',
          ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', f, ...args],
          { encoding: 'utf8' }
        ).trim()
      } finally {
        fs.rmSync(f, { force: true })
      }
    }
    const getApp =
      '$a=[Runtime.InteropServices.Marshal]::GetActiveObject("PowerPoint.Application");'
    const tempCopies = (): string[] =>
      fs.readdirSync(os.tmpdir()).filter((n) => /^ppt-share-[0-9a-f]{32}\.pptx$/.test(n))

    it('imports and leaves the already-open presentation open, no temp leftovers', async () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ppt share own '))
      const mine = path.join(dir, 'mine.pptx')
      fs.copyFileSync(path.resolve(__dirname, '../../../fixtures/sample-4x3.pptx'), mine)
      const leftoversBefore = tempCopies()
      const countOpen = `${getApp} $a.Presentations.Count`
      const namesOpen = `${getApp} ($a.Presentations | ForEach-Object { $_.FullName }) -join '|'`
      let opened = false
      try {
        const countBefore = Number(ps(countOpen)) // may throw if PowerPoint is not running; fine
        ps(
          `$p=New-Object -ComObject PowerPoint.Application; $null=$p.Presentations.Open($args[0],0,0,-1)`,
          mine
        )
        opened = true
        expect(Number(ps(countOpen))).toBe(countBefore + 1)
        const r = await importPptx(mine, path.join(dir, 'out'), 800)
        expect(r.slides).toHaveLength(3)
        expect(Number(ps(countOpen))).toBe(countBefore + 1)
        expect(ps(namesOpen).toLowerCase()).toContain(mine.toLowerCase())
        expect(tempCopies()).toEqual(leftoversBefore)
      } finally {
        if (opened) {
          // close only our own copy, matched by exact FullName
          ps(
            `${getApp} foreach($x in @($a.Presentations)){ if($x.FullName -ieq $args[0]){ $x.Saved=-1; $x.Close() } }`,
            mine
          )
        }
        fs.rmSync(dir, { recursive: true, force: true })
      }
    }, 360000)

    it('cleans the temp copy when the script fails', async () => {
      const before = tempCopies()
      const bad = path.join(os.tmpdir(), 'ppt share bad.pptx')
      fs.writeFileSync(bad, 'junk')
      try {
        await expect(
          importPptx(bad, fs.mkdtempSync(path.join(os.tmpdir(), 'ppt share o ')), 800)
        ).rejects.toThrow(/Tidak bisa membuka file/)
      } finally {
        fs.rmSync(bad, { force: true })
      }
      expect(tempCopies()).toEqual(before)
    }, 120000)
  }
)
