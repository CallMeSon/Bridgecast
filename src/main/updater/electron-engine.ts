import { autoUpdater } from 'electron-updater'
import type { UpdateInfo } from 'electron-updater'
import { releaseNotesText } from '../../shared/update'
import type { UpdateEngine } from './manager'

function normalizeReleaseNotes(notes: UpdateInfo['releaseNotes']): string {
  if (typeof notes === 'string') return releaseNotesText(notes)
  if (Array.isArray(notes)) {
    return notes
      .map((entry) => releaseNotesText(entry.note ?? '').trim())
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
      // electron-updater only registers its install-on-quit handler when this flag is set as
      // the download finishes. It is switched off again at once, so nothing installs unless
      // setInstallOnQuit(true) is called while the app is quitting.
      autoUpdater.autoInstallOnAppQuit = true
      try {
        await autoUpdater.downloadUpdate()
      } finally {
        autoUpdater.autoInstallOnAppQuit = false
        autoUpdater.removeListener('download-progress', onProgressEvent)
      }
    },
    quitAndInstall() {
      autoUpdater.quitAndInstall(false, true)
    },
    setInstallOnQuit(enabled) {
      autoUpdater.autoInstallOnAppQuit = enabled
    }
  }
}
