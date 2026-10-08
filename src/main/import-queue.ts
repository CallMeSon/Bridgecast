export interface ImportJob {
  id: string
  /** File name shown in the Library row. */
  name: string
  path: string
}

export type JobStatus = 'busy' | 'done' | 'error'

export type StatusListener = (job: ImportJob, status: JobStatus, error?: Error) => void

/**
 * FIFO import queue. At most `concurrency` jobs run at once (default 1:
 * PowerPoint COM must never run in parallel). Every job reports `busy` when it
 * starts, then `done` or `error`; a failing job never stops the jobs after it.
 */
export class ImportQueue {
  private readonly waiting: ImportJob[] = []
  private running = 0
  private idleWaiters: (() => void)[] = []

  constructor(
    private readonly run: (job: ImportJob) => Promise<void>,
    private readonly concurrency = 1,
    private readonly onStatus?: StatusListener
  ) {
    if (!Number.isInteger(concurrency) || concurrency < 1) {
      throw new Error('Concurrent imports must be a whole number of at least 1.')
    }
  }

  add(job: ImportJob): void {
    this.waiting.push(job)
    this.pump()
  }

  /** Resolves once nothing is running or waiting. */
  idle(): Promise<void> {
    if (this.running === 0 && this.waiting.length === 0) return Promise.resolve()
    return new Promise((resolve) => this.idleWaiters.push(resolve))
  }

  private pump(): void {
    while (this.running < this.concurrency && this.waiting.length > 0) {
      const job = this.waiting.shift()!
      this.running++
      void this.execute(job).finally(() => {
        this.running--
        this.pump()
        if (this.running === 0 && this.waiting.length === 0) {
          const waiters = this.idleWaiters
          this.idleWaiters = []
          for (const w of waiters) w()
        }
      })
    }
  }

  private async execute(job: ImportJob): Promise<void> {
    this.emit(job, 'busy')
    try {
      await this.run(job)
      this.emit(job, 'done')
    } catch (err) {
      this.emit(job, 'error', err instanceof Error ? err : new Error(String(err)))
    }
  }

  private emit(job: ImportJob, status: JobStatus, error?: Error): void {
    try {
      this.onStatus?.(job, status, error)
    } catch (err) {
      console.error('[import] status listener failed:', err)
    }
  }
}
