import { describe, it, expect } from 'vitest'
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
