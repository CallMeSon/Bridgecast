import { describe, expect, it, vi } from 'vitest'
import { importPptxLibreOffice, parseBridgeImport, type LibreOfficeDeps } from './libreoffice'

const reply = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  name: 'deck',
  width: 1920,
  height: 1080,
  pdf: '/out/source.pdf',
  pngs: ['/out/001.png', '/out/002.png'],
  notes: ['a', 'b'],
  clicks: [3, 0],
  hidden: [false, true],
  isStatic: false,
  fonts: ['Calibri', 'Arial'],
  source: '/out/deck.odp',
  ...over
})

const deps = (r: Record<string, unknown>, installed = ['Arial']): LibreOfficeDeps => ({
  bridgeImport: vi.fn(async () => r),
  installedFonts: vi.fn(async () => installed)
})

describe('parseBridgeImport', () => {
  it('pads or cuts the per-slide arrays to the number of images and fixes bad values', () => {
    const r = parseBridgeImport(
      reply({ notes: ['x'], clicks: [2, -1, 9], hidden: [true, 'yes'], pngs: ['/1.png', '/2.png'] })
    )
    expect(r.notes).toEqual(['x', ''])
    expect(r.clicks).toEqual([2, 0])
    expect(r.hidden).toEqual([true, false])
  })

  it('refuses a result without slide images or without a source file', () => {
    expect(() => parseBridgeImport(reply({ pngs: [] }))).toThrow(/No slides were exported/)
    expect(() => parseBridgeImport(reply({ source: '' }))).toThrow(/could not be read/)
  })
})

describe('importPptxLibreOffice', () => {
  it('odp: the converted file is the working copy, the imported file stays the original', async () => {
    const d = deps(reply())
    const out = await importPptxLibreOffice('/in/deck.pptx', '/out', 1920, { format: 'odp' }, d)
    expect(d.bridgeImport).toHaveBeenCalledWith({
      path: '/in/deck.pptx',
      outDir: '/out',
      width: 1920,
      format: 'odp'
    })
    expect(out.sourcePath).toBe('/out/deck.odp')
    expect(out.originalPath).toBe('/in/deck.pptx')
    expect(out.converted).toBe(true)
    expect(out.name).toBe('deck')
    expect(out.slides.map((s) => [s.clicks, s.hidden, s.notes])).toEqual([
      [3, false, 'a'],
      [0, true, 'b']
    ])
    expect(out.pdfPath).toBe('/out/source.pdf')
  })

  it('original: the imported file is the working copy and nothing is marked converted', async () => {
    const d = deps(reply({ source: '/in/deck.pptx' }))
    const out = await importPptxLibreOffice(
      '/in/deck.pptx',
      '/out',
      1920,
      { format: 'original' },
      d
    )
    expect(out.sourcePath).toBe('/in/deck.pptx')
    expect(out.originalPath).toBeUndefined()
    expect(out.converted).toBeUndefined()
  })

  it('never asks for a conversion of a file that is already .odp', async () => {
    const d = deps(reply({ source: '/in/edit.odp' }))
    const out = await importPptxLibreOffice('/in/edit.odp', '/out', 1920, { format: 'odp' }, d)
    expect(vi.mocked(d.bridgeImport).mock.calls[0][0].format).toBe('original')
    expect(out.converted).toBeUndefined()
  })

  it('lists the missing fonts once in the warning', async () => {
    const d = deps(reply({ fonts: ['Calibri', 'calibri', 'Segoe UI', 'Arial'] }))
    const out = await importPptxLibreOffice('/in/deck.pptx', '/out', 1920, { format: 'odp' }, d)
    expect(out.warning).toBe(
      'This deck uses fonts that are not installed: Calibri, Segoe UI. The layout may shift. Install them, or the metric-compatible Carlito, Caladea or Liberation fonts.'
    )
  })

  it('has no warning when every font is installed, and skips fc-list for a .ppt (no fonts)', async () => {
    const d = deps(reply({ fonts: [] }))
    const out = await importPptxLibreOffice('/in/old.ppt', '/out', 1920, { format: 'odp' }, d)
    expect(out.warning).toBeUndefined()
    expect(d.installedFonts).not.toHaveBeenCalled()
  })

  it('passes the failure of LibreOffice on (the bridge message is the operator copy)', async () => {
    const d: LibreOfficeDeps = {
      bridgeImport: vi.fn(async () => {
        throw new Error(
          'LibreOffice could not open this file. Open it in LibreOffice to check it, or export it to PDF and import the PDF.'
        )
      }),
      installedFonts: vi.fn(async () => [])
    }
    await expect(
      importPptxLibreOffice('/in/deck.pptx', '/out', 1920, { format: 'odp' }, d)
    ).rejects.toThrow(/LibreOffice could not open this file/)
  })
})
