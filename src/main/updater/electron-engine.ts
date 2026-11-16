import { autoUpdater } from 'electron-updater'
import type { UpdateInfo } from 'electron-updater'
import type { UpdateEngine } from './manager'

function normalizeReleaseNotes(notes: UpdateInfo['releaseNotes']): string {
  if (typeof notes === 'string') return notes
  if (Array.isArray(notes)) {
    return notes
      .map((entry) => (entry.note ?? '').trim())
      .filter(Boolean)
      .join('\n\n')
  }
  return ''
}

export function createElectronEngine(): UpdateEngine {
  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = false
  autoUpdater.allowPrerelease = false
  autoUpdater.allowDowngrade = false

  return {
    async check() {
      const result = await autoUpdater.checkForUpdates()
      if (!result?.isUpdateAvailable) return null
      const info = result.updateInfo
      return { version: info.version, notes: normalizeReleaseNotes(info.releaseNotes) }
    },
    async download(onProgress) {
      const onProgressEvent = (progress: { percent: number }): void => {
        onProgress(Math.round(progress.percent))
      }
      autoUpdater.on('download-progress', onProgressEvent)
      try {
        await autoUpdater.downloadUpdate()
      } finally {
        autoUpdater.removeListener('download-progress', onProgressEvent)
      }
    },
    quitAndInstall() {
      autoUpdater.quitAndInstall(false, true)
    }
  }
}
