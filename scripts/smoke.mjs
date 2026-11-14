#!/usr/bin/env node
// Smoke test against a running deployment or the local dev server. Node 20 only, no dependencies.
//
//   XT_BASE_URL=http://127.0.0.1:8787 XT_TOKEN=xt_... node scripts/smoke.mjs
//   XT_BASE_URL=https://x-thread-draft-tool-preview.vercel.app node scripts/smoke.mjs
//
// XT_TOKEN is optional: omit it when a proxy injects the Authorization header.
// XT_SMOKE_PUBLIC=1 runs only the steps that need no account (for deployments whose database has
// no smoke-test user, such as per-branch previews); the account steps are reported as SKIP.
// VERCEL_AUTOMATION_BYPASS_SECRET is optional (sent as x-vercel-protection-bypass).
// Creates drafts titled "[smoke] <timestamp>" in the token owner's account and deletes them.
// Prints PASS/FAIL per step, exits 1 on any failure, and never prints the token.

const base = (process.env.XT_BASE_URL || '').replace(/\/$/, '')
if (!base) {
  console.error('FAIL setup: XT_BASE_URL is required')
  process.exit(1)
}
const token = process.env.XT_TOKEN || ''
const publicOnly = process.env.XT_SMOKE_PUBLIC === '1'
const bypass = process.env.VERCEL_AUTOMATION_BYPASS_SECRET || ''

// Routes that never take a token (the server refuses a CI JWT on any route not marked ci: true).
const PUBLIC_PATHS = new Set([
  '/api/health',
  '/llms.txt',
  '/api/openapi.json',
  '/.well-known/oauth-protected-resource/api/mcp',
  '/.well-known/oauth-authorization-server'
])
const isPublicPath = (path) => PUBLIC_PATHS.has(path) || path.startsWith('/api/share/')

function headers(extra = {}, path = '') {
  const out = { ...extra }
  if (token && !isPublicPath(path)) out.authorization = `Bearer ${token}`
  if (bypass) out['x-vercel-protection-bypass'] = bypass
  return out
}

// Replace the secret in any text before it reaches the console.
function redact(text) {
  let out = String(text)
  if (token) out = out.split(token).join('[token]')
  if (bypass) out = out.split(bypass).join('[secret]')
  return out
}

// The last request of the current step: its client time and the server's Server-Timing header (plan P1).
let last = null

async function call(method, path, { body, expect = [200], accept, raw = false } = {}) {
  const init = { method, headers: headers(accept ? { accept } : {}, path) }
  if (body !== undefined) {
    init.body = JSON.stringify(body)
    init.headers['content-type'] = 'application/json'
  }
  const started = performance.now()
  const response = await fetch(`${base}${path}`, init)
  const text = await response.text()
  last = { ms: performance.now() - started, server: response.headers.get('server-timing') }
  if (!expect.includes(response.status)) {
    throw new Error(`${method} ${path} returned ${response.status}: ${redact(text).slice(0, 200)}`)
  }
  if (raw) return { status: response.status, text, type: response.headers.get('content-type') || '' }
  return text ? JSON.parse(text) : {}
}

// One TIME line per step. Printed only; a missing value shows as none and never fails the run.
function timing(name) {
  const ms = last ? Math.round(last.ms) : 'none'
  console.log(`TIME ${name} client_ms=${ms} server=${last?.server ?? 'none'}`)
}

const results = []
async function step(name, fn) {
  last = null
  try {
    const value = await fn()
    console.log(`PASS ${name}`)
    results.push(true)
    timing(name)
    return value
  } catch (error) {
    console.log(`FAIL ${name}: ${redact(error.message)}`)
    results.push(false)
    timing(name)
    return undefined
  }
}

const stamp = new Date().toISOString()
const created = []

await step('health', async () => {
  const data = await call('GET', '/api/health')
  if (data.ok !== true) throw new Error('ok is not true')
})

await step('llms.txt', async () => {
  const res = await call('GET', '/llms.txt', { raw: true })
  if (!res.text.includes('X Thread Draft Tool')) throw new Error('llms.txt does not describe the app')
})

await step('openapi', async () => {
  const doc = await call('GET', '/api/openapi.json')
  if (typeof doc.openapi !== 'string') throw new Error('no openapi version in document')
})

