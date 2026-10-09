// Canva Connect spike: does a per-page MP4 export carry the presentation animations?
//
//   node scripts/canva-spike.mjs                 list designs (id, pages, title)
//   node scripts/canva-spike.mjs <design URL|ID>  export PNG + per-page MP4, download, write report.json
//   node scripts/canva-spike.mjs --login         force a new OAuth login
//
// Credentials: .superpowers/canva-spike/canva.env (CANVA_CLIENT_ID, CANVA_CLIENT_SECRET).
// Integration redirect URL must be http://127.0.0.1:3001/oauth/redirect.
// Afterwards: npx electron scripts/canva-analyze.cjs .superpowers/canva-spike/<designId>

import { createHash, randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { join, resolve } from 'node:path'
import { spawn } from 'node:child_process'

const ROOT = resolve('.superpowers/canva-spike')
const ENV_FILE = join(ROOT, 'canva.env')
const TOKEN_FILE = join(ROOT, 'token.json')
const API = 'https://api.canva.com/rest/v1'
const AUTHORIZE = 'https://www.canva.com/api/oauth/authorize'
const REDIRECT = 'http://127.0.0.1:3001/oauth/redirect'
const SCOPES = 'design:meta:read design:content:read'
const EXPORT_GAP_MS = 3200

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const b64url = (buf) => buf.toString('base64url')

function loadEnv() {
  if (!existsSync(ENV_FILE)) {
    mkdirSync(ROOT, { recursive: true })
    console.error(`Missing ${ENV_FILE}\nCreate it with:\n  CANVA_CLIENT_ID=...\n  CANVA_CLIENT_SECRET=...`)
    process.exit(1)
  }
  const env = {}
  for (const line of readFileSync(ENV_FILE, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/)
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '')
  }
  if (!env.CANVA_CLIENT_ID || !env.CANVA_CLIENT_SECRET) {
    console.error(`${ENV_FILE} needs CANVA_CLIENT_ID and CANVA_CLIENT_SECRET`)
    process.exit(1)
  }
  return env
}

const env = loadEnv()
const basic = 'Basic ' + Buffer.from(`${env.CANVA_CLIENT_ID}:${env.CANVA_CLIENT_SECRET}`).toString('base64')

async function tokenRequest(params) {
  const res = await fetch(`${API}/oauth/token`, {
    method: 'POST',
    headers: { Authorization: basic, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params)
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(`token ${res.status}: ${JSON.stringify(body)}`)
  const token = {
    access_token: body.access_token,
    refresh_token: body.refresh_token,
    expires_at: Date.now() + (body.expires_in ?? 14400) * 1000 - 60_000,
    scope: body.scope
  }
  writeFileSync(TOKEN_FILE, JSON.stringify(token, null, 2))
  return token
}

function openBrowser(url) {
  // rundll32 avoids cmd.exe mangling the & in the query string
  const [cmd, args] =
    process.platform === 'win32'
      ? ['rundll32', ['url.dll,FileProtocolHandler', url]]
      : [process.platform === 'darwin' ? 'open' : 'xdg-open', [url]]
  spawn(cmd, args, { detached: true, stdio: 'ignore' }).unref()
}

function login() {
  const verifier = b64url(randomBytes(64))
  const challenge = b64url(createHash('sha256').update(verifier).digest())
  const state = b64url(randomBytes(24))
  const url =
    AUTHORIZE +
    '?' +
    new URLSearchParams({
      code_challenge: challenge,
      code_challenge_method: 's256',
      scope: SCOPES,
      response_type: 'code',
      client_id: env.CANVA_CLIENT_ID,
      redirect_uri: REDIRECT,
      state
    })

  return new Promise((resolveLogin, reject) => {
    const server = createServer(async (req, res) => {
      const u = new URL(req.url, REDIRECT)
      if (u.pathname !== '/oauth/redirect') {
        res.writeHead(404).end()
        return
      }
      const finish = (msg, err) => {
        res.writeHead(err ? 400 : 200, { 'Content-Type': 'text/plain; charset=utf-8' }).end(msg)
        server.close()
        err ? reject(err) : null
      }
      if (u.searchParams.get('state') !== state) return finish('State mismatch.', new Error('state mismatch'))
      const code = u.searchParams.get('code')
      if (!code) return finish('No code: ' + u.search, new Error('authorize failed: ' + u.search))
      try {
        const token = await tokenRequest({
          grant_type: 'authorization_code',
          code,
          code_verifier: verifier,
          redirect_uri: REDIRECT
        })
        finish('Canva login OK. You can close this tab.')
        resolveLogin(token)
      } catch (e) {
        finish('Token exchange failed: ' + e.message, e)
      }
    })
    server.listen(3001, '127.0.0.1', () => {
      console.log('Opening Canva login in the browser. If it does not open, visit:\n' + url)
      openBrowser(url)
    })
    server.on('error', reject)
  })
}

let token = null

async function getToken(force = false) {
  if (!token && existsSync(TOKEN_FILE)) token = JSON.parse(readFileSync(TOKEN_FILE, 'utf8'))
  if (force || !token) return (token = await login())
  if (Date.now() < token.expires_at) return token
  try {
    return (token = await tokenRequest({ grant_type: 'refresh_token', refresh_token: token.refresh_token }))
  } catch (e) {
    console.warn('Refresh failed, logging in again:', e.message)
    return (token = await login())
  }
}

async function api(method, path, body) {
  for (let attempt = 0; ; attempt++) {
    const t = await getToken()
    const res = await fetch(API + path, {
      method,
      headers: {
        Authorization: `Bearer ${t.access_token}`,
        ...(body ? { 'Content-Type': 'application/json' } : {})
      },
      body: body ? JSON.stringify(body) : undefined
    })
    if (res.status === 401 && attempt === 0) {
      token.expires_at = 0
      continue
    }
    if (res.status === 429 && attempt < 5) {
      const wait = Number(res.headers.get('retry-after') ?? 15) * 1000
      console.warn(`429 on ${path}, waiting ${wait / 1000}s`)
      await sleep(wait)
      continue
    }
    const json = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(`${method} ${path} ${res.status}: ${JSON.stringify(json)}`)
    return json
  }
}

async function listDesigns() {
  let continuation
  let n = 0
  do {
    const q = new URLSearchParams({ limit: '100', ...(continuation ? { continuation } : {}) })
    const page = await api('GET', `/designs?${q}`)
    for (const d of page.items ?? []) {
      n++
      console.log(`${d.id}\t${d.page_count ?? '?'} pages\t${d.title ?? '(untitled)'}`)
    }
    continuation = page.continuation
  } while (continuation)
  console.log(`${n} designs`)
}

function parseDesignId(arg) {
  const m = arg.match(/canva\.com\/design\/([A-Za-z0-9_-]+)/)
  return m ? m[1] : arg
}

async function runExport(designId, format) {
  const started = Date.now()
  const { job } = await api('POST', '/exports', { design_id: designId, format })
  let current = job
  while (current.status === 'in_progress') {
    await sleep(1500)
    current = (await api('GET', `/exports/${job.id}`)).job
  }
  const ms = Date.now() - started
  if (current.status !== 'success') {
    return { ok: false, ms, error: current.error ?? current }
  }
  return { ok: true, ms, urls: current.urls }
}

async function download(url, file) {
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(90_000) })
      if (!res.ok) throw new Error(`download ${res.status} ${file}`)
      const buf = Buffer.from(await res.arrayBuffer())
      writeFileSync(file, buf)
      return buf.length
    } catch (e) {
      if (attempt >= 3) throw e
      console.warn(`  retry ${attempt} ${file}: ${e.message}`)
      await sleep(2000)
    }
  }
}

