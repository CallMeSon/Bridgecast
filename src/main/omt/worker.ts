import { parentPort, workerData } from 'worker_threads'
import { FakeSenderBinding } from '../net/fake-binding'
import type { SenderBinding } from '../net/sender-binding'
import type { OmtStatus } from '../../shared/omt'
import { OmtLoadError, loadLibomt } from './binding'
import { OmtSender, type SendTarget } from './sender'

type In =
  | {
      type: 'start'
      targets: { id: 'omt' | 'ndi'; name: string }[]
      fps: 30 | 60
      width: number
      height: number
    }
  | { type: 'frame'; width: number; height: number; data: ArrayBuffer }
  | { type: 'audio'; data: Float32Array; samples: number }
  | { type: 'stop' }

export type WorkerOut =
  { type: 'status'; id: 'omt' | 'ndi'; status: Partial<OmtStatus> } | { type: 'stopped' }

const port = parentPort
if (port) {
  const data = (workerData ?? {}) as { fake?: boolean; libDir?: string }
  const sender = new OmtSender()
  const out = (m: WorkerOut): void => port.postMessage(m)

  const bindingFor = (id: 'omt' | 'ndi'): (() => SenderBinding) => {
    if (id === 'omt')
      return () => {
        if (data.fake) return new FakeSenderBinding('omt')
        // The main process resolves the directory (libomtDir()); this graph never loads electron.
        if (!data.libDir) throw new OmtLoadError('workerData.libDir missing')
        return loadLibomt(data.libDir)
      }
    return () => new FakeSenderBinding('ndi') // NDI is not implemented yet
  }

  port.on('message', (m: In) => {
    switch (m.type) {
      case 'start': {
        const targets: SendTarget[] = m.targets.map((t) => ({
          id: t.id,
          name: t.name,
          binding: bindingFor(t.id),
          report: (status) => out({ type: 'status', id: t.id, status })
        }))
        sender.start({ targets, fps: m.fps, width: m.width, height: m.height })
        break
      }
      case 'frame':
        sender.frame({ width: m.width, height: m.height, data: m.data })
        break
      case 'audio':
        sender.audio(m.data, m.samples)
        break
      case 'stop':
        sender.stop()
        out({ type: 'stopped' })
        break
    }
  })
}
