import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { migrateUserData } from './migrate-user-data'

const roots: string[] = []
function appData(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'bridgecast-mig-'))
  roots.push(d)
  return d
}
afterEach(() => {
  for (const r of roots.splice(0)) fs.rmSync(r, { recursive: true, force: true })
})

describe('migrateUserData', () => {
  it('moves the old folder when the new one does not exist', () => {
    const a = appData()
    fs.mkdirSync(path.join(a, 'PPT Share'))
    fs.writeFileSync(path.join(a, 'PPT Share', 'events.json'), '[]')
    const moved = migrateUserData(path.join(a, 'Bridgecast'), a)
    expect(moved).toBe(path.join(a, 'PPT Share'))
    expect(fs.readFileSync(path.join(a, 'Bridgecast', 'events.json'), 'utf8')).toBe('[]')
    expect(fs.existsSync(path.join(a, 'PPT Share'))).toBe(false)
  })
  it('falls back to the dev folder name', () => {
    const a = appData()
    fs.mkdirSync(path.join(a, 'ppt-share'))
    expect(migrateUserData(path.join(a, 'bridgecast'), a)).toBe(path.join(a, 'ppt-share'))
  })
  it('does nothing when the new folder already exists', () => {
    const a = appData()
    fs.mkdirSync(path.join(a, 'Bridgecast'))
    fs.mkdirSync(path.join(a, 'PPT Share'))
    expect(migrateUserData(path.join(a, 'Bridgecast'), a)).toBeNull()
    expect(fs.existsSync(path.join(a, 'PPT Share'))).toBe(true)
  })
  it('does nothing when there is no old folder', () => {
    const a = appData()
    expect(migrateUserData(path.join(a, 'Bridgecast'), a)).toBeNull()
  })
})