const pad = (n) => String(n).padStart(2, '0')

async function exportDesign(arg) {
  const designId = parseDesignId(arg)
  const { design } = await api('GET', `/designs/${designId}`)
  const pageCount = design.page_count
  console.log(`Design ${designId}: "${design.title}", ${pageCount} pages`)

  const formats = await api('GET', `/designs/${designId}/export-formats`)
  console.log('Export formats:', JSON.stringify(formats.formats ?? formats))

  const dir = join(ROOT, designId)
  mkdirSync(dir, { recursive: true })
  const report = {
    designId,
    title: design.title,
    pageCount,
    exportedAt: new Date().toISOString(),
    exportFormats: formats.formats ?? formats,
    png: null,
    pages: []
  }
  const save = () => writeFileSync(join(dir, 'report.json'), JSON.stringify(report, null, 2))

  // Resume: files already on disk are kept, only the missing ones are exported again.
  const has = (name) => existsSync(join(dir, name))
  const missingPng = Array.from({ length: pageCount }, (_, i) => i + 1).filter((p) => !has(`page-${pad(p)}.png`))
  if (missingPng.length) {
    console.log(`PNG export, ${missingPng.length} pages...`)
    const png = await runExport(designId, { type: 'png', pages: missingPng })
    report.png = { ok: png.ok, ms: png.ms, error: png.error }
    if (png.ok) {
      for (let i = 0; i < png.urls.length; i++) {
        const p = missingPng[i]
        await download(png.urls[i], join(dir, `page-${pad(p)}.png`))
        process.stdout.write(`png ${p} `)
      }
      console.log(`\n  ${png.urls.length} PNG in ${png.ms} ms`)
    } else {
      console.log('  PNG failed:', JSON.stringify(png.error))
    }
  }
  for (let p = 1; p <= pageCount; p++) {
    report.pages[p - 1] = { page: p }
    if (has(`page-${pad(p)}.png`)) report.pages[p - 1].pngBytes = statSync(join(dir, `page-${pad(p)}.png`)).size
  }
  save()

  for (let p = 1; p <= pageCount; p++) {
    if (has(`page-${pad(p)}.mp4`)) {
      report.pages[p - 1].mp4Bytes = statSync(join(dir, `page-${pad(p)}.mp4`)).size
      continue
    }
    await sleep(EXPORT_GAP_MS)
    process.stdout.write(`MP4 page ${p}/${pageCount}... `)
    const entry = (report.pages[p - 1] ??= { page: p })
    try {
      const mp4 = await runExport(designId, { type: 'mp4', quality: 'horizontal_1080p', pages: [p] })
      entry.mp4Ms = mp4.ms
      if (mp4.ok) {
        entry.mp4Bytes = await download(mp4.urls[0], join(dir, `page-${pad(p)}.mp4`))
        if (mp4.urls.length !== 1) entry.mp4UrlCount = mp4.urls.length
        console.log(`${mp4.ms} ms, ${(entry.mp4Bytes / 1024).toFixed(0)} KB`)
      } else {
        entry.mp4Error = mp4.error
        console.log('failed:', JSON.stringify(mp4.error))
      }
    } catch (e) {
      entry.mp4Error = e.message
      console.log('error:', e.message)
    }
    save()
  }

  console.log(`\nSaved to ${dir}\nNext: npx electron scripts/canva-analyze.cjs "${dir}"`)
}

const arg = process.argv[2]
try {
  if (arg === '--login') {
    await getToken(true)
    console.log('Logged in. Scope:', token.scope)
  } else if (arg) {
    await exportDesign(arg)
  } else {
    await listDesigns()
  }
} catch (e) {
  console.error(e.message)
  process.exit(1)
}
