import { describe, expect, it, vi } from 'vitest'
import type { UpdateStatus } from '../../shared/update'
import { UpdateManager, type UpdateEngine, type UpdateManagerDeps } from './manager'

class FakeEngine implements UpdateEngine {
  checkResult: { version: string; notes: string } | null = null
  checkError: Error | null = null
  checkCalls = 0
  downloadError: Error | null = null
  downloadCalls = 0
  quitAndInstallCalls = 0
  progressToReport: number[] = []

  async check(): Promise<{ version: string; notes: string } | null> {
    this.checkCalls += 1
    if (this.checkError) throw this.checkError
    return this.checkResult
  }

  async download(onProgress: (percent: number) => void): Promise<void> {
    this.downloadCalls += 1
    for (const percent of this.progressToReport) onProgress(percent)
    if (this.downloadError) throw this.downloadError
  }

  quitAndInstall(): void {
    this.quitAndInstallCalls += 1
  }

  installOnQuit: boolean | null = null

  setInstallOnQuit(enabled: boolean): void {
    this.installOnQuit = enabled
  }
}

type Recorded = { deps: UpdateManagerDeps; engine: FakeEngine; statuses: UpdateStatus[] }
type TestContext = Recorded & { manager: UpdateManager }

function makeManager(overrides: Partial<UpdateManagerDeps> = {}): TestContext {
  const engine = new FakeEngine()
  const statuses: UpdateStatus[] = []
  let skipped: string | null = null
  const deps: UpdateManagerDeps = {
    engine,
    currentVersion: '1.1.0',
    getSkipped: () => skipped,
    setSkipped: (version: string | null) => {
      skipped = version
    },
    isOnAir: () => false,
    onStatus: (status: UpdateStatus) => {
      statuses.push(status)
    },
    ...overrides
  }
  const manager = new UpdateManager(deps)
  return { manager, deps, engine, statuses }
}

const available = { version: '1.2.0', notes: 'Notes' }

