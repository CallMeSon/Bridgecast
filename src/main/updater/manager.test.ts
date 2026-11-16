import { describe, expect, it } from 'vitest'
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
    const { manager, engine, statuses } = makeManager()
    engine.checkResult = available
    await manager.check()
    expect(statuses.map((s) => s.kind)).toEqual(['checking', 'available'])
    expect(manager.status).toEqual({ kind: 'available', version: '1.2.0', notes: 'Notes' })
  })

  it('returns to idle silently when the engine throws', async () => {
    const { manager, engine, statuses } = makeManager()
    engine.checkError = new Error('offline')
    await manager.check()
    expect(statuses.map((s) => s.kind)).toEqual(['checking', 'idle'])
    expect(manager.status).toEqual({ kind: 'idle' })
  })

  it('ignores a version equal to or older than current', async () => {
    for (const version of ['1.1.0', '1.0.9']) {
      const { manager, engine } = makeManager()
      engine.checkResult = { version, notes: '' }
      await manager.check()
      expect(manager.status).toEqual({ kind: 'idle' })
    }
  })

  it('never offers a pre-release even when it is newer than current', async () => {
    const { manager, engine } = makeManager()
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
    const skippedCheck = makeManager({ getSkipped: () => '1.2.0' })
    skippedCheck.engine.checkResult = available
    await skippedCheck.manager.check()
    expect(skippedCheck.manager.status).toEqual({ kind: 'idle' })

    const newerCheck = makeManager({ getSkipped: () => '1.2.0' })
    newerCheck.engine.checkResult = { version: '1.2.1', notes: 'More' }
    await newerCheck.manager.check()
    expect(newerCheck.manager.status).toEqual({
      kind: 'available',
      version: '1.2.1',
      notes: 'More'
    })
  })

  it('is ignored while downloading or ready (no engine call)', async () => {
    const { manager, engine } = makeManager()
    engine.checkResult = available
    await manager.check()
    engine.progressToReport = [40]
    engine.downloadError = new Error('boom')
    await manager.download()
    expect(manager.status.kind).toBe('error')
    // error is not a blocked state; but downloading/ready are:
    const busy = makeManager()
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

    const downloading = makeManager()
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
})

describe('UpdateManager.skip', () => {
  it('records the skipped version and returns to idle', async () => {
    const calls: (string | null)[] = []
    const { manager, engine } = makeManager({
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
    const { manager, engine } = makeManager()
    await manager.download()
    expect(engine.downloadCalls).toBe(0)
    expect(manager.status).toEqual({ kind: 'idle' })
  })

  it('reports progress and reaches ready on success', async () => {
    const { manager, engine, statuses } = makeManager()
    engine.checkResult = available
    await manager.check()
    engine.progressToReport = [40, 100]
    await manager.download()
    expect(statuses).toContainEqual({ kind: 'downloading', version: '1.2.0', percent: 40 })
    expect(statuses).toContainEqual({ kind: 'downloading', version: '1.2.0', percent: 100 })
    expect(manager.status).toEqual({ kind: 'ready', version: '1.2.0' })
  })

  it('enters error with a short fixed message when the engine rejects, and can retry', async () => {
    const { manager, engine, statuses } = makeManager()
    engine.checkResult = available
    await manager.check()
    engine.downloadError = new Error('sha mismatch: secret internals')
    await manager.download()
    expect(manager.status).toEqual({
      kind: 'error',
      version: '1.2.0',
      message: 'Download failed. Check your connection and try again.'
    })
    expect(statuses.some((s) => s.kind === 'error' && s.message.includes('secret'))).toBe(false)

    engine.downloadError = null
    engine.progressToReport = [100]
    await manager.download()
    expect(manager.status).toEqual({ kind: 'ready', version: '1.2.0' })
  })
})

describe('UpdateManager.install', () => {
  async function readyManager(isOnAir: () => boolean): Promise<TestContext> {
    const recorded = makeManager({ isOnAir })
    recorded.engine.checkResult = available
    await recorded.manager.check()
    await recorded.manager.download()
    expect(recorded.manager.status.kind).toBe('ready')
    return recorded
  }

  it('returns false and does not quit while on air', async () => {
    const { manager, engine } = await readyManager(() => true)
    expect(manager.install()).toBe(false)
    expect(engine.quitAndInstallCalls).toBe(0)
  })

  it('returns false when not ready', async () => {
    const { manager, engine } = makeManager()
    expect(manager.install()).toBe(false)
    engine.checkResult = available
    await manager.check()
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
