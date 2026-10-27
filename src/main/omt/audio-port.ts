/** The slice of Electron's MessagePortMain that AudioPortFeed uses. */
export interface PortLike {
  on(ev: 'message', fn: (e: { data: unknown }) => void): unknown
  start(): void
  close(): void
}

/**
 * Program sound from the OMT window to the worker. Every request builds a
 * FRESH channel: port1 goes to the window, port2 feeds `onAudio`; the previous
 * port2 is closed. Anything that is not `{ data: Float32Array, samples }` with
 * data.length === 2 * samples is dropped.
 */
export class AudioPortFeed {
  private current: PortLike | null = null
  private closed = false

  constructor(
    private newChannel: () => { port1: PortLike; port2: PortLike },
    private post: (port1: PortLike) => void,
    private onAudio: (data: Float32Array, samples: number) => void
  ) {}

  request(): void {
    if (this.closed) return
    this.current?.close()
    const { port1, port2 } = this.newChannel()
    this.current = port2
    port2.on('message', (e) => {
      if (this.current !== port2) return
      const m = e.data as { data?: unknown; samples?: unknown } | null
      if (!m || !(m.data instanceof Float32Array)) return
      const samples = m.samples
      if (typeof samples !== 'number' || !Number.isInteger(samples) || samples <= 0) return
      if (m.data.length !== samples * 2) return
      this.onAudio(m.data, samples)
    })
    port2.start()
    this.post(port1)
  }

  close(): void {
    this.closed = true
    this.current?.close()
    this.current = null
  }
}
