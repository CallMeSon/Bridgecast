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
    expect((await importPptx('/a.pptx', '/o', 1920, { env: e })).name).toBe('d')
    expect(e.powerPoint).toHaveBeenCalledWith('/a.pptx', '/o', 1920)
    expect(e.libreOffice).not.toHaveBeenCalled()
  })

  it('uses LibreOffice with the saved format on the libreoffice engine', async () => {
    const e = env({ engine: 'libreoffice' }, 'original')
    expect((await importPptx('/a.pptx', '/o', 1920, { env: e })).name).toBe('lo')
    expect(e.libreOffice).toHaveBeenCalledWith('/a.pptx', '/o', 1920, { format: 'original' })
    expect(e.powerPoint).not.toHaveBeenCalled()
  })

  it('converts to odp by default and reads the setting at the time of each import', async () => {
    let format: 'odp' | 'original' = 'odp'
    const e = { ...env({ engine: 'libreoffice' }), format: () => format }
    await importPptx('/a.pptx', '/o', 1920, { env: e })
    format = 'original'
    await importPptx('/b.ppt', '/o', 1920, { env: e })
    expect(vi.mocked(e.libreOffice).mock.calls.map((c) => c[3])).toEqual([
      { format: 'odp' },
      { format: 'original' }
    ])
  })

  it('keeps the format of an edit re-export whatever the setting says', async () => {
    const e = env({ engine: 'libreoffice' }, 'odp')
    await importPptx('/deck/edit.pptx', '/o', 1920, { env: e, keepFormat: true })
    expect(e.libreOffice).toHaveBeenCalledWith('/deck/edit.pptx', '/o', 1920, {
      format: 'original'
    })
  })

  it('throws the install copy when there is no engine', async () => {
    const e = env({ engine: 'none', message: INSTALL_LIBREOFFICE })
    await expect(importPptx('/a.pptx', '/o', 1920, { env: e })).rejects.toThrow(INSTALL_LIBREOFFICE)
    expect(e.powerPoint).not.toHaveBeenCalled()
    expect(e.libreOffice).not.toHaveBeenCalled()
  })
})
