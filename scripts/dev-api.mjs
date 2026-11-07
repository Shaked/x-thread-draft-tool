#!/usr/bin/env node
// Local headless server for the API: the same route() the Vercel function uses, on 127.0.0.1.
// PGlite stands in for Neon (in memory, or --data-dir <dir>), and a folder stands in for Blob.
//
//   npm run dev:api                      # http://127.0.0.1:8787 (PORT to change)
//   npm run dev:api -- --fake-github     # device flow auto-approves without github.com
//   npm run dev:api -- --data-dir .dev-db
//
// Dev-only routes (/api/dev/*) are answered here, before route() runs. Nothing under server/
// knows about them, and this script refuses to run on Vercel.
import http from 'node:http'
import { randomBytes } from 'node:crypto'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { applyMigrations } from './migrate.mjs'
import { setQueryImpl } from '../server/db.js'
import { setBlobImpl } from '../server/blob.js'
import { route } from '../server/router.js'
import { upsertGithubUser } from '../server/github-user.js'
import { createApiToken } from '../server/tokens.js'

if (process.env.VERCEL) {
  console.error('dev-api refuses to run on Vercel (VERCEL is set).')
  process.exit(1)
}

const args = process.argv.slice(2)
const fakeGithub = args.includes('--fake-github')
const dataDirIndex = args.indexOf('--data-dir')
const dataDir = dataDirIndex === -1 ? null : args[dataDirIndex + 1]
const port = Number(process.env.PORT || 8787)
const base = `http://127.0.0.1:${port}`
const BLOB_DIR = path.resolve('.dev-blob')
const PUBLIC_DIR = path.resolve('public')
const BLOB_PREFIX = `${base}/dev-blob/`

process.env.PUBLIC_APP_URL = base
process.env.SESSION_SECRET ||= randomBytes(48).toString('base64')
process.env.GITHUB_CLIENT_ID ||= 'dev-client-id'
process.env.GITHUB_CLIENT_SECRET ||= 'dev-client-secret'

// --- Database: PGlite -------------------------------------------------------
const pg = new PGlite(dataDir ?? undefined)
setQueryImpl(async (text, params = []) => {
  const result = await pg.query(text, params)
  return { rows: result.rows, rowCount: result.affectedRows ?? result.rows.length }
})
await applyMigrations((text, params) =>
  params === undefined
    ? pg.exec(text).then((results) => ({ rows: results.at(-1)?.rows ?? [] }))
    : pg.query(text, params)
)

// --- Blob: a folder under .dev-blob/ ----------------------------------------
await mkdir(BLOB_DIR, { recursive: true })
setBlobImpl({
  async put(pathname, body, { contentType }) {
    const key = pathname.replace(/\.([A-Za-z0-9]+)$/, `-${randomBytes(4).toString('hex')}.$1`)
    const file = path.join(BLOB_DIR, key)
    await mkdir(path.dirname(file), { recursive: true })
    await writeFile(file, body)
    return { url: `${BLOB_PREFIX}${key}`, contentType }
  },
  async del(urls) {
    for (const url of urls) {
      const key = url.slice(BLOB_PREFIX.length)
      await rm(path.join(BLOB_DIR, key), { force: true })
    }
  },
  key(url) {
    return url.startsWith(BLOB_PREFIX) ? url.slice(BLOB_PREFIX.length) : null
  }
})

// --- GitHub: optional auto-approving fake for device flow -------------------
if (fakeGithub) {
  const realFetch = globalThis.fetch
  globalThis.fetch = async (input, init) => {
    const url = String(input)
    const json = (body) => new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } })
    if (url === 'https://github.com/login/device/code') {
      return json({ device_code: 'dev-device-code', user_code: 'ABCD-1234', verification_uri: 'https://github.com/login/device', interval: 1, expires_in: 900 })
    }
    if (url === 'https://github.com/login/oauth/access_token') return json({ access_token: 'dev-github-token' })
    if (url === 'https://api.github.com/user') {
      return json({ id: 9001, login: 'dev-agent', name: 'Dev Agent', avatar_url: null })
    }
    return realFetch(input, init)
  }
}

