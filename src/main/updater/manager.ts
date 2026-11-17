import { isNewerVersion, isPrerelease, type UpdateStatus } from '../../shared/update'

export interface UpdateEngine {
  check(): Promise<{ version: string; notes: string } | null>
  download(onProgress: (percent: number) => void): Promise<void>
  quitAndInstall(): void
  /** Whether a downloaded update is installed when the app quits normally. */
  setInstallOnQuit(enabled: boolean): void
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

/**
 * Updates need no operator action: a newer version downloads by itself while nothing is on
 * air and installs when the app is closed with nothing on air. The operator can still download
 * during a show, restart at once, or skip the version.
 */
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
    if (this.current.kind === 'available') {
      this.autoDownload()
      return
    }
    if (this.current.kind === 'downloading' || this.current.kind === 'ready') return
    // A failed download keeps its version and "Try again" unless this check finds something.
    const failedDownload = this.current.kind === 'error' ? this.current : null
    if (!failedDownload) this.set({ kind: 'checking' })
    let result: { version: string; notes: string } | null
    try {
      result = await this.deps.engine.check()
    } catch (error) {
      console.info('[update] check failed:', error)
      if (!failedDownload) this.set({ kind: 'idle', checkFailed: true })
      return
    }
    if (!result) {
      if (!failedDownload) this.set({ kind: 'idle' })
      return
    }
    if (failedDownload?.version === result.version) return
    if (isPrerelease(result.version) || !isNewerVersion(result.version, this.deps.currentVersion)) {
      this.set({ kind: 'idle' })
      return
    }
    if (this.deps.getSkipped() === result.version) {
      this.set({ kind: 'idle' })
      return
    }
    this.set({ kind: 'available', version: result.version, notes: result.notes })
    this.autoDownload()
  }

  /**
   * Starts the download of an announced version by itself, but never during a show: call it
   * again when the Program goes off air. It does not wait for the download to finish.
   */
  autoDownload(): void {
    if (this.current.kind !== 'available' || this.deps.isOnAir()) return
    void this.download()
  }

  async download(): Promise<void> {
    const start = this.current
    const fromAvailable = start.kind === 'available'
    const fromError = start.kind === 'error'
    if (!fromAvailable && !fromError) return
    const { version, notes } = start
    this.set({ kind: 'downloading', version, notes, percent: 0 })
    try {
      await this.deps.engine.download((percent) => {
        this.set({ kind: 'downloading', version, notes, percent })
      })
    } catch (error) {
      console.warn('[update] download failed:', error)
      this.set({ kind: 'error', version, notes, message: DOWNLOAD_FAILED_MESSAGE })
      return
    }
    this.set({ kind: 'ready', version, notes })
  }

  install(): boolean {
    if (this.installed) return false
    if (this.current.kind !== 'ready') return false
    if (this.deps.isOnAir()) return false
    this.installed = true
    this.deps.engine.quitAndInstall()
    return true
  }

  /**
   * Call when the app is quitting: tells the engine whether to install the downloaded update on
   * the way out. Never while something is on air, so a restart in the middle of a show is fast.
   */
  prepareQuit(): boolean {
    const install = !this.installed && this.current.kind === 'ready' && !this.deps.isOnAir()
    this.deps.engine.setInstallOnQuit(install)
    return install
  }

  /** Skips the announced version, also after it was downloaded: it is then never installed. */
  skip(): void {
    if (this.current.kind !== 'available' && this.current.kind !== 'ready') return
    this.deps.setSkipped(this.current.version)
    this.set({ kind: 'idle' })
  }
}
