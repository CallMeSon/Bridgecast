#!/usr/bin/env node
// Release one version to the shared GitHub release: validate the tree and changelog, build the
// installers with publishing disabled, verify their files, then attach them to v<version>.
// Dry run is the default; --publish builds and publishes for real.
import { execFileSync } from 'node:child_process'
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const argv = process.argv.slice(2)

function fail(message) {
  console.error(`release: ${message}`)
  process.exit(1)
}

function option(name, fallback) {
  const at = argv.indexOf(`--${name}`)
  if (at < 0) return fallback
  const value = argv[at + 1]
  if (!value || value.startsWith('--')) fail(`--${name} needs a value.`)
  return value
}

const flag = (name) => argv.includes(`--${name}`)
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))

// Standalone check: does the published v<version> carry both OSes' artifacts? The two builds
// are made on different machines, so this is a rule about the published release, not about
// one machine's dist/. Usage: node scripts/release.mjs --check [version]
const checkFlag = argv.indexOf('--check')
if (checkFlag >= 0) {
  const which =
    argv[checkFlag + 1] && !argv[checkFlag + 1].startsWith('--') ? argv[checkFlag + 1] : pkg.version
  const tag = which.startsWith('v') ? which : `v${which}`
  const version = tag.slice(1)
  const assetsFor = (os) => {
    const base = `${pkg.name}-${version}`
    if (os === 'win') return [`${base}-setup.exe`, `${base}-setup.exe.blockmap`, 'latest.yml']
    return [`${base}.AppImage`, `latest-linux.yml`, `${pkg.name}_${version}_amd64.deb`]
  }
  let names
  try {
    names = execFileSync(
      'gh',
      ['release', 'view', tag, '--json', 'assets', '--jq', '.assets[].name'],
      { cwd: root, encoding: 'utf8' }
    )
      .split(/\r?\n/)
      .filter(Boolean)
  } catch {
    console.error(`Release ${tag} was not found (or gh is not signed in).`)
    process.exit(1)
  }
  const have = new Set(names)
  const missing = ['win', 'linux'].flatMap((os) =>
    assetsFor(os)
      .filter((a) => !have.has(a))
      .map((a) => `${os}: ${a}`)
  )
  if (missing.length > 0) {
    console.error(`Release ${tag} is INCOMPLETE — missing:\n  ${missing.join('\n  ')}`)
    process.exit(1)
  }
  console.log(`Release ${tag} carries the Windows and the Linux artifacts.`)
  process.exit(0)
}

const publish = flag('publish')
const dryRun = !publish || flag('dry-run')
const branch = option('branch', 'main')
// A release is not one machine: the Windows installer and the Linux AppImage/.deb are built
// on their own OS and meet on the same v<version>. `--check` verifies that both sets made it.
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

