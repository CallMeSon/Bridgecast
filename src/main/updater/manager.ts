import { isNewerVersion, type UpdateStatus } from '../../shared/update'

export interface UpdateEngine {
  check(): Promise<{ version: string; notes: string } | null>
  download(onProgress: (percent: number) => void): Promise<void>
  quitAndInstall(): void
}

export interface UpdateManagerDeps {
  engine: UpdateEngine
  currentVersion: string
  getSkipped(): string | null
  setSkipped(version: string | null): void
  isOnAir(): boolean
  onStatus(status: UpdateStatus): void
}

const DOWNLOAD_FAILED_MESSAGE = 'Download failed. Check your connection and try again.'

function isPrerelease(version: string): boolean {
  const match = /^v?\d+\.\d+\.\d+-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)/.exec(version.trim())
  return match !== null
}

export class UpdateManager {
  private readonly deps: UpdateManagerDeps
  private current: UpdateStatus = { kind: 'idle' }
  private installed = false

  constructor(deps: UpdateManagerDeps) {
    this.deps = deps
  }

  get status(): UpdateStatus {
    return this.current
  }

  private set(status: UpdateStatus): void {
    this.current = status
    this.deps.onStatus(status)
  }

  async check(): Promise<void> {
    if (
      this.current.kind === 'available' ||
      this.current.kind === 'downloading' ||
      this.current.kind === 'ready'
    ) {
      return
    }
    this.set({ kind: 'checking' })
    let result: { version: string; notes: string } | null
    try {
      result = await this.deps.engine.check()
    } catch (error) {
      console.info('[update] check failed:', error)
      this.set({ kind: 'idle' })
      return
    }
    if (!result) {
      this.set({ kind: 'idle' })
      return
    }
    if (isPrerelease(result.version) || !isNewerVersion(result.version, this.deps.currentVersion)) {
      this.set({ kind: 'idle' })
      return
    }
    if (this.deps.getSkipped() === result.version) {
      this.set({ kind: 'idle' })
      return
    }
    this.set({ kind: 'available', version: result.version, notes: result.notes })
  }

  async download(): Promise<void> {
    const start = this.current
    const fromAvailable = start.kind === 'available'
    const fromError = start.kind === 'error'
    if (!fromAvailable && !fromError) return
    const version = start.version
    this.set({ kind: 'downloading', version, percent: 0 })
    try {
      await this.deps.engine.download((percent) => {
        this.set({ kind: 'downloading', version, percent })
      })
    } catch (error) {
      console.warn('[update] download failed:', error)
      this.set({ kind: 'error', version, message: DOWNLOAD_FAILED_MESSAGE })
      return
    }
    this.set({ kind: 'ready', version })
  }

  install(): boolean {
    if (this.installed) return false
    if (this.current.kind !== 'ready') return false
    if (this.deps.isOnAir()) return false
    this.installed = true
    this.deps.engine.quitAndInstall()
    return true
  }

  skip(): void {
    if (this.current.kind !== 'available') return
    this.deps.setSkipped(this.current.version)
    this.set({ kind: 'idle' })
  }
}
