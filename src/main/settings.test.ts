import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import { join } from 'path'
import { DEFAULT_SETTINGS, loadSettings, saveSettings } from './settings'
import { ndiSettingsError, sanitizeSettings } from '../shared/settings'

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
      ndi: { enabled: true, name: 'PPT Share', width: 1920, height: 1080, fps: 30 },
      hdmi: { enabled: false, displayId: null }
    })
    expect(loadSettings(file)).toEqual(DEFAULT_SETTINGS)
  })

  it('save then load returns the same values', () => {
    const s = {
      ndi: { enabled: false, name: 'Panggung Utama', width: 3840, height: 2160, fps: 60 },
      hdmi: { enabled: true, displayId: 2528732444 }
    }
    saveSettings(file, s)
    expect(loadSettings(file)).toEqual(s)
  })

  it('returns the defaults without throwing when the JSON is corrupt', () => {
    fs.writeFileSync(file, '{"ndi": {"enabled": tr')
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
    a.ndi.name = 'diubah'
    expect(loadSettings(file).ndi.name).toBe('PPT Share')
  })
})

describe('hdmi settings', () => {
  const ndi = { enabled: false, name: 'Aula', width: 1920, height: 1080, fps: 60 }

  it('an old settings file without hdmi loads with the hdmi defaults', () => {
    fs.writeFileSync(file, JSON.stringify({ ndi }))
    expect(loadSettings(file)).toEqual({ ndi, hdmi: { enabled: false, displayId: null } })
  })

  it('a displayId that is not an integer becomes null', () => {
    for (const displayId of [2.5, '2', -0.1, NaN, null, true, {}]) {
      fs.writeFileSync(file, JSON.stringify({ ndi, hdmi: { enabled: true, displayId } }))
      expect(loadSettings(file).hdmi).toEqual({ enabled: true, displayId: null })
    }
  })

  it('an invalid enabled flag falls back to off', () => {
    expect(sanitizeSettings({ ndi, hdmi: { enabled: 1, displayId: 5 } }).hdmi).toEqual({
      enabled: false,
      displayId: 5
    })
    expect(sanitizeSettings({ ndi, hdmi: 'on' }).hdmi).toEqual({ enabled: false, displayId: null })
  })
})

describe('sanitizeSettings', () => {
  const ok = DEFAULT_SETTINGS.ndi

  it('falls back per field when a value is out of range', () => {
    expect(sanitizeSettings({ ndi: { ...ok, fps: 25 } }).ndi.fps).toBe(30)
    expect(sanitizeSettings({ ndi: { ...ok, enabled: 'ya' } }).ndi.enabled).toBe(true)
    expect(sanitizeSettings({ ndi: { ...ok, name: '   ' } }).ndi.name).toBe('PPT Share')
    expect(sanitizeSettings({ ndi: { ...ok, name: 'x'.repeat(64) } }).ndi.name).toBe('PPT Share')
    expect(sanitizeSettings({ ndi: { ...ok, name: 7 } }).ndi.name).toBe('PPT Share')
  })

  it('only accepts the two allowed resolutions (as a pair)', () => {
    const odd = sanitizeSettings({ ndi: { ...ok, width: 1280, height: 720 } }).ndi
    expect([odd.width, odd.height]).toEqual([1920, 1080])
    const mixed = sanitizeSettings({ ndi: { ...ok, width: 3840, height: 1080 } }).ndi
    expect([mixed.width, mixed.height]).toEqual([1920, 1080])
    const uhd = sanitizeSettings({ ndi: { ...ok, width: 3840, height: 2160, fps: 60 } }).ndi
    expect([uhd.width, uhd.height, uhd.fps]).toEqual([3840, 2160, 60])
  })

  it('trims the name and keeps valid fields', () => {
    expect(sanitizeSettings({ ndi: { ...ok, name: '  Aula  ', enabled: false } }).ndi).toEqual({
      ...ok,
      name: 'Aula',
      enabled: false
    })
  })

  it('drops unknown fields', () => {
    expect(sanitizeSettings({ ndi: { ...ok, extra: 1 }, other: 2 })).toEqual(DEFAULT_SETTINGS)
  })
})

describe('ndiSettingsError', () => {
  const ok = DEFAULT_SETTINGS.ndi

  it('accepts valid settings', () => {
    expect(ndiSettingsError(ok)).toBeNull()
    expect(ndiSettingsError({ ...ok, width: 3840, height: 2160, fps: 60 })).toBeNull()
  })

  it('explains invalid input in Indonesian with a fix', () => {
    expect(ndiSettingsError({ ...ok, name: '  ' })).toMatch(/Nama source.*kosong/)
    expect(ndiSettingsError({ ...ok, name: 'x'.repeat(64) })).toMatch(/63 karakter/)
    expect(ndiSettingsError({ ...ok, width: 1280, height: 720 })).toMatch(/Resolusi/)
    expect(ndiSettingsError({ ...ok, fps: 24 })).toMatch(/30 atau 60/)
    expect(ndiSettingsError({ ...ok, enabled: 1 })).toMatch(/tidak valid/)
    expect(ndiSettingsError(null)).toMatch(/tidak valid/)
  })
})
