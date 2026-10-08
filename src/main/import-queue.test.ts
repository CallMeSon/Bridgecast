import { describe, it, expect } from 'vitest'
import { ImportQueue, type ImportJob, type JobStatus } from './import-queue'

const job = (n: number): ImportJob => ({
  id: `j${n}`,
  name: `file${n}.pptx`,
  path: `C:\\x\\${n}.pptx`
})

/** A promise resolved from outside, to control when a job finishes. */
function deferred(): { promise: Promise<void>; resolve(): void; reject(e: Error): void } {
  let resolve!: () => void
  let reject!: (e: Error) => void
  const promise = new Promise<void>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0))

describe('ImportQueue', () => {
  it('runs three jobs one after another with concurrency 1', async () => {
    const log: string[] = []
    const gates = [deferred(), deferred(), deferred()]
    let running = 0
    let maxRunning = 0
    const q = new ImportQueue(async (j) => {
      running++
      maxRunning = Math.max(maxRunning, running)
      log.push(`start ${j.id}`)
      await gates[Number(j.id.slice(1)) - 1].promise
      log.push(`end ${j.id}`)
      running--
    }, 1)
    q.add(job(1))
    q.add(job(2))
    q.add(job(3))
    await tick()
    expect(log).toEqual(['start j1'])
    gates[0].resolve()
    await tick()
    expect(log).toEqual(['start j1', 'end j1', 'start j2'])
    gates[1].resolve()
    gates[2].resolve()
    await q.idle()
    expect(log).toEqual(['start j1', 'end j1', 'start j2', 'end j2', 'start j3', 'end j3'])
    expect(maxRunning).toBe(1)
  })

  it('a job that throws does not stop the next one', async () => {
    const ran: string[] = []
    const q = new ImportQueue(async (j) => {
      ran.push(j.id)
      if (j.id === 'j2') throw new Error('boom')
    }, 1)
    q.add(job(1))
    q.add(job(2))
    q.add(job(3))
    await q.idle()
    expect(ran).toEqual(['j1', 'j2', 'j3'])
  })

  it('reports busy, then done or error, for every job', async () => {
    const events: [string, JobStatus, string?][] = []
    const q = new ImportQueue(
      async (j) => {
        if (j.id === 'j2') throw new Error('PowerPoint failed')
      },
      1,
      (j, status, error) => events.push(error ? [j.id, status, error.message] : [j.id, status])
    )
    q.add(job(1))
    q.add(job(2))
    q.add(job(3))
    await q.idle()
    expect(events).toEqual([
      ['j1', 'busy'],
      ['j1', 'done'],
      ['j2', 'busy'],
      ['j2', 'error', 'PowerPoint failed'],
      ['j3', 'busy'],
      ['j3', 'done']
    ])
  })

  it('a job that throws synchronously or a non-Error still reports error', async () => {
    const events: [string, JobStatus, string?][] = []
    const q = new ImportQueue(
      ((j: ImportJob) => {
        if (j.id === 'j1') throw new Error('sync')
        return Promise.reject('plain string')
      }) as (j: ImportJob) => Promise<void>,
      1,
      (j, status, error) => events.push(error ? [j.id, status, error.message] : [j.id, status])
    )
    q.add(job(1))
    q.add(job(2))
    await q.idle()
    expect(events).toEqual([
      ['j1', 'busy'],
      ['j1', 'error', 'sync'],
      ['j2', 'busy'],
      ['j2', 'error', 'plain string']
    ])
  })

  it('a throwing status callback does not break the queue', async () => {
    const ran: string[] = []
    const q = new ImportQueue(
      async (j) => {
        ran.push(j.id)
      },
      1,
      () => {
        throw new Error('listener')
      }
    )
    q.add(job(1))
    q.add(job(2))
    await q.idle()
    expect(ran).toEqual(['j1', 'j2'])
  })

  it('runs at most `concurrency` jobs at once', async () => {
    const gates = [deferred(), deferred(), deferred()]
    const started: string[] = []
    const q = new ImportQueue(async (j) => {
      started.push(j.id)
      await gates[Number(j.id.slice(1)) - 1].promise
    }, 2)
    q.add(job(1))
    q.add(job(2))
    q.add(job(3))
    await tick()
    expect(started).toEqual(['j1', 'j2'])
    gates[1].resolve()
    await tick()
    expect(started).toEqual(['j1', 'j2', 'j3'])
    gates[0].resolve()
    gates[2].resolve()
    await q.idle()
  })

  it('defaults to concurrency 1 and accepts jobs added after it went idle', async () => {
    const ran: string[] = []
    const q = new ImportQueue(async (j) => {
      ran.push(j.id)
    })
    q.add(job(1))
    await q.idle()
    q.add(job(2))
    await q.idle()
    expect(ran).toEqual(['j1', 'j2'])
  })

  it('rejects an invalid concurrency', () => {
    expect(() => new ImportQueue(async () => undefined, 0)).toThrow()
    expect(() => new ImportQueue(async () => undefined, 1.5)).toThrow()
  })
})
