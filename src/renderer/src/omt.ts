import { useEffect, useState } from 'react'
import { noReceiversHint, type OmtStatus } from '../../shared/omt'

/** Live OMT sender status (null until main answers). A pushed status is newer than the first read. */
export function useOmtStatus(): OmtStatus | null {
  const [status, setStatus] = useState<OmtStatus | null>(null)
  useEffect(() => {
    const off = window.api.onOmtStatus(setStatus)
    void window.api.getOmtStatus().then((s) => setStatus((cur) => cur ?? s))
    return off
  }, [])
  return status
}

/** True once the sender has run for 15 s with no receiver (see noReceiversHint). */
export function useNoReceiversHint(status: OmtStatus | null): boolean {
  const waiting = status?.state === 'running' && status.connections === 0
  const [due, setDue] = useState(false)

  useEffect(() => {
    if (!waiting) return
    // Start of this spell without receivers.
    const since = Date.now()
    const id = setInterval(() => setDue(noReceiversHint('running', 0, since, Date.now())), 1000)
    return () => {
      clearInterval(id)
      setDue(false)
    }
  }, [waiting])

  return waiting && due
}
