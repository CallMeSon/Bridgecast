import { describe, expect, it } from 'vitest'
import { outputGateOpen, pickSink } from './audio'

const devices = [{ deviceId: 'default' }, { deviceId: 'hdmi-1' }]

describe('pickSink', () => {
  it('no saved device uses the default sink', () => {
    expect(pickSink(null, devices)).toEqual({ sinkId: '', missing: false })
  })

  it('a saved device that is present is used', () => {
    expect(pickSink('hdmi-1', devices)).toEqual({ sinkId: 'hdmi-1', missing: false })
  })

  it('a saved device that is gone falls back to the default and is reported missing', () => {
    expect(pickSink('usb-9', devices)).toEqual({ sinkId: '', missing: true })
    expect(pickSink('usb-9', [])).toEqual({ sinkId: '', missing: true })
  })
})

describe('outputGateOpen', () => {
  const def = { deviceId: null, muted: false }
  const saved = { deviceId: 'hdmi-1', muted: true }

  it('waits for the audio settings, until the timeout', () => {
    expect(outputGateOpen(null, null, false)).toBe(false)
    expect(outputGateOpen(null, [], false)).toBe(false)
    expect(outputGateOpen(null, null, true)).toBe(true)
  })

  it('the default device needs no device list', () => {
    expect(outputGateOpen(def, null, false)).toBe(true)
  })

  it('a saved device waits for the device list, until the timeout', () => {
    expect(outputGateOpen(saved, null, false)).toBe(false)
    expect(outputGateOpen(saved, null, true)).toBe(true)
    expect(outputGateOpen(saved, [], false)).toBe(true)
  })
})