// (b) Clean tree on the named release branch: no tracked changes and no untracked files.
const git = (args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim()
const currentBranch = git(['rev-parse', '--abbrev-ref', 'HEAD'])
if (currentBranch !== branch) {
  fail(`Expected branch '${branch}', found '${currentBranch}'. Pass --branch <name>.`)
}
const dirty = git(['status', '--porcelain'])
if (dirty) fail(`The working tree is not clean (uncommitted changes or untracked files):\n${dirty}`)

// (c) Build commands: the bridge is only needed by the Windows installer.
// electron-builder's artifactName templates use ${name}, which expands to the lowercase
// "name" field in package.json — not productName. So the emitted files are bridgecast-*,
// and the NSIS blockmap is a standalone <installer>.blockmap; AppImage embeds its blockmap
// inside the .AppImage and never emits a separate one.
const installer = (platform) =>
  platform === 'win'
    ? `dist/${pkg.name}-${version}-setup.exe`
    : `dist/${pkg.name}-${version}.AppImage`
const required = (platform) =>
  platform === 'win'
    ? [installer(platform), 'dist/latest.yml']
    : // The .deb is published for PCs where an AppImage is awkward; it cannot self-update.
      [installer(platform), 'dist/latest-linux.yml', `dist/${pkg.name}_${version}_amd64.deb`]
const blockmaps = (platform) => (platform === 'win' ? [`${installer(platform)}.blockmap`] : [])
const buildCommands = []
// electron-builder only packages out/: build the current source first, otherwise a stale out/
// (or a machine that never ran a build) silently ships old code under the new version.
buildCommands.push(['npm', ['run', 'build']])
if (
  platforms.includes('win') &&
  !existsSync(join(root, 'native/ppt-bridge/bin/Release/net48/ppt-bridge.exe'))
) {
  buildCommands.push(['npm', ['run', 'build:bridge']])
}
// The installer ships the WebView2 helper too. Rebuild it only when its output is older
// than its sources: a stale exe must not ship, and rebuilding a running helper fails on
// Windows because the app keeps the exe locked.
function helperIsStale() {
  const exe = join(root, 'native/web-bridge/bin/Release/net48/web-bridge.exe')
  if (!existsSync(exe)) return true
  const sources = []
  const walk = (dir) => {
    if (!existsSync(dir)) return
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name)
      if (entry.isDirectory()) {
        if (entry.name !== 'bin' && entry.name !== 'obj') walk(full)
      } else if (/\.(cs|csproj|manifest)$/i.test(entry.name)) sources.push(full)
    }
  }
  walk(join(root, 'native/web-bridge'))
  for (const shared of ['Audio.cs', 'PingPolicy.cs', 'Native.cs']) {
    sources.push(join(root, 'native/ppt-bridge', shared))
  }
  const built = statSync(exe).mtimeMs
  return sources.some((file) => statSync(file).mtimeMs > built)
}
if (platforms.includes('win') && helperIsStale()) {
  buildCommands.push([
    'npm',
    ['run', process.platform === 'win32' ? 'build:web-bridge:win' : 'build:web-bridge']
  ])
}
for (const platform of platforms) {
  const target = platform === 'win' ? ['--win'] : ['--linux', 'AppImage', 'deb']
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
        // Without --target, gh creates a new tag on the repo's default branch, which may not be
        // the release branch when --branch names another one.
        '--target',
        branch,
        '--title',
        `Bridgecast ${version}`,
        '--notes-file',
        notesFile
      ]
const show = (cmd, args) => console.log(`+ ${cmd} ${args.join(' ')}`)
const planArtifacts = platforms.flatMap((p) => [...required(p), ...blockmaps(p)])
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
    console.log(`Verify: ${[...required(platform), ...blockmaps(platform)].join(', ')}`)
  }
  show('gh', releaseArgs('create', planArtifacts))
  console.log('If the release exists, gh release upload <tag> ... --clobber is used instead.')
  console.log('Nothing was built or published. Re-run with --publish to do it.')
  process.exit(0)
}

const releaseMode = modeOfRelease()
// npm and npx are .cmd shims on Windows: Node only runs those through a shell.
const shell = process.platform === 'win32'
for (const [cmd, args] of buildCommands) {
  show(cmd, args)
  execFileSync(cmd, args, { cwd: root, stdio: 'inherit', shell })
}

// (d) Fail before publishing if a platform's installer, update metadata or (Windows)
// blockmap is missing. The verified set is exactly what gets uploaded to the release.
const artifacts = platforms.flatMap((platform) => {
  const expected = [...required(platform), ...blockmaps(platform)]
  for (const file of expected) {
    if (!existsSync(join(root, file))) fail(`Missing ${file} after the build.`)
  }
  return expected
})
console.log(`Verified artifacts: ${artifacts.join(', ')}`)

const args = releaseArgs(releaseMode, artifacts)
show('gh', args)
try {
  execFileSync('gh', args, { cwd: root, stdio: 'inherit' })
} catch (error) {
  fail(`gh ${releaseMode} failed: ${error.message}`)
}
// One OS publishes at a time and the tag may already exist: a release is not finished until
// both sets of artifacts are attached. Report what is still missing so nobody forgets the
// other machine's build.
try {
  const names = execFileSync(
    'gh',
    ['release', 'view', `v${version}`, '--json', 'assets', '--jq', '.assets[].name'],
    { cwd: root, encoding: 'utf8' }
  )
    .split(/\r?\n/)
    .filter(Boolean)
  const have = new Set(names)
  const expected = ['win', 'linux'].flatMap((p) => [...required(p), ...blockmaps(p)])
  const missing = expected.filter((f) => !have.has(f.split('/').pop()))
  if (missing.length > 0) {
    console.log(
      `NOTE: v${version} is missing the other build:\n  ${missing.join('\n  ')}\nRun 'node scripts/release.mjs --check ${version}' after the other OS publishes.`
    )
  } else {
    console.log(`v${version} carries the Windows and the Linux artifacts.`)
  }
} catch {
  console.log(
    `Run 'node scripts/release.mjs --check ${version}' to confirm both OSes are attached.`
  )
}
console.log(`Published Bridgecast ${version} to v${version}.`)
