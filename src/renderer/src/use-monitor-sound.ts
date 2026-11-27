import { useEffect, useState } from 'react'
import { operatorPlays } from '../../shared/omt'
import type { ProgramState } from '../../shared/program'
import type { AudioSettings } from '../../shared/settings'
import { outputGain } from './model'
import { OutputAudio } from './output-audio'
import { pickSink, useAudioOutputs } from './audio'
import { useSlideshowSound } from './slideshow-sound'
import pcmModuleUrl from './pcm-source.worklet.ts?worker&url'

/** The operator window's sound: its own gain stage, the level meter's source. */
export interface MonitorSound {
  out: OutputAudio
  /** This window plays the Program sound on the speakers (automatic or Monitor). */
  local: boolean
  /** It does so because no output window plays it. */
  auto: boolean
}

/**
 * The operator window as a sound source. It always receives the Program sound (video, web page,
 * PowerPoint) so the meter has a signal; `operatorPlays` decides whether it also reaches the
 * speakers: only when no output window plays it, or when the operator turned Monitor on.
 * Same gain (deck x master x mute) and same device as the output windows.
 */
export function useMonitorSound(
  program: ProgramState,
  audio: AudioSettings | null,
  hdmiShowing: boolean | null,
  networkRunning: boolean
): MonitorSound {
  const [out] = useState(() => new OutputAudio(undefined, { pcmModuleUrl }))
  useEffect(() => () => out.close(), [out])
  useSlideshowSound(out)

  // Silent until the settings and the HDMI state are known, so nothing starts doubled.
  const known = audio !== null && hdmiShowing !== null
  const plan = operatorPlays(!!hdmiShowing, networkRunning, !!audio?.monitor)
  const local = known && plan.local
  useEffect(() => {
    out.setPlan({ local, tap: false }, null).catch(() => undefined)
  }, [out, local])

  const gain = outputGain(program, audio)
  useEffect(() => out.setGain(gain), [out, gain])
  const outputs = useAudioOutputs()
  const sink = pickSink(audio?.deviceId ?? null, outputs ?? []).sinkId
  useEffect(() => {
    out.setSink(sink).catch((e: unknown) => console.warn('[audio] audio device failed:', e))
  }, [out, sink])

  return { out, local, auto: known && plan.auto }
}