describe('UpdateManager.check', () => {
  it('reports checking then available when a newer version exists', async () => {
    const { manager, engine, statuses } = makeManager({ isOnAir: () => true })
    engine.checkResult = available
    await manager.check()
    expect(statuses.map((s) => s.kind)).toEqual(['checking', 'available'])
    expect(manager.status).toEqual({ kind: 'available', version: '1.2.0', notes: 'Notes' })
  })

  it('returns to idle silently when the engine throws', async () => {
    const { manager, engine, statuses } = makeManager({ isOnAir: () => true })
    engine.checkError = new Error('offline')
    await manager.check()
    expect(statuses.map((s) => s.kind)).toEqual(['checking', 'idle'])
    expect(manager.status).toEqual({ kind: 'idle', checkFailed: true })
  })

  it('ignores a version equal to or older than current', async () => {
    for (const version of ['1.1.0', '1.0.9']) {
      const { manager, engine } = makeManager({ isOnAir: () => true })
      engine.checkResult = { version, notes: '' }
      await manager.check()
      expect(manager.status).toEqual({ kind: 'idle' })
    }
  })

  it('never offers a pre-release even when it is newer than current', async () => {
    const { manager, engine } = makeManager({ isOnAir: () => true })
    engine.checkResult = { version: '1.2.0-beta.1', notes: '' }
    await manager.check()
    expect(manager.status).toEqual({ kind: 'idle' })
  })

  it('never offers 1.2.0-beta.1 when current is 1.2.0', async () => {
    const { manager, engine } = makeManager({ currentVersion: '1.2.0' })
    engine.checkResult = { version: '1.2.0-beta.1', notes: '' }
    await manager.check()
    expect(manager.status).toEqual({ kind: 'idle' })
  })

  it('hides a skipped version but announces a newer one', async () => {
    const skippedCheck = makeManager({ getSkipped: () => '1.2.0', isOnAir: () => true })
    skippedCheck.engine.checkResult = available
    await skippedCheck.manager.check()
    expect(skippedCheck.manager.status).toEqual({ kind: 'idle' })

    const newerCheck = makeManager({ getSkipped: () => '1.2.0', isOnAir: () => true })
    newerCheck.engine.checkResult = { version: '1.2.1', notes: 'More' }
    await newerCheck.manager.check()
    expect(newerCheck.manager.status).toEqual({
      kind: 'available',
      version: '1.2.1',
      notes: 'More'
    })
  })

  it('is ignored while downloading or ready (no engine call)', async () => {
    const { manager, engine } = makeManager({ isOnAir: () => true })
    engine.checkResult = available
    await manager.check()
    engine.progressToReport = [40]
    engine.downloadError = new Error('boom')
    await manager.download()
    expect(manager.status.kind).toBe('error')
    // error is not a blocked state; but downloading/ready are:
    const busy = makeManager({ isOnAir: () => true })
    busy.engine.checkResult = available
    await busy.manager.check()
    busy.engine.downloadError = null
    busy.engine.progressToReport = []
    await busy.manager.download()
    expect(busy.manager.status.kind).toBe('ready')
    const callsBefore = busy.engine.checkCalls
    await busy.manager.check()
    expect(busy.engine.checkCalls).toBe(callsBefore)
    expect(busy.manager.status.kind).toBe('ready')

    const downloading = makeManager({ isOnAir: () => true })
    downloading.engine.checkResult = available
    await downloading.manager.check()
    // simulate being stuck in downloading by starting a download whose progress keeps it there
    let release: (() => void) | null = null
    const blocking = new Promise<void>((resolve) => {
      release = resolve
    })
    const engine2 = downloading.engine
    const originalDownload = engine2.download.bind(engine2)
    engine2.download = async (onProgress: (percent: number) => void) => {
      onProgress(25)
      await blocking
      return originalDownload(onProgress)
    }
    const downloadPromise = downloading.manager.download()
    await downloading.manager.check() // ignored: downloading
    expect(engine2.checkCalls).toBe(1)
    release!()
    await downloadPromise
    expect(downloading.manager.status.kind).toBe('ready')
  })

  it('is ignored while available (no engine call, status stays available)', async () => {
    const { manager, engine, statuses } = makeManager({ isOnAir: () => true })
    engine.checkResult = available
    await manager.check()
    expect(manager.status).toEqual({ kind: 'available', version: '1.2.0', notes: 'Notes' })
    const callsBefore = engine.checkCalls
    const statusesBefore = statuses.length
    await manager.check()
    expect(engine.checkCalls).toBe(callsBefore)
    expect(statuses.length).toBe(statusesBefore)
    expect(manager.status).toEqual({ kind: 'available', version: '1.2.0', notes: 'Notes' })
    // skip() still works after the periodic check
    manager.skip()
    expect(manager.status).toEqual({ kind: 'idle' })
  })

  it('logs nothing through console.warn or console.error when a check fails', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      const { manager, engine } = makeManager({ isOnAir: () => true })
      engine.checkError = new Error('offline: secret internals')
      await manager.check()
      expect(manager.status).toEqual({ kind: 'idle', checkFailed: true })
      expect(warn).not.toHaveBeenCalled()
      expect(error).not.toHaveBeenCalled()
    } finally {
      warn.mockRestore()
      error.mockRestore()
    }
  })
})

describe('UpdateManager.check after a failed download', () => {
  async function failed(): Promise<TestContext> {
    const context = makeManager({ isOnAir: () => true })
    context.engine.checkResult = available
    await context.manager.check()
    context.engine.downloadError = new Error('boom')
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      await context.manager.download()
    } finally {
      warn.mockRestore()
    }
    expect(context.manager.status.kind).toBe('error')
    return context
  }

  it('keeps the version and Try again when the check fails or finds the same version', async () => {
    const { manager, engine, statuses } = await failed()
    const before = statuses.length
    engine.checkError = new Error('offline')
    await manager.check()
    engine.checkError = null
    engine.checkResult = null
    await manager.check()
    engine.checkResult = available
    await manager.check()
    expect(manager.status.kind).toBe('error')
    expect(statuses.length).toBe(before)
  })

  it('announces a newer version found after a failed download', async () => {
    const { manager, engine } = await failed()
    engine.checkResult = { version: '1.3.0', notes: 'Newer' }
    await manager.check()
    expect(manager.status).toEqual({ kind: 'available', version: '1.3.0', notes: 'Newer' })
  })
})