// MCP connector, public (no account): the endpoint refuses a request without a token, and its
// metadata names the resource and the authorization server (plan M9).
const publicRequest = async (path, init = {}) => {
  const started = performance.now()
  const res = await fetch(`${base}${path}`, {
    ...init,
    headers: { ...(bypass ? { 'x-vercel-protection-bypass': bypass } : {}), ...(init.headers || {}) }
  })
  last = { ms: performance.now() - started, server: res.headers.get('server-timing') }
  return res
}

await step('mcp refuses a request without a token (401 with metadata link)', async () => {
  const res = await publicRequest('/api/mcp', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}'
  })
  if (res.status !== 401) throw new Error(`status is ${res.status}, expected 401`)
  const challenge = res.headers.get('www-authenticate') || ''
  if (!challenge.includes('/.well-known/oauth-protected-resource/api/mcp')) {
    throw new Error('www-authenticate does not name the metadata URL')
  }
})

await step('mcp metadata: resource ends with /api/mcp', async () => {
  const doc = await call('GET', '/.well-known/oauth-protected-resource/api/mcp')
  if (typeof doc.resource !== 'string' || !doc.resource.endsWith('/api/mcp')) {
    throw new Error('resource does not end with /api/mcp')
  }
})

await step('mcp authorization server: S256 and a registration endpoint', async () => {
  const doc = await call('GET', '/.well-known/oauth-authorization-server')
  if (!Array.isArray(doc.code_challenge_methods_supported) || !doc.code_challenge_methods_supported.includes('S256')) {
    throw new Error('S256 is not listed')
  }
  if (typeof doc.registration_endpoint !== 'string') throw new Error('no registration_endpoint')
})

// A bogus hand-made token is refused with the generic message (needs no account). Task 7.9.
await step('bogus xt_ token is refused (401, invalid or expired)', async () => {
  const res = await publicRequest('/api/auth/me', { headers: { authorization: `Bearer xt_${'b'.repeat(43)}` } })
  if (res.status !== 401) throw new Error(`status is ${res.status}, expected 401`)
  const { error } = await res.json()
  if (error !== 'Invalid or expired API token') throw new Error(`unexpected message: ${String(error).slice(0, 120)}`)
})

const accountStep = publicOnly ? async (name) => console.log(`SKIP ${name}: XT_SMOKE_PUBLIC=1`) : step

await accountStep('me (token)', async () => {
  const data = await call('GET', '/api/auth/me')
  if (!data.user) throw new Error('not signed in: check the token')
  // XT_EXPECT_AUTH: 'ci-oidc' for a CI identity token (the deployed smoke run). Unset: a hand-made
  // xt_ token ('token') or an access token from the device flow or the connector ('oauth').
  const expected = process.env.XT_EXPECT_AUTH ? [process.env.XT_EXPECT_AUTH] : ['token', 'oauth']
  if (!expected.includes(data.auth)) throw new Error(`auth is ${data.auth}, expected ${expected.join(' or ')}`)
})

await step('split text', async () => {
  const text = Array.from({ length: 40 }, (_, i) => `Sentence ${i} about smoke testing the API.`).join(' ')
  const data = await call('POST', '/api/threads/split', { body: { text, max_chars: 280 } })
  if (!Array.isArray(data.posts) || data.posts.length < 2) throw new Error('expected several posts')
})

const draft = await accountStep('create draft', async () => {
  const data = await call('POST', '/api/drafts', {
    body: {
      title: `[smoke] ${stamp}`,
      posts: [{ id: 'smoke-1', text: 'First smoke post', images: [], embeddedTweet: null }]
    },
    expect: [201]
  })
  created.push(data.draft.id)
  return data.draft
})

