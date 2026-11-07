import { describe, it, expect, beforeAll, afterEach } from 'vitest'
import { generateKeyPair, exportJWK, SignJWT, createLocalJWKSet } from 'jose'
import { verifyCiToken, setJwksForTests, ciAudience, OIDC_ISSUER, CI_WORKFLOW_PATH } from '../../server/oidc-ci.js'
import { route } from '../../server/router.js'
import { createHmac } from 'node:crypto'

const REPO_ID = '1136002672'
const WORKFLOW_REF = `Shaked/x-thread-draft-tool/${CI_WORKFLOW_PATH}@refs/heads/main`
const ENV = { CI_OIDC_ENABLED: '1', VERCEL_ENV: 'preview', CI_OIDC_REPOSITORY_ID: REPO_ID }

let signingKey
let otherKey
let kid = 'test-kid'

beforeAll(async () => {
  const { publicKey, privateKey } = await generateKeyPair('RS256')
  signingKey = privateKey
  otherKey = (await generateKeyPair('RS256')).privateKey
  const jwk = { ...(await exportJWK(publicKey)), kid, alg: 'RS256', use: 'sig' }
  setJwksForTests(createLocalJWKSet({ keys: [jwk] }))
})

afterEach(() => {
  // Each test sets its own env; nothing persists.
})

function claims(overrides = {}) {
  return {
    repository_id: REPO_ID,
    workflow_ref: WORKFLOW_REF,
    job_workflow_ref: WORKFLOW_REF,
    event_name: 'workflow_dispatch',
    ref: 'refs/heads/main',
    runner_environment: 'github-hosted',
    ...overrides
  }
}

async function mint(body = {}, { aud = ciAudience('preview'), key = signingKey, iat, exp } = {}) {
  const now = Math.floor(Date.now() / 1000)
  let jwt = new SignJWT(claims(body))
    .setProtectedHeader({ alg: 'RS256', kid })
    .setIssuer(OIDC_ISSUER)
    .setAudience(aud)
    .setSubject('repo:Shaked/x-thread-draft-tool:ref:refs/heads/main')
    .setNotBefore(now - 5)
  jwt = jwt.setIssuedAt(iat ?? now)
  jwt = jwt.setExpirationTime(exp ?? now + 300)
  return jwt.sign(key)
}

describe('verifyCiToken: accepted token', () => {
  it('accepts a valid token from this repo and workflow', async () => {
    const token = await mint()
    const result = await verifyCiToken(token, { ...ENV })
    expect(result).not.toBeNull()
    expect(result.repository_id).toBe(REPO_ID)
  })
})

describe('verifyCiToken: rejected tokens', () => {
  it.each([
    ['wrong audience', () => mint({}, { aud: 'x-thread-draft-tool-ci-production' })],
    ['wrong issuer', async () => new SignJWT(claims()).setProtectedHeader({ alg: 'RS256', kid }).setIssuer('https://evil.example').setAudience(ciAudience('preview')).setIssuedAt().setExpirationTime('5m').sign(signingKey)],
    ['wrong repository id', () => mint({ repository_id: '999' })],
    ['another workflow file', () => mint({ workflow_ref: `Shaked/x-thread-draft-tool/.github/workflows/tests.yml@refs/heads/main`, job_workflow_ref: `Shaked/x-thread-draft-tool/.github/workflows/tests.yml@refs/heads/main` })],
    ['job workflow ref mismatch', () => mint({ job_workflow_ref: `Shaked/x-thread-draft-tool/${CI_WORKFLOW_PATH}@refs/heads/other` })],
    ['pull_request trigger', () => mint({ event_name: 'pull_request' })],
    ['expired', () => mint({}, { exp: Math.floor(Date.now() / 1000) - 600 })],
    ['issued more than 5 minutes ago', () => mint({}, { iat: Math.floor(Date.now() / 1000) - 600, exp: Math.floor(Date.now() / 1000) + 300 })],
    ['signed by another key (unknown key)', () => mint({}, { key: otherKey })],
    ['HS256', async () => {
      const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url')
      const now = Math.floor(Date.now() / 1000)
      const head = b64({ alg: 'HS256', typ: 'JWT' })
      const body = b64({ ...claims(), iss: OIDC_ISSUER, aud: ciAudience('preview'), iat: now, nbf: now - 5, exp: now + 300 })
      const sig = createHmac('sha256', 'secret-0123456789abcdef0123456789').update(`${head}.${body}`).digest('base64url')
      return `${head}.${body}.${sig}`
    }],
    ['alg none', async () => {
      const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url')
      const now = Math.floor(Date.now() / 1000)
      return `${b64({ alg: 'none', typ: 'JWT' })}.${b64({ ...claims(), iss: OIDC_ISSUER, aud: ciAudience('preview'), iat: now, nbf: now - 5, exp: now + 300 })}.`
    }],
    ['runner is not github-hosted', () => mint({ runner_environment: 'self-hosted' })]
  ])('rejects %s', async (_label, make) => {
    const token = await make()
    expect(await verifyCiToken(token, { ...ENV })).toBeNull()
  })
})