describe('UpdateManager manual check', () => {
  it('brings a skipped version back and downloads it; a scheduled check does not', async () => {
    const calls: (string | null)[] = []
    let skipped: string | null = '1.2.0'
    const { manager, engine } = makeManager({
      getSkipped: () => skipped,
      setSkipped: (v) => {
        calls.push(v)
        skipped = v
      }
    })
    engine.checkResult = available
    await manager.check()
    expect(manager.status).toEqual({ kind: 'idle' })
    expect(calls).toEqual([])
    await manager.check({ manual: true })
    expect(calls).toEqual([null])
    await vi.waitFor(() => expect(manager.status.kind).toBe('ready'))
    expect(engine.downloadCalls).toBe(1)
  })

  it('stays ready when a manual check runs after the download', async () => {
    const { manager, engine } = makeManager()
    engine.checkResult = available
    await manager.check()
    await vi.waitFor(() => expect(manager.status.kind).toBe('ready'))
    await manager.check({ manual: true })
    expect(manager.status).toEqual({ kind: 'ready', version: '1.2.0', notes: 'Notes' })
    expect(engine.checkCalls).toBe(1)
  })
})

describe('UpdateManager.skip', () => {
  it('records the skipped version and returns to idle', async () => {
    const calls: (string | null)[] = []
    const { manager, engine } = makeManager({
      isOnAir: () => true,
      setSkipped: (version) => {
        calls.push(version)
      }
    })
    engine.checkResult = available
    await manager.check()
    manager.skip()
    expect(calls).toEqual(['1.2.0'])
    expect(manager.status).toEqual({ kind: 'idle' })
  })
})

describe('UpdateManager.download', () => {
  it('only works from available', async () => {
    const { manager, engine } = makeManager({ isOnAir: () => true })
    await manager.download()
    expect(engine.downloadCalls).toBe(0)
    expect(manager.status).toEqual({ kind: 'idle' })
  })

  it('reports progress and reaches ready on success', async () => {
    const { manager, engine, statuses } = makeManager({ isOnAir: () => true })
    engine.checkResult = available
    await manager.check()
    engine.progressToReport = [40, 100]
    await manager.download()
    expect(statuses).toContainEqual({
      kind: 'downloading',
      version: '1.2.0',
      notes: 'Notes',
      percent: 40
    })
    expect(statuses).toContainEqual({
      kind: 'downloading',
      version: '1.2.0',
      notes: 'Notes',
      percent: 100
    })
    expect(manager.status).toEqual({ kind: 'ready', version: '1.2.0', notes: 'Notes' })
  })

  it('enters error with a short fixed message when the engine rejects, and can retry', async () => {
    const { manager, engine, statuses } = makeManager({ isOnAir: () => true })
    engine.checkResult = available
    await manager.check()
    engine.downloadError = new Error('sha mismatch: secret internals')
    await manager.download()
    expect(manager.status).toEqual({
      kind: 'error',
      version: '1.2.0',
      notes: 'Notes',
      message: 'Download failed. Check your connection and try again.'
    })
    expect(statuses.some((s) => s.kind === 'error' && s.message.includes('secret'))).toBe(false)

    engine.downloadError = null
    engine.progressToReport = [100]
    await manager.download()
    expect(manager.status).toEqual({ kind: 'ready', version: '1.2.0', notes: 'Notes' })
  })
})

describe('UpdateManager.install', () => {
  /** Downloads during a show (manual), then sets the on-air state the test asks for. */
  async function readyManager(isOnAir: () => boolean): Promise<TestContext> {
    let downloaded = false
    const recorded = makeManager({ isOnAir: () => (downloaded ? isOnAir() : true) })
    recorded.engine.checkResult = available
    await recorded.manager.check()
    await recorded.manager.download()
    downloaded = true
    expect(recorded.manager.status.kind).toBe('ready')
    return recorded
  }

  it('returns false and does not quit while on air', async () => {
    const { manager, engine } = await readyManager(() => true)
    expect(manager.install()).toBe(false)
    expect(engine.quitAndInstallCalls).toBe(0)
  })

  it('returns false when not ready', async () => {
    let onAir = true
    const { manager, engine } = makeManager({ isOnAir: () => onAir })
    expect(manager.install()).toBe(false)
    engine.checkResult = available
    await manager.check()
    onAir = false
    expect(manager.status.kind).toBe('available')
    expect(manager.install()).toBe(false)
    expect(engine.quitAndInstallCalls).toBe(0)
  })

  it('quits and installs once when ready and off air; a second call returns false', async () => {
    const { manager, engine } = await readyManager(() => false)
    expect(manager.install()).toBe(true)
    expect(engine.quitAndInstallCalls).toBe(1)
    expect(manager.install()).toBe(false)
    expect(engine.quitAndInstallCalls).toBe(1)
  })
})