if (draft) {
  try {
    await step('patch posts', async () => {
      const data = await call('PATCH', `/api/drafts/${draft.id}`, {
        body: { posts: [{ id: 'smoke-1', text: 'Edited smoke post', images: [] }, { id: 'smoke-2', text: 'Second post', images: [] }] }
      })
      if (data.draft.posts.length !== 2) throw new Error('posts were not saved')
    })

    await step('get draft', async () => {
      const data = await call('GET', `/api/drafts/${draft.id}`)
      if (data.draft.posts[0].text !== 'Edited smoke post') throw new Error('edit not visible')
    })

    await step('signed-out read and export of a draft are refused (401)', async () => {
      for (const path of [`/api/drafts/${draft.id}`, `/api/drafts/${draft.id}/export?format=text`]) {
        const res = await publicRequest(path)
        if (res.status !== 401) throw new Error(`${path} returned ${res.status} without a token, expected 401`)
      }
    })

    const copy = await step('duplicate', async () => {
      const data = await call('POST', `/api/drafts/${draft.id}/duplicate`, { expect: [201] })
      created.push(data.draft.id)
      return data.draft
    })

    await step('export text', async () => {
      const res = await call('GET', `/api/drafts/${draft.id}/export?format=text`, { raw: true })
      if (!res.text.includes('Edited smoke post')) throw new Error('export is missing the post text')
    })

    const share = await step('create share token', async () => {
      return (await call('POST', `/api/drafts/${draft.id}/share-tokens`, { expect: [201] })).token
    })

    if (share) {
      await step('share link works once (200)', async () => {
        const res = await call('GET', `/api/share/${share}.md`, { raw: true })
        if (!res.text.includes('Edited smoke post')) throw new Error('shared markdown is missing the post')
      })
      await step('share link is then expired (410)', async () => {
        await call('GET', `/api/share/${share}.md`, { expect: [410], raw: true })
      })
    }

    // Lifetimes (T2). No sleep: the server's expires_at shows when each link stops. The short link
    // is checked by its gap to the default link (which holds whatever the clock skew) and by the clock
    // (which tolerates up to 60 s of skew between this runner and the server).
    await step('share links: 60 s link works now, default is about an hour, a revoked link is 410', async () => {
      const short = await call('POST', `/api/drafts/${draft.id}/share-tokens`, {
        body: { expires_in: 60, one_time: false },
        expect: [201]
      })
      const hour = await call('POST', `/api/drafts/${draft.id}/share-tokens`, { expect: [201] })
      const secondsLeft = (iso) => (Date.parse(iso) - Date.now()) / 1000
      if (!(secondsLeft(short.expires_at) > 0 && secondsLeft(short.expires_at) < 120)) {
        throw new Error(`expires_in 60 gave expires_at ${short.expires_at}`)
      }
      if (!(secondsLeft(hour.expires_at) > 3500 && secondsLeft(hour.expires_at) < 3700)) {
        throw new Error(`default gave expires_at ${hour.expires_at}`)
      }
      const gap = (Date.parse(hour.expires_at) - Date.parse(short.expires_at)) / 1000
      if (!(gap > 3500 && gap < 3700)) throw new Error(`the two links differ by ${gap} s, expected about 3540`)
      if (hour.one_time !== true || short.one_time !== false) throw new Error('one_time does not match the request')

      const read = await call('GET', `/api/share/${short.token}.md`, { expect: [200], raw: true })
      if (!read.text.includes('Edited smoke post')) throw new Error('the reusable link did not return the draft')
      await call('DELETE', `/api/drafts/${draft.id}/share-tokens/${hour.token}`, { expect: [204] })
      await call('GET', `/api/share/${hour.token}.md`, { expect: [410], raw: true })
    })

    // Timing and encoding of a list read (plan P1). Not a pass or fail step: it never fails the run.
    if (token) {
      try {
        const started = performance.now()
        const res = await fetch(`${base}/api/drafts?published=false&limit=10`, {
          headers: headers({ 'accept-encoding': 'gzip, br' }, '/api/drafts')
        })
        await res.arrayBuffer()
        last = { ms: performance.now() - started, server: res.headers.get('server-timing') }
        console.log(`ENCODING ${res.headers.get('content-encoding') ?? 'none'}`)
        timing('list drafts')
      } catch (err) {
        // A network or decoding error here must not fail the smoke run: the probe is informational.
        console.log(`TIME list drafts unavailable (${err?.name ?? 'error'})`)
      }
    }

    if (copy) await step('copy is a separate draft', async () => {
      if (copy.id === draft.id) throw new Error('duplicate returned the same id')
    })
  } finally {
    for (const id of created) {
      await step(`delete ${id.slice(0, 8)}`, async () => {
        await call('DELETE', `/api/drafts/${id}`)
      })
    }
  }
}

const failed = results.filter((ok) => !ok).length
console.log(`\n${results.length - failed}/${results.length} passed`)
process.exit(failed ? 1 : 0)
