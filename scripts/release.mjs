#!/usr/bin/env node
// Release one version to the shared GitHub release: validate the tree and changelog, build the
// installers with publishing disabled, verify their files, then attach them to v<version>.
// Dry run is the default; --publish builds and publishes for real.
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const argv = process.argv.slice(2)

function fail(message) {
  console.error(`release: ${message}`)
  process.exit(1)
}

const flag = (name) => argv.includes(`--${name}`)
function option(name, fallback) {
  const at = argv.indexOf(`--${name}`)
  if (at < 0) return fallback
  const value = argv[at + 1]
  if (!value || value.startsWith('--')) fail(`--${name} needs a value.`)
  return value
}

const publish = flag('publish')
const dryRun = !publish || flag('dry-run')
const branch = option('branch', 'master')
const platforms = []
if (flag('win')) platforms.push('win')
if (flag('linux')) platforms.push('linux')
if (platforms.length === 0) {
  // Windows installers are built on Windows; macOS cannot self-update at all.
  if (process.platform === 'win32') platforms.push('win')
  else if (process.platform === 'linux') platforms.push('linux')
  else {
    fail(
      'No default target on macOS. Run --win on Windows or --linux on Linux; macOS builds do not self-update.'
    )
  }
}

// (a) Version and the matching changelog section, which becomes the release notes.
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const version = pkg.version
const lines = readFileSync(join(root, 'CHANGELOG.md'), 'utf8').split(/\r?\n/)
const heading = `## [${version}]`
const at = lines.findIndex((line) => line.startsWith(heading))
if (at < 0) fail(`CHANGELOG.md has no '${heading}' section.`)
const next = lines.findIndex((line, i) => i > at && line.startsWith('## ['))
const notesBody = lines
  .slice(at + 1, next < 0 ? undefined : next)
  .join('\n')
  .trim()
if (!notesBody) fail(`The '${heading}' section is empty.`)
const notesFile = join(mkdtempSync(join(tmpdir(), 'bridgecast-notes-')), 'notes.md')
writeFileSync(notesFile, `${notesBody}\n`)

// (b) Clean tracked tree on the named release branch. Untracked scratch files are ignored.
const git = (args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim()
const currentBranch = git(['rev-parse', '--abbrev-ref', 'HEAD'])
if (currentBranch !== branch) {
  fail(`Expected branch '${branch}', found '${currentBranch}'. Pass --branch <name>.`)
}
const dirty = git(['status', '--porcelain', '--untracked-files=no'])
if (dirty) fail(`The working tree has uncommitted tracked changes:\n${dirty}`)

// (c) Build commands: the bridge is only needed by the Windows installer.
const required = (platform) =>
  platform === 'win'
    ? [`dist/Bridgecast-${version}-setup.exe`, 'dist/latest.yml']
    : [`dist/Bridgecast-${version}.AppImage`, 'dist/latest-linux.yml']
const blockmap = (platform) =>
  platform === 'win'
    ? `dist/Bridgecast-${version}-setup.exe.blockmap`
    : `dist/Bridgecast-${version}.AppImage.blockmap`
const buildCommands = []
if (
  platforms.includes('win') &&
  !existsSync(join(root, 'native/ppt-bridge/bin/Release/net48/ppt-bridge.exe'))
) {
  buildCommands.push(['npm', ['run', 'build:bridge']])
}
for (const platform of platforms) {
  const target = platform === 'win' ? ['--win'] : ['--linux', 'AppImage']
  buildCommands.push(['npx', ['electron-builder', ...target, '--publish', 'never']])
}

// (e) Publish to one release so Windows and Linux builds from two machines end up together.
const releaseArgs = (mode, artifacts) =>
  mode === 'upload'
    ? ['release', 'upload', `v${version}`, ...artifacts, '--clobber']
    : [
        'release',
        'create',
        `v${version}`,
        ...artifacts,
        '--title',
        `Bridgecast ${version}`,
        '--notes-file',
        notesFile
      ]
const show = (cmd, args) => console.log(`+ ${cmd} ${args.join(' ')}`)
const planArtifacts = platforms.flatMap((p) => [...required(p), blockmap(p)])
function modeOfRelease() {
  try {
    execFileSync('gh', ['release', 'view', `v${version}`], { cwd: root, stdio: 'ignore' })
    return 'upload'
  } catch {
    return 'create'
  }
}

if (dryRun) {
  console.log(
    `Dry run — Bridgecast ${version}, branch ${branch}, targets: ${platforms.join(', ')}.`
  )
  for (const [cmd, args] of buildCommands) show(cmd, args)
  for (const platform of platforms) {
    console.log(
      `Verify: ${[...required(platform), blockmap(platform)].join(', ')} (blockmap when present)`
    )
  }
  show('gh', releaseArgs('create', planArtifacts))
  console.log('If the release exists, gh release upload <tag> ... --clobber is used instead.')
  console.log('Nothing was built or published. Re-run with --publish to do it.')
  process.exit(0)
}

const releaseMode = modeOfRelease()
for (const [cmd, args] of buildCommands) {
  show(cmd, args)
  execFileSync(cmd, args, { cwd: root, stdio: 'inherit' })
}

// (d) Fail before publishing if a platform's installer or update metadata is missing.
const artifacts = platforms.flatMap((platform) => {
  for (const file of required(platform)) {
    if (!existsSync(join(root, file))) fail(`Missing ${file} after the build.`)
  }
  const bm = blockmap(platform)
  return existsSync(join(root, bm)) ? [...required(platform), bm] : required(platform)
})
console.log(`Verified artifacts: ${artifacts.join(', ')}`)

const args = releaseArgs(releaseMode, artifacts)
show('gh', args)
try {
  execFileSync('gh', args, { cwd: root, stdio: 'inherit' })
} catch (error) {
  fail(`gh ${releaseMode} failed: ${error.message}`)
}
console.log(`Published Bridgecast ${version} to v${version}.`)
