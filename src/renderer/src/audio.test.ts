import { describe, expect, it } from 'vitest'
import { pickSink } from './audio'

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
