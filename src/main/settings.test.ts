import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import { join } from 'path'
import { DEFAULT_SETTINGS, loadSettings, saveSettings } from './settings'
import { sanitizeAudio, sanitizeSettings } from '../shared/settings'

let dir: string
let file: string

beforeEach(() => {
  dir = fs.mkdtempSync(join(os.tmpdir(), 'ppt-settings-'))
  file = join(dir, 'settings.json')
})
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }))

describe('loadSettings / saveSettings', () => {
  it('returns the defaults when the file does not exist', () => {
    expect(loadSettings(file)).toEqual({
      hdmi: { enabled: false, displayId: null },
      autoAdvance: false,
      audio: { deviceId: null, muted: false },
      canvas: { width: 1920, height: 1080 }
    })
    expect(loadSettings(file)).toEqual(DEFAULT_SETTINGS)
  })

  it('save then load returns the same values', () => {
    const s = {
      hdmi: { enabled: true, displayId: 2528732444 },
      autoAdvance: true,
      audio: { deviceId: null, muted: false },
      canvas: { width: 1920, height: 1080 }
    }
    saveSettings(file, s)
    expect(loadSettings(file)).toEqual(s)
  })

  it('returns the defaults without throwing when the JSON is corrupt', () => {
    fs.writeFileSync(file, '{"hdmi": {"enabled": tr')
    expect(() => loadSettings(file)).not.toThrow()
    expect(loadSettings(file)).toEqual(DEFAULT_SETTINGS)
  })

  it('returns the defaults when the JSON is valid but not an object', () => {
    fs.writeFileSync(file, 'null')
    expect(loadSettings(file)).toEqual(DEFAULT_SETTINGS)
    fs.writeFileSync(file, '[1,2]')
    expect(loadSettings(file)).toEqual(DEFAULT_SETTINGS)
  })

  it('writes atomically (no temp files left behind) and creates the folder', () => {
    const nested = join(dir, 'a', 'settings.json')
    saveSettings(nested, DEFAULT_SETTINGS)
    expect(fs.readdirSync(join(dir, 'a'))).toEqual(['settings.json'])
    saveSettings(nested, DEFAULT_SETTINGS)
    expect(fs.readdirSync(join(dir, 'a'))).toEqual(['settings.json'])
  })

  it('does not share the defaults object with callers', () => {
    const a = loadSettings(file)
    a.hdmi.enabled = true
    expect(loadSettings(file).hdmi.enabled).toBe(false)
  })
})

describe('hdmi settings', () => {
  it('an old settings file with ndi and without hdmi loads with the hdmi defaults', () => {
    const ndi = { enabled: false, name: 'Aula', width: 1920, height: 1080, fps: 60 }
    fs.writeFileSync(file, JSON.stringify({ ndi }))
    expect(loadSettings(file)).toEqual({
      hdmi: { enabled: false, displayId: null },
      autoAdvance: false,
      audio: { deviceId: null, muted: false },
      canvas: { width: 1920, height: 1080 }
    })
  })

  it('an old settings file keeps its hdmi values and drops ndi', () => {
    const ndi = { enabled: true, name: 'PPT Share', width: 1920, height: 1080, fps: 30 }
    fs.writeFileSync(file, JSON.stringify({ ndi, hdmi: { enabled: true, displayId: 7 } }))
    expect(loadSettings(file)).toEqual({
      hdmi: { enabled: true, displayId: 7 },
      autoAdvance: false,
      audio: { deviceId: null, muted: false },
      canvas: { width: 1920, height: 1080 }
    })
  })

  it('a displayId that is not an integer becomes null', () => {
    for (const displayId of [2.5, '2', -0.1, NaN, null, true, {}]) {
      fs.writeFileSync(file, JSON.stringify({ hdmi: { enabled: true, displayId } }))
      expect(loadSettings(file).hdmi).toEqual({ enabled: true, displayId: null })
    }
  })

  it('an invalid enabled flag falls back to off', () => {
    expect(sanitizeSettings({ hdmi: { enabled: 1, displayId: 5 } }).hdmi).toEqual({
      enabled: false,
      displayId: 5
    })
    expect(sanitizeSettings({ hdmi: 'on' }).hdmi).toEqual({ enabled: false, displayId: null })
  })

  it('autoAdvance is a boolean, off when missing or invalid', () => {
    expect(sanitizeSettings({ autoAdvance: true }).autoAdvance).toBe(true)
    expect(sanitizeSettings({ autoAdvance: 'ya' }).autoAdvance).toBe(false)
    expect(sanitizeSettings({}).autoAdvance).toBe(false)
  })

  it('drops unknown fields', () => {
    expect(sanitizeSettings({ hdmi: { enabled: false, displayId: null, x: 1 }, other: 2 })).toEqual(
      DEFAULT_SETTINGS
    )
  })
})

