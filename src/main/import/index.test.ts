import { describe, expect, it, vi } from 'vitest'
import { importPptx, type ImportEnv } from './index'
import { INSTALL_LIBREOFFICE } from '../platform'

const deck = {
  name: 'd',
  width: 1,
  height: 1,
  slides: [],
  pdfPath: '',
  isStatic: true,
  sourcePath: '/x.pptx'
}

function env(engine: ImportEnv['engine'], format: 'odp' | 'original' = 'odp'): ImportEnv {
  return {
    engine,
    format: () => format,
    powerPoint: vi.fn(async () => deck),
    libreOffice: vi.fn(async () => ({ ...deck, name: 'lo' }))
  }
}

describe('importPptx dispatch', () => {
  it('uses PowerPoint on the powerpoint engine', async () => {
    const e = env({ engine: 'powerpoint' })
    expect((await importPptx('/a.pptx', '/o', 1920, e)).name).toBe('d')
    expect(e.powerPoint).toHaveBeenCalledWith('/a.pptx', '/o', 1920)
    expect(e.libreOffice).not.toHaveBeenCalled()
  })

  it('uses LibreOffice with the chosen format on the libreoffice engine', async () => {
    const e = env({ engine: 'libreoffice' }, 'original')
    expect((await importPptx('/a.pptx', '/o', 1920, e)).name).toBe('lo')
    expect(e.libreOffice).toHaveBeenCalledWith('/a.pptx', '/o', 1920, { format: 'original' })
    expect(e.powerPoint).not.toHaveBeenCalled()
  })

  it('throws the install copy when there is no engine', async () => {
    const e = env({ engine: 'none', message: INSTALL_LIBREOFFICE })
    await expect(importPptx('/a.pptx', '/o', 1920, e)).rejects.toThrow(INSTALL_LIBREOFFICE)
    expect(e.powerPoint).not.toHaveBeenCalled()
    expect(e.libreOffice).not.toHaveBeenCalled()
  })
})