describe('verifyCiToken: environment and flags', () => {
  it('rejects everything when CI_OIDC_ENABLED is not 1', async () => {
    const token = await mint()
    expect(await verifyCiToken(token, { ...ENV, CI_OIDC_ENABLED: '0' })).toBeNull()
    expect(await verifyCiToken(token, { ...ENV, CI_OIDC_ENABLED: undefined })).toBeNull()
  })

  it('rejects when the repository id is not configured', async () => {
    const token = await mint()
    expect(await verifyCiToken(token, { ...ENV, CI_OIDC_REPOSITORY_ID: undefined })).toBeNull()
  })

  it('rejects a branch ref in preview until CI_OIDC_ALLOW_BRANCHES=1', async () => {
    const branchRef = `Shaked/x-thread-draft-tool/${CI_WORKFLOW_PATH}@refs/heads/claude/some-branch`
    const token = await mint({ ref: 'refs/heads/claude/some-branch', workflow_ref: branchRef, job_workflow_ref: branchRef })
    expect(await verifyCiToken(token, { ...ENV })).toBeNull()
    expect(await verifyCiToken(token, { ...ENV, CI_OIDC_ALLOW_BRANCHES: '1' })).not.toBeNull()
  })

  it('never accepts a branch ref in production', async () => {
    const branchRef = `Shaked/x-thread-draft-tool/${CI_WORKFLOW_PATH}@refs/heads/claude/some-branch`
    const token = await mint({ ref: 'refs/heads/claude/some-branch', workflow_ref: branchRef, job_workflow_ref: branchRef }, { aud: ciAudience('production') })
    expect(await verifyCiToken(token, { ...ENV, VERCEL_ENV: 'production', CI_OIDC_ALLOW_BRANCHES: '1' })).toBeNull()
  })

  it('does not accept a preview audience in production', async () => {
    const token = await mint()
    expect(await verifyCiToken(token, { ...ENV, VERCEL_ENV: 'production' })).toBeNull()
  })

  it('accepts a production token in production when production is enabled', async () => {
    const token = await mint({}, { aud: ciAudience('production') })
    expect(await verifyCiToken(token, { ...ENV, VERCEL_ENV: 'production' })).not.toBeNull()
  })
})

describe('router: CI tokens only on CI routes', () => {
  it('refuses a CI-shaped bearer on a route without ci: true, before the handler runs', async () => {
    const res = await route(
      new Request('https://app.test/api/tokens', { headers: { authorization: 'Bearer aaa.bbb.ccc' } })
    )
    expect(res.status).toBe(401)
    expect(await res.text()).toContain('CI tokens are not accepted on this route')
  })
})

describe('GET /api/auth/me with a CI token (full path, in-memory database)', () => {
  let db
  beforeAll(async () => {
    const { setupTestDb } = await import('./helpers/db.js')
    db = await setupTestDb()
  })

  it('creates the ci-smoke user and returns it on a branch preview', async () => {
    const branchRef = `Shaked/x-thread-draft-tool/${CI_WORKFLOW_PATH}@refs/heads/claude/ui-image-upload-test`
    const token = await mint(
      { ref: 'refs/heads/claude/ui-image-upload-test', workflow_ref: branchRef, job_workflow_ref: branchRef, event_name: 'deployment_status' },
      { aud: ciAudience('preview') }
    )
    const saved = { ...process.env }
    Object.assign(process.env, { CI_OIDC_ENABLED: '1', VERCEL_ENV: 'preview', CI_OIDC_REPOSITORY_ID: REPO_ID, CI_OIDC_ALLOW_BRANCHES: '1' })
    try {
      const res = await route(new Request('https://app.test/api/auth/me', { headers: { authorization: `Bearer ${token}` } }))
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.auth).toBe('ci-oidc')
      expect(body.user.login).toBe('ci-smoke')
    } finally {
      process.env = saved
    }
  })
})
