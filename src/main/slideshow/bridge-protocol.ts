/** JSON-lines protocol between the main process and the helpers (ppt-bridge, web-bridge). */
type BridgeCmd =
  | 'open'
  | 'next'
  | 'prev'
  | 'goto'
  | 'close'
  | 'ping'
  | 'edit'
  | 'setVolume'
  | 'import' // lo-bridge only (the Linux PowerPoint import)
  | 'navigate'
  | 'reload'
  | 'back'
  | 'forward'
  | 'setZoom'
  | 'resize'
  | 'input'
  | 'setMuted'
  | 'signOut' // web-bridge only

/** Events of both helpers; each engine reads the ones it knows. */
export type BridgeEvent = {
  event: 'position' | 'error' | 'exited' | 'app' | 'nav' | 'status' | 'crashed'
} & Record<string, unknown>

const KNOWN_EVENTS = new Set([
  'position',
  'error',
  'exited',
  'app',
  'nav',
  'status',
  'crashed'
])

export class BridgeError extends Error {
  constructor(
    public code: string,
    message: string
  ) {
    super(message)
    this.name = 'BridgeError'
  }
}

interface Pending {
  resolve: (r: Record<string, unknown>) => void
  reject: (e: Error) => void
  timer: ReturnType<typeof setTimeout>
}

export class BridgeClient {
  private nextId = 1
  private buf = ''
  private pending = new Map<number, Pending>()
  private listeners: ((e: BridgeEvent) => void)[] = []

  constructor(private write: (line: string) => void) {}

  onEvent(cb: (e: BridgeEvent) => void): void {
    this.listeners.push(cb)
  }

  request(
    cmd: BridgeCmd,
    args: Record<string, unknown>,
    timeoutMs: number
  ): Promise<Record<string, unknown>> {
    const id = this.nextId++
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new BridgeError('timeout', `${cmd} timed out after ${timeoutMs} ms`))
      }, timeoutMs)
      this.pending.set(id, { resolve, reject, timer })
      try {
        this.write(JSON.stringify({ ...args, id, cmd }) + '\n')
      } catch (e) {
        clearTimeout(timer)
        this.pending.delete(id)
        reject(e instanceof Error ? e : new Error(String(e)))
      }
    })
  }

  /** Reject every request in flight (the bridge went away). */
  failAll(code: string, message: string): void {
    for (const [id, p] of this.pending) {
      clearTimeout(p.timer)
      this.pending.delete(id)
      p.reject(new BridgeError(code, message))
    }
  }

  /** Feed raw output of the bridge; complete lines are handled, the rest is kept. */
  feed(chunk: string): void {
    this.buf += chunk
    let nl: number
    while ((nl = this.buf.indexOf('\n')) >= 0) {
      const line = this.buf.slice(0, nl).trim()
      this.buf = this.buf.slice(nl + 1)
      if (line) this.handle(line)
    }
  }

  private handle(line: string): void {
    let msg: unknown
    try {
      msg = JSON.parse(line)
    } catch {
      console.warn('bridge: malformed line ignored:', line.slice(0, 200))
      return
    }
    if (!msg || typeof msg !== 'object') {
      console.warn('bridge: unexpected line ignored:', line.slice(0, 200))
      return
    }
    const m = msg as Record<string, unknown>
    if (typeof m.event === 'string') {
      if (KNOWN_EVENTS.has(m.event)) {
        for (const cb of this.listeners) cb(m as BridgeEvent)
      }
      return
    }
    if (typeof m.id !== 'number') return
    const p = this.pending.get(m.id)
    if (!p) return
    clearTimeout(p.timer)
    this.pending.delete(m.id)
    if (m.ok === true) p.resolve(m)
    else {
      p.reject(
        new BridgeError(
          typeof m.code === 'string' ? m.code : 'error',
          typeof m.message === 'string' ? m.message : 'bridge error'
        )
      )
    }
  }
}
