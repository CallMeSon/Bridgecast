import { parentPort, workerData } from 'worker_threads'
import { FakeSenderBinding } from '../net/fake-binding'
import type { SenderBinding } from '../net/sender-binding'
import type { OmtStatus } from '../../shared/omt'
import { OmtLoadError, loadLibomt } from './binding'
import { NdiLoadError, loadNdi } from '../ndi/binding'
import { OmtSender, type SendTarget } from './sender'

type In =
  | {
      type: 'start'
      targets: { id: 'omt' | 'ndi'; name: string }[]
      fps: 30 | 60
      width: number
      height: number
    }
  | { type: 'targets'; targets: { id: 'omt' | 'ndi'; name: string }[] }
  | { type: 'frame'; width: number; height: number; data: ArrayBuffer }
  | { type: 'audio'; data: Float32Array; samples: number }
  | { type: 'stop' }
  | { type: 'debugGet' }

/** Fake-mode counters for the e2e debug hook. */
export interface FakeDebug {
  /** Frames each fake target received (PPT_OUTPUT_DUMP's __pptNet). */
  targets?: { id: 'omt' | 'ndi'; frames: { width: number; height: number; fps: number }[] }[]
  firstPx: number[][] | null
  lastPx: number[][] | null
  blackAfterContent: number
  audioBlocks: number
  lastAudioLen: number
}

export type WorkerOut =
  | { type: 'status'; id: 'omt' | 'ndi'; status: Partial<OmtStatus> }
  | { type: 'stopped' }
  | { type: 'debug'; count: number; sizes: string[]; extra?: FakeDebug }

const port = parentPort
if (port) {
  const data = (workerData ?? {}) as {
    fake?: boolean
    /** false: real NDI runtime; true: FakeSenderBinding('ndi'); 'missing': as if the runtime is absent. */
    fakeNdi?: boolean | 'missing'
    libDir?: string
  }
  const sender = new OmtSender()
  const out = (m: WorkerOut): void => port.postMessage(m)

  // Only kept in fake mode, for the PPT_OUTPUT_DUMP debug hook (asked with `debugGet`).
  let fake: FakeSenderBinding | null = null
  let fakeNdi: FakeSenderBinding | null = null

  const bindingFor = (id: 'omt' | 'ndi'): (() => SenderBinding) => {
    if (id === 'omt')
      return () => {
        if (data.fake) return (fake = new FakeSenderBinding('omt'))
        // The main process resolves the directory (libomtDir()); this graph never loads electron.
        if (!data.libDir) throw new OmtLoadError('workerData.libDir missing')
        return loadLibomt(data.libDir)
      }
    return () => {
      if (data.fakeNdi === 'missing') throw new NdiLoadError('missing', 'simulated missing runtime')
      if (data.fakeNdi) return (fakeNdi = new FakeSenderBinding('ndi'))
      return loadNdi()
    }
  }

  const toTargets = (list: { id: 'omt' | 'ndi'; name: string }[]): SendTarget[] =>
    list.map((t) => ({
      id: t.id,
      name: t.name,
      binding: bindingFor(t.id),
      report: (status) => out({ type: 'status', id: t.id, status })
    }))

  port.on('message', (m: In) => {
    switch (m.type) {
      case 'start':
        sender.start({
          targets: toTargets(m.targets),
          fps: m.fps,
          width: m.width,
          height: m.height
        })
        break
      case 'targets':
        sender.setTargets(toTargets(m.targets))
        break
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
      case 'debugGet': {
        const frames = fake?.frames ?? []
        const sizes = [...new Set(frames.map((f) => `${f.width}x${f.height}`))]
        const extra: FakeDebug = {
          firstPx: fake?.firstPx ?? null,
          lastPx: fake?.lastPx ?? null,
          blackAfterContent: fake?.blackAfterContent ?? 0,
          audioBlocks: fake?.audio ?? 0,
          lastAudioLen: fake?.lastAudioLen ?? 0,
          targets: [
            { id: 'omt', frames: fake?.frames ?? [] },
            { id: 'ndi', frames: fakeNdi?.frames ?? [] }
          ]
        }
        out({ type: 'debug', count: frames.length, sizes, extra })
        break
      }
    }
  })
}
