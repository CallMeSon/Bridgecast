import assert from 'node:assert/strict'
import { test } from 'node:test'

import { parseNotes, pickDownloads } from './releases.ts'
import type { Release } from './releases.ts'

test('parseNotes maps changelog headings and joins wrapped lines', () => {
  const sections = parseNotes(
    '### Added\n\n- One\n  still one\n- Two\n\n### Fixed\n\n- Three\n\n### Changed\n'
  )

  assert.deepEqual(sections, [
    { type: 'new', title: 'Added', items: ['One still one', 'Two'] },
    { type: 'bugfixes', title: 'Fixed', items: ['Three'] }
  ])
})

test('parseNotes keeps text without a heading', () => {
  assert.deepEqual(parseNotes('Plain note'), [{ type: 'other', title: 'Notes', items: ['Plain note'] }])
})

const release = (version: string, names: string[]): Release => ({
  tag: `v${version}`,
  version,
  date: '',
  url: '',
  sections: [],
  assets: names.map(name => ({ name, url: `u/${name}`, size: 1 }))
})

test('pickDownloads takes the newest release that carries each file', () => {
  const picked = pickDownloads([
    release('0.1.14', ['bridgecast-0.1.14-setup.exe', 'bridgecast-0.1.14-arm64.dmg', 'latest.yml']),
    release('0.1.13', ['bridgecast-0.1.13.AppImage', 'bridgecast_0.1.13_amd64.deb'])
  ])

  assert.equal(picked.windows?.version, '0.1.14')
  assert.equal(picked.macArm64?.name, 'bridgecast-0.1.14-arm64.dmg')
  assert.equal(picked.appImage?.version, '0.1.13')
  assert.equal(picked.deb?.version, '0.1.13')
  assert.equal(picked.macX64, undefined)
})
