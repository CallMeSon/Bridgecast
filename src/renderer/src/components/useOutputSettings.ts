import { useCallback, useEffect, useState } from 'react'
import type { HdmiStatus } from '../../../shared/ipc'
import type { Canvas } from '../../../shared/canvas'
import type { DisplayInfo } from '../../../shared/displays'
import type { AudioSettings, HdmiSettings } from '../../../shared/settings'
import type { NdiSettings, NetStatus, OmtSettings } from '../../../shared/omt'
import { useNdiStatus, useOmtStatus } from '../omt'

export interface OutputSettingsState {
  hdmi: HdmiSettings | null
  audio: AudioSettings | null
  canvas: Canvas | null
  omt: OmtSettings | null
  ndi: NdiSettings | null
  /** OMT and NDI send only the slide without Fit bars. */
  sendContentOnly: boolean | null
  status: HdmiStatus | null
  displays: DisplayInfo[]
  omtStatus: NetStatus | null
  ndiStatus: NetStatus | null
  setHdmi(v: HdmiSettings): void
  setAudio(v: AudioSettings): void
  setCanvas(v: Canvas): void
  setOmt(v: OmtSettings): void
  setNdi(v: NdiSettings): void
  setSendContentOnly(v: boolean): void
  /** Read the saved settings and the screens again (main may re-save the HDMI display id). */
  reload(): void
}

/**
 * Output settings and live status (HDMI, audio, canvas, OMT, NDI), loaded once for the
 * header indicators and the Output and Network sections of the right panel.
 */
export function useOutputSettings(): OutputSettingsState {
  const api = window.api
  const [hdmi, setHdmi] = useState<HdmiSettings | null>(null)
  const [audio, setAudio] = useState<AudioSettings | null>(null)
  const [canvas, setCanvas] = useState<Canvas | null>(null)
  const [omt, setOmt] = useState<OmtSettings | null>(null)
  const [ndi, setNdi] = useState<NdiSettings | null>(null)
  const [sendContentOnly, setSendContentOnly] = useState<boolean | null>(null)
  const [status, setStatus] = useState<HdmiStatus | null>(null)
  const [displays, setDisplays] = useState<DisplayInfo[]>([])
  const omtStatus = useOmtStatus()
  const ndiStatus = useNdiStatus()

  useEffect(() => {
    const offs = [
      api.onHdmiStatus(setStatus),
      api.onDisplaysChanged(setDisplays),
      api.onAudioSettings(setAudio),
      // Main switched an output by itself (an event's saved outputs took over).
      api.onOutputSettings((s) => {
        setHdmi(s.hdmi)
        setOmt(s.omt)
        setNdi(s.ndi)
      })
    ]
    api.getSettings().then((s) => {
      setHdmi(s.hdmi)
      setAudio((cur) => cur ?? s.audio)
      setCanvas(s.canvas)
      setOmt(s.omt)
      setNdi(s.ndi)
      setSendContentOnly(s.sendContentOnly)
    })
    // A status pushed before this resolves is newer; keep it.
    api.getHdmiStatus().then((s) => setStatus((cur) => cur ?? s))
    api.listDisplays().then(setDisplays)
    return () => offs.forEach((off) => off())
  }, [api])

  const reload = useCallback(() => {
    api.getSettings().then((s) => {
      setHdmi(s.hdmi)
      setCanvas(s.canvas)
      setOmt(s.omt)
      setNdi(s.ndi)
      setSendContentOnly(s.sendContentOnly)
    })
    api.listDisplays().then(setDisplays)
  }, [api])

  return {
    hdmi,
    audio,
    canvas,
    omt,
    ndi,
    sendContentOnly,
    status,
    displays,
    omtStatus,
    ndiStatus,
    setHdmi,
    setAudio,
    setCanvas,
    setOmt,
    setNdi,
    setSendContentOnly,
    reload
  }
}
