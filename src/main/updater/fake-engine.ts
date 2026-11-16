import type { UpdateEngine } from './manager'

function timeout(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** Stands in for the real engine when PPT_UPDATE_FAKE=1: never touches the network or disk. */
export function createFakeEngine(opts?: { version?: string; notes?: string }): UpdateEngine {
  const version = opts?.version ?? '99.0.0'
  const notes = opts?.notes ?? '## Fake update\n- Nothing to see here'
  return {
    async check() {
      await timeout(50)
      return { version, notes }
    },
    async download(onProgress) {
      for (const percent of [25, 50, 100]) {
        await timeout(20)
        onProgress(percent)
      }
    },
    quitAndInstall() {
      console.log('[update] fake engine: quitAndInstall()')
    }
  }
}