describe('audio settings', () => {
  it('defaults: no saved device, not muted', () => {
    expect(DEFAULT_SETTINGS.audio).toEqual({ deviceId: null, muted: false })
    expect(sanitizeSettings({}).audio).toEqual({ deviceId: null, muted: false })
  })

  it('missing or wrong-typed audio falls back to the defaults', () => {
    for (const audio of [undefined, null, 'loud', 7, [], { deviceId: 5, muted: 'yes' }]) {
      expect(sanitizeAudio(audio)).toEqual({ deviceId: null, muted: false })
    }
  })

  it('keeps a valid device id and muted flag', () => {
    expect(sanitizeAudio({ deviceId: 'abc123', muted: true })).toEqual({
      deviceId: 'abc123',
      muted: true
    })
    expect(sanitizeSettings({ audio: { deviceId: 'abc123', muted: true } }).audio).toEqual({
      deviceId: 'abc123',
      muted: true
    })
  })

  it('an empty or too long device id becomes null (512 characters is the limit)', () => {
    expect(sanitizeAudio({ deviceId: '', muted: true })).toEqual({ deviceId: null, muted: true })
    expect(sanitizeAudio({ deviceId: 'x'.repeat(512) }).deviceId).toBe('x'.repeat(512))
    expect(sanitizeAudio({ deviceId: 'x'.repeat(513) }).deviceId).toBeNull()
  })

  it('drops unknown audio fields', () => {
    expect(sanitizeAudio({ deviceId: null, muted: false, volume: 3 })).toEqual({
      deviceId: null,
      muted: false
    })
  })

  it('save then load keeps audio', () => {
    const s = {
      ...DEFAULT_SETTINGS,
      audio: { deviceId: 'hdmi-1', muted: true }
    }
    saveSettings(file, s)
    expect(loadSettings(file).audio).toEqual({ deviceId: 'hdmi-1', muted: true })
  })
})

describe('canvas setting', () => {
  it('a settings file without canvas loads the 1920×1080 default', () => {
    fs.writeFileSync(file, JSON.stringify({ hdmi: { enabled: true, displayId: 3 } }))
    expect(loadSettings(file).canvas).toEqual({ width: 1920, height: 1080 })
  })

  it('an invalid canvas falls back to the default', () => {
    fs.writeFileSync(file, JSON.stringify({ canvas: { width: 10, height: 10 } }))
    expect(loadSettings(file).canvas).toEqual({ width: 1920, height: 1080 })
  })

  it('keeps a valid canvas through save then load', () => {
    fs.writeFileSync(file, JSON.stringify({ canvas: { width: 3840, height: 1080 } }))
    expect(loadSettings(file).canvas).toEqual({ width: 3840, height: 1080 })
    saveSettings(file, { ...DEFAULT_SETTINGS, canvas: { width: 3840, height: 1080 } })
    expect(loadSettings(file).canvas).toEqual({ width: 3840, height: 1080 })
  })

  it('does not share the default canvas object with callers', () => {
    const a = loadSettings(file)
    a.canvas.width = 640
    expect(loadSettings(file).canvas.width).toBe(1920)
  })
})
