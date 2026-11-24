// Release data for the site, read from GitHub Releases when the site is built. The notes are
// the CHANGELOG.md section that scripts/release.mjs publishes as the release body.

export const REPO = 'CallMeSon/Bridgecast'
export const REPO_URL = `https://github.com/${REPO}`

export type SectionType = 'new' | 'updates' | 'bugfixes' | 'other'
export type Section = { type: SectionType; title: string; items: string[] }
export type Asset = { name: string; url: string; size: number }
export type Release = {
  tag: string
  version: string
  date: string
  url: string
  sections: Section[]
  assets: Asset[]
}

// Keep a Changelog headings mapped to the template's badge colours.
const TYPES: Record<string, SectionType> = {
  added: 'new',
  changed: 'updates',
  deprecated: 'updates',
  removed: 'updates',
  fixed: 'bugfixes',
  security: 'bugfixes'
}

export function parseNotes(body: string): Section[] {
  const sections: Section[] = []
  let current: Section | undefined

  for (const raw of body.split(/\r?\n/)) {
    const line = raw.trim()
    const heading = /^#{2,4}\s+(.+)$/.exec(line)

    if (heading) {
      current = { type: TYPES[heading[1].toLowerCase()] ?? 'other', title: heading[1], items: [] }
      sections.push(current)
      continue
    }

    if (!line) continue

    if (!current) {
      current = { type: 'other', title: 'Notes', items: [] }
      sections.push(current)
    }

    const bullet = /^[-*]\s+(.+)$/.exec(line)

    if (bullet || current.items.length === 0) current.items.push(bullet ? bullet[1] : line)
    else current.items[current.items.length - 1] += ` ${line}`
  }

  return sections.filter(section => section.items.length > 0)
}

export type Platform = 'windows' | 'macArm64' | 'macX64' | 'appImage' | 'deb'
export type Download = Asset & { version: string }

const FILES: Record<Platform, RegExp> = {
  windows: /-setup\.exe$/,
  macArm64: /-arm64\.dmg$/,
  macX64: /-x64\.dmg$/,
  appImage: /\.AppImage$/,
  deb: /_amd64\.deb$/
}

// Each OS is built on its own machine and may land later than the others, so every platform
// takes the newest release (releases come newest first) that carries its file.
export function pickDownloads(releases: Release[]): Partial<Record<Platform, Download>> {
  const picked: Partial<Record<Platform, Download>> = {}

  for (const platform of Object.keys(FILES) as Platform[]) {
    for (const release of releases) {
      const asset = release.assets.find(a => FILES[platform].test(a.name))

      if (asset) {
        picked[platform] = { ...asset, version: release.version }
        break
      }
    }
  }

  return picked
}

type GitHubRelease = {
  tag_name: string
  html_url: string
  published_at: string
  body: string | null
  draft: boolean
  prerelease: boolean
  assets: { name: string; browser_download_url: string; size: number }[]
}

export async function getReleases(): Promise<Release[]> {
  const headers: Record<string, string> = { Accept: 'application/vnd.github+json' }

  // The Pages workflow passes its token; without one GitHub allows 60 requests an hour.
  if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`

  const res = await fetch(`https://api.github.com/repos/${REPO}/releases?per_page=100`, { headers })

  if (!res.ok) throw new Error(`GitHub releases: HTTP ${res.status}`)

  const data = (await res.json()) as GitHubRelease[]

  return data
    .filter(r => !r.draft && !r.prerelease)
    .sort((a, b) => b.published_at.localeCompare(a.published_at))
    .map(r => ({
      tag: r.tag_name,
      version: r.tag_name.replace(/^v/, ''),
      date: new Date(r.published_at).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        timeZone: 'UTC'
      }),
      url: r.html_url,
      sections: parseNotes(r.body ?? ''),
      assets: r.assets.map(a => ({ name: a.name, url: a.browser_download_url, size: a.size }))
    }))
}

export function formatSize(bytes: number): string {
  return `${Math.round(bytes / 1024 / 1024)} MB`
}
