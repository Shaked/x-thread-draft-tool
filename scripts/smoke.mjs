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
const PUBLIC_PATHS = new Set(['/api/health', '/llms.txt', '/api/openapi.json'])
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

async function call(method, path, { body, expect = [200], accept, raw = false } = {}) {
  const init = { method, headers: headers(accept ? { accept } : {}, path) }
  if (body !== undefined) {
    init.body = JSON.stringify(body)
    init.headers['content-type'] = 'application/json'
  }
  const response = await fetch(`${base}${path}`, init)
  const text = await response.text()
  if (!expect.includes(response.status)) {
    throw new Error(`${method} ${path} returned ${response.status}: ${redact(text).slice(0, 200)}`)
  }
  if (raw) return { status: response.status, text, type: response.headers.get('content-type') || '' }
  return text ? JSON.parse(text) : {}
}

const results = []
async function step(name, fn) {
  try {
    const value = await fn()
    console.log(`PASS ${name}`)
    results.push(true)
    return value
  } catch (error) {
    console.log(`FAIL ${name}: ${redact(error.message)}`)
    results.push(false)
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
const publicRequest = (path, init = {}) =>
  fetch(`${base}${path}`, {
    ...init,
    headers: { ...(bypass ? { 'x-vercel-protection-bypass': bypass } : {}), ...(init.headers || {}) }
  })

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