// --- Dev-only routes ----------------------------------------------------------
async function devRoute(request, url) {
  if (request.method !== 'POST' || url.pathname !== '/api/dev/token') {
    return new Response(JSON.stringify({ error: 'Not found' }), { status: 404, headers: { 'content-type': 'application/json' } })
  }
  const body = await request.json().catch(() => ({}))
  const login = typeof body.login === 'string' && body.login.trim() ? body.login.trim() : 'dev-user'
  // Fake negative GitHub ids never collide with real accounts.
  const githubId = -(Math.abs(hash(login)) % 1_000_000_000) - 1
  const user = await upsertGithubUser({ id: githubId, login, name: login, avatar_url: null })
  const created = await createApiToken(user.id, { name: `dev ${login}`, via: 'web' })
  return new Response(JSON.stringify({ token: created.token, user: { id: user.id, login } }), {
    status: 201,
    headers: { 'content-type': 'application/json' }
  })
}

function hash(text) {
  let h = 0
  for (const ch of text) h = (h * 31 + ch.charCodeAt(0)) | 0
  return h
}

// --- HTTP: Node request <-> Web Request/Response ----------------------------
async function toWebRequest(req) {
  const chunks = []
  for await (const chunk of req) chunks.push(chunk)
  const init = { method: req.method, headers: req.headers }
  if (chunks.length > 0 && req.method !== 'GET' && req.method !== 'HEAD') init.body = Buffer.concat(chunks)
  return new Request(new URL(req.url, base), init)
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, base)

    if (req.method === 'GET' && url.pathname.startsWith('/dev-blob/')) {
      const file = path.join(BLOB_DIR, url.pathname.slice('/dev-blob/'.length))
      if (!file.startsWith(BLOB_DIR + path.sep)) return sendText(res, 400, 'Bad path')
      const data = await readFile(file).catch(() => null)
      if (!data) return sendText(res, 404, 'Not found')
      res.writeHead(200, { 'content-type': mimeFor(file), 'cache-control': 'no-store' })
      return res.end(data)
    }

    // Static files from public/ (like Vercel and Vite serve them), e.g. /llms.txt
    if (req.method === 'GET' && !url.pathname.startsWith('/api/') && url.pathname !== '/') {
      const file = path.join(PUBLIC_DIR, path.normalize(url.pathname))
      if (file.startsWith(PUBLIC_DIR + path.sep)) {
        const data = await readFile(file).catch(() => null)
        if (data) {
          res.writeHead(200, { 'content-type': file.endsWith('.txt') ? 'text/plain; charset=utf-8' : mimeFor(file) })
          return res.end(data)
        }
      }
    }

    const request = await toWebRequest(req)
    const response = url.pathname.startsWith('/api/dev/') ? await devRoute(request, url) : await route(request)

    const headers = {}
    for (const [name, value] of response.headers) {
      if (name !== 'set-cookie') headers[name] = value
    }
    const cookies = response.headers.getSetCookie?.() ?? []
    if (cookies.length) headers['set-cookie'] = cookies
    res.writeHead(response.status, headers)
    res.end(Buffer.from(await response.arrayBuffer()))
  } catch (error) {
    console.error('[dev-api]', error)
    sendText(res, 500, 'Server error')
  }
})

function sendText(res, status, text) {
  res.writeHead(status, { 'content-type': 'text/plain; charset=utf-8' })
  res.end(text)
}

function mimeFor(file) {
  if (file.endsWith('.png')) return 'image/png'
  if (file.endsWith('.jpg') || file.endsWith('.jpeg')) return 'image/jpeg'
  if (file.endsWith('.gif')) return 'image/gif'
  if (file.endsWith('.webp')) return 'image/webp'
  return 'application/octet-stream'
}

server.listen(port, '127.0.0.1', () => {
  console.log(`[dev-api] listening on ${base}${fakeGithub ? ' (fake GitHub device flow)' : ''}${dataDir ? ` data=${dataDir}` : ' (in-memory database)'}`)
})
