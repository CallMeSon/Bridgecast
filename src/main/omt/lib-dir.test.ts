import { afterEach, describe, expect, it, vi } from 'vitest'

const electron = vi.hoisted(() => ({ app: { isPackaged: false } }))
vi.mock('electron', () => electron)

import { libomtDir } from './lib-dir'

describe('libomtDir', () => {
  afterEach(() => {
    delete process.env.PPT_LIBOMT_DIR
    electron.app.isPackaged = false
  })

  it('honours PPT_LIBOMT_DIR when not packaged', () => {
    process.env.PPT_LIBOMT_DIR = '/opt/omt'
    expect(libomtDir()).toBe('/opt/omt')
  })

  it('ignores PPT_LIBOMT_DIR when packaged', () => {
    process.env.PPT_LIBOMT_DIR = '/opt/omt'
    electron.app.isPackaged = true
    const prev = (process as { resourcesPath?: string }).resourcesPath
    ;(process as { resourcesPath?: string }).resourcesPath = '/res'
    try {
      expect(libomtDir().replace(/\\/g, '/')).toBe('/res/omt')
    } finally {
      ;(process as { resourcesPath?: string }).resourcesPath = prev
    }
  })
})