describe('UpdateManager automatic download', () => {
  it('downloads a newer version by itself when nothing is on air', async () => {
    const { manager, engine, statuses } = makeManager()
    engine.checkResult = available
    await manager.check()
    await vi.waitFor(() => expect(manager.status.kind).toBe('ready'))
    expect(engine.downloadCalls).toBe(1)
    expect(statuses.map((s) => s.kind)).toEqual(['checking', 'available', 'downloading', 'ready'])
  })

  it('waits while on air and starts once the Program is off air', async () => {
    let onAir = true
    const { manager, engine } = makeManager({ isOnAir: () => onAir })
    engine.checkResult = available
    await manager.check()
    manager.autoDownload()
    expect(engine.downloadCalls).toBe(0)
    expect(manager.status.kind).toBe('available')
    onAir = false
    manager.autoDownload()
    manager.autoDownload()
    await vi.waitFor(() => expect(manager.status.kind).toBe('ready'))
    expect(engine.downloadCalls).toBe(1)
  })

  it('retries from a periodic check when the version is still only available', async () => {
    let onAir = true
    const { manager, engine } = makeManager({ isOnAir: () => onAir })
    engine.checkResult = available
    await manager.check()
    onAir = false
    await manager.check()
    await vi.waitFor(() => expect(manager.status.kind).toBe('ready'))
    expect(engine.checkCalls).toBe(1)
  })

  it('never downloads a skipped version and does not retry a failed download by itself', async () => {
    const skipped = makeManager({ getSkipped: () => '1.2.0' })
    skipped.engine.checkResult = available
    await skipped.manager.check()
    skipped.manager.autoDownload()
    expect(skipped.engine.downloadCalls).toBe(0)

    const failing = makeManager()
    failing.engine.checkResult = available
    failing.engine.downloadError = new Error('boom')
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      await failing.manager.check()
      await vi.waitFor(() => expect(failing.manager.status.kind).toBe('error'))
      failing.manager.autoDownload()
      expect(failing.engine.downloadCalls).toBe(1)
    } finally {
      warn.mockRestore()
    }
  })
})

describe('UpdateManager.prepareQuit', () => {
  async function ready(onAir: { value: boolean }): Promise<TestContext> {
    const recorded = makeManager({ isOnAir: () => onAir.value })
    recorded.engine.checkResult = available
    await recorded.manager.check()
    await vi.waitFor(() => expect(recorded.manager.status.kind).toBe('ready'))
    return recorded
  }

  it('installs on quit when an update is downloaded and nothing is on air', async () => {
    const { manager, engine } = await ready({ value: false })
    expect(manager.prepareQuit()).toBe(true)
    expect(engine.installOnQuit).toBe(true)
  })

  it('does not install on quit while something is on air', async () => {
    const onAir = { value: false }
    const { manager, engine } = await ready(onAir)
    onAir.value = true
    expect(manager.prepareQuit()).toBe(false)
    expect(engine.installOnQuit).toBe(false)
  })

  it('does not install on quit before a download finished', async () => {
    const { manager, engine } = makeManager({ isOnAir: () => true })
    expect(manager.prepareQuit()).toBe(false)
    engine.checkResult = available
    await manager.check()
    expect(manager.prepareQuit()).toBe(false)
    expect(engine.installOnQuit).toBe(false)
  })

  it('does not install a version skipped after its download', async () => {
    const calls: (string | null)[] = []
    const { manager, engine } = await ready({ value: false })
    const skipping = makeManager({ setSkipped: (v) => calls.push(v) })
    skipping.engine.checkResult = available
    await skipping.manager.check()
    await vi.waitFor(() => expect(skipping.manager.status.kind).toBe('ready'))
    skipping.manager.skip()
    expect(calls).toEqual(['1.2.0'])
    expect(skipping.manager.status).toEqual({ kind: 'idle' })
    expect(skipping.manager.prepareQuit()).toBe(false)
    expect(skipping.engine.installOnQuit).toBe(false)
    expect(manager.prepareQuit()).toBe(true)
    expect(engine.installOnQuit).toBe(true)
  })

  it('leaves the quit alone after Restart and install was used', async () => {
    const { manager, engine } = await ready({ value: false })
    expect(manager.install()).toBe(true)
    expect(manager.prepareQuit()).toBe(false)
    expect(engine.installOnQuit).toBe(false)
  })
})
