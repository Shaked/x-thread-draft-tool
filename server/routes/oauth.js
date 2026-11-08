// OAuth 2.1 authorization server for the MCP connector (plan Task 7.5).
// Metadata (RFC 8414, RFC 9728), client registration, the authorize page, the code and refresh
// token endpoint, and revocation. Tokens come from server/oauth/tokens.js (Task 7.4).
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { query, transaction } from '../db.js'
import { HttpError, json, readJson } from '../http.js'
import { readSession } from '../session.js'
import { hashToken } from '../tokens.js'
import { OAuthError, SCOPE, cleanupExpired, insertPair, rotate } from '../oauth/tokens.js'
import { getClient, isValidRedirectUriList, registerClient } from '../oauth/clients.js'
import {
  consentHeaders,
  consentPage,
  errorHeaders,
  errorPage,
  openDecision,
  sealDecision
} from '../oauth/consent.js'

const CODE_TTL = "interval '60 seconds'"
const FORM_MAX_BYTES = 16 * 1024
const PKCE_CHALLENGE = /^[A-Za-z0-9._~-]{43,128}$/
const PKCE_VERIFIER = /^[A-Za-z0-9._~-]{43,128}$/
const GRANT_TYPES = ['authorization_code', 'refresh_token']

function origin(request) {
  return (process.env.PUBLIC_APP_URL || new URL(request.url).origin).replace(/\/$/, '')
}

const mcpResource = (base) => `${base}/api/mcp`
const restResource = (base) => `${base}/api`

function redirect(location) {
  return new Response(null, { status: 302, headers: { location, 'cache-control': 'no-store' } })
}

/** Adds `code` or `error` (plus state and the issuer, RFC 9207) to the client's redirect URI. */
function redirectTo(redirectUri, fields, base) {
  const target = new URL(redirectUri)
  for (const [key, value] of Object.entries(fields)) {
    if (value !== null && value !== undefined) target.searchParams.set(key, value)
  }
  target.searchParams.set('iss', base)
  return redirect(target.toString())
}

function htmlError(status, title, message) {
  return new Response(errorPage(title, message), { status, headers: errorHeaders() })
}

function tokenError(status, error, description) {
  return json({ error, error_description: description }, status)
}

function registrationError(description) {
  return json({ error: 'invalid_client_metadata', error_description: description }, 400)
}

async function formBody(request) {
  const text = await request.text()
  if (text.length > FORM_MAX_BYTES) throw new HttpError(413, 'Request body too large')
  return new URLSearchParams(text)
}

// ---- Metadata --------------------------------------------------------------------------------

/** GET /.well-known/oauth-protected-resource (also served at .../api/mcp): RFC 9728. */
export async function protectedResourceMetadata({ request }) {
  const base = origin(request)
  return json(
    {
      resource: mcpResource(base),
      authorization_servers: [base],
      scopes_supported: [SCOPE],
      bearer_methods_supported: ['header']
    },
    200,
    { 'cache-control': 'public, max-age=300' }
  )
}

/** GET /.well-known/oauth-authorization-server: RFC 8414, with the MCP-required fields. */
export async function authorizationServerMetadata({ request }) {
  const base = origin(request)
  return json(
    {
      issuer: base,
      authorization_endpoint: `${base}/api/oauth/authorize`,
      token_endpoint: `${base}/api/oauth/token`,
      registration_endpoint: `${base}/api/oauth/register`,
      revocation_endpoint: `${base}/api/oauth/revoke`,
      response_types_supported: ['code'],
      grant_types_supported: GRANT_TYPES,
      code_challenge_methods_supported: ['S256'],
      token_endpoint_auth_methods_supported: ['none'],
      scopes_supported: [SCOPE],
      client_id_metadata_document_supported: true,
      authorization_response_iss_parameter_supported: true
    },
    200,
    { 'cache-control': 'public, max-age=300' }
  )
}

// ---- Registration (RFC 7591, deprecated by the MCP spec, kept for compatibility) ---------------

/** POST /oauth/register: no auth. Only public clients (token_endpoint_auth_method none). */
export async function register({ request }) {
  let body
  try {
    body = await readJson(request, FORM_MAX_BYTES)
  } catch {
    return registrationError('The body must be a JSON object')
  }
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    return registrationError('The body must be a JSON object')
  }
  const name = typeof body.client_name === 'string' ? body.client_name.trim() : ''
  if (name.length < 1 || name.length > 100) return registrationError('client_name must be 1 to 100 characters')
  if (!isValidRedirectUriList(body.redirect_uris)) {
    return registrationError('redirect_uris must be 1 to 5 https, localhost or 127.0.0.1 URIs without a fragment')
  }
  if (body.token_endpoint_auth_method !== undefined && body.token_endpoint_auth_method !== 'none') {
    return registrationError('Only token_endpoint_auth_method "none" is supported')
  }

  const clientId = await registerClient({ client_name: name, redirect_uris: body.redirect_uris })
  return json(
    {
      client_id: clientId,
      client_name: name,
      redirect_uris: body.redirect_uris,
      token_endpoint_auth_method: 'none',
      grant_types: GRANT_TYPES,
      response_types: ['code']
    },
    201
  )
}

// ---- Authorize -------------------------------------------------------------------------------

/**
 * Checks the parameters that can go back to the client. Returns `{ value }` or `{ error, description }`.
 * PKCE (S256) and an explicit resource are required; `resource` absent means the MCP server.
 */
function parseAuthorize(params, base) {
  if (params.get('response_type') !== 'code') return { error: 'invalid_request', description: 'response_type must be code' }
  const challenge = params.get('code_challenge') ?? ''
  if (!PKCE_CHALLENGE.test(challenge)) return { error: 'invalid_request', description: 'code_challenge is required' }
  if (params.get('code_challenge_method') !== 'S256') {
    return { error: 'invalid_request', description: 'code_challenge_method must be S256' }
  }
  const state = params.get('state')
  if (state !== null && state.length > 500) return { error: 'invalid_request', description: 'state is too long' }
  const scope = params.get('scope')
  if (scope !== null && scope !== '' && scope !== SCOPE) return { error: 'invalid_request', description: 'Unsupported scope' }

  const resource = params.get('resource') ?? mcpResource(base)
  if (resource !== mcpResource(base) && resource !== restResource(base)) {
    return { error: 'invalid_target', description: 'resource must name this server (/api/mcp or /api)' }
  }
  return {
    value: { code_challenge: challenge, state, resource, scope: SCOPE }
  }
}

/**
 * GET /oauth/authorize. Unknown client or unregistered redirect URI: an error page, never a
 * redirect. Other problems: redirect with error. No session: sign in first, then come back here.
 */
export async function authorizeGet({ request, url }) {
  const base = origin(request)
  const params = url.searchParams
  const client = await getClient(params.get('client_id') ?? '')
  if (!client) {
    return htmlError(400, 'Unknown app', 'This app is not recognized, so nothing was approved. Start again from the app.')
  }
  const redirectUri = params.get('redirect_uri')
  if (!redirectUri || !client.redirect_uris.includes(redirectUri)) {
    return htmlError(400, 'Wrong return address', 'The app asked to return to an address it did not register. Nothing was approved.')
  }

  const parsed = parseAuthorize(params, base)
  if (parsed.error) {
    return redirectTo(redirectUri, { error: parsed.error, error_description: parsed.description, state: params.get('state') }, base)
  }
  const { value } = parsed

  const session = await readSession(request)
  if (!session) {
    // Forward the parameters without the rewrite's __path, so the return address is this endpoint.
    const forward = new URLSearchParams(params)
    forward.delete('__path')
    const returnTo = `/api/oauth/authorize?${forward}`
    return redirect(`${base}/api/auth/login?return_to=${encodeURIComponent(returnTo)}`)
  }

  const requestToken = await sealDecision({
    uid: session.uid,
    client_id: client.client_id,
    redirect_uri: redirectUri,
    code_challenge: value.code_challenge,
    state: value.state,
    scope: value.scope,
    resource: value.resource
  })
  const redirectOrigin = new URL(redirectUri).origin
  return new Response(
    consentPage({
      clientName: client.client_name,
      unverified: client.kind === 'registered',
      redirectHost: new URL(redirectUri).host,
      requestToken
    }),
    { status: 200, headers: consentHeaders(redirectOrigin) }
  )
}

/** POST /oauth/authorize (the consent form). CSRF and session binding: the decision must belong to this session's user. */
export async function authorizePost({ request }) {
  const base = origin(request)
  const form = await formBody(request)
  const decision = await openDecision(form.get('request'))
  if (!decision) {
    return htmlError(400, 'This request expired', 'Start again from the app that asked for access.')
  }
  const session = await readSession(request)
  if (!session || String(session.uid) !== String(decision.uid)) {
    return htmlError(403, 'Wrong account', 'Sign in as the account that started this request, then try again.')
  }

  if (form.get('decision') !== 'approve') {
    return redirectTo(decision.redirect_uri, { error: 'access_denied', state: decision.state }, base)
  }

  const code = randomBytes(32).toString('base64url')
  await transaction(async (q) => {
    // One grant per user, client and resource. The row is locked so a concurrent approval waits.
    await q(
      `insert into oauth_grants (user_id, client_id, scope, resource) values ($1, $2, $3, $4)
       on conflict (user_id, client_id, resource) do nothing`,
      [session.uid, decision.client_id, decision.scope, decision.resource]
    )
    const { rows } = await q(
      `select id, revoked_at from oauth_grants
        where user_id = $1 and client_id = $2 and resource = $3 for update`,
      [session.uid, decision.client_id, decision.resource]
    )
    const grant = rows[0]
    if (grant.revoked_at) {
      // Reactivating a revoked grant: every code and token issued before revocation must stay dead.
      await q('delete from oauth_tokens where grant_id = $1', [grant.id])
      await q('delete from oauth_codes where grant_id = $1', [grant.id])
    }
    await q('update oauth_grants set revoked_at = null, scope = $2 where id = $1', [grant.id, decision.scope])
    await q(
      `insert into oauth_codes (code_hash, grant_id, redirect_uri, code_challenge, expires_at)
       values ($1, $2, $3, $4, now() + ${CODE_TTL})`,
      [hashToken(code), grant.id, decision.redirect_uri, decision.code_challenge]
    )
  })
  return redirectTo(decision.redirect_uri, { code, state: decision.state }, base)
}

// ---- Token ----------------------------------------------------------------------------------

function pkceMatches(verifier, challenge) {
  const expected = Buffer.from(createHash('sha256').update(verifier).digest('base64url'))
  const actual = Buffer.from(challenge)
  return expected.length === actual.length && timingSafeEqual(expected, actual)
}

async function revokeGrant(grantId) {
  await query('update oauth_grants set revoked_at = now() where id = $1 and revoked_at is null', [grantId])
}

const invalidCode = () => new OAuthError('invalid_grant', 'The code is invalid, expired or already used')

/**
 * authorization_code grant. A code is single use: a second use revokes its grant. The grant's
 * client, redirect URI, PKCE verifier and resource must all match.
 */
async function exchangeCode(form) {
  const code = form.get('code')
  const redirectUri = form.get('redirect_uri')
  const clientId = form.get('client_id')
  const verifier = form.get('code_verifier')
  const resource = form.get('resource')
  if (!code || !redirectUri || !clientId || !verifier || !resource) {
    throw new OAuthError('invalid_request', 'code, redirect_uri, client_id, code_verifier and resource are required')
  }
  if (!PKCE_VERIFIER.test(verifier)) throw invalidCode()

  const hash = hashToken(code)
  const { rows } = await query(
    `select c.used_at, c.expires_at > now() as fresh, c.redirect_uri, c.code_challenge, c.grant_id,
            g.client_id, g.resource, g.revoked_at
       from oauth_codes c join oauth_grants g on g.id = c.grant_id
      where c.code_hash = $1`,
    [hash]
  )
  const row = rows[0]
  if (!row) throw invalidCode()
  // Client, redirect URI and PKCE verifier must match before anything else happens, including
  // reuse revocation. Otherwise anyone holding a spent code (say, from a logged callback URL)
  // could revoke the user's grant without proving they are the client that was issued it.
  const bindingsMatch =
    row.client_id === clientId && row.redirect_uri === redirectUri && pkceMatches(verifier, row.code_challenge)
  if (row.used_at) {
    // Only a request that presents the code's bindings (a genuine replay by the legitimate client) revokes.
    if (bindingsMatch && resource === row.resource) await revokeGrant(row.grant_id)
    throw invalidCode()
  }
  if (!row.fresh || row.revoked_at) throw invalidCode()
  if (!bindingsMatch) throw invalidCode()
  if (resource !== row.resource) {
    throw new OAuthError('invalid_target', 'The resource does not match the one the code was issued for', 400)
  }

  // Spending the code, issuing the pair and stamping the grant are one transaction: if the
  // insert fails, the rollback leaves the code unused so the client can retry. Of two
  // concurrent exchanges, only one can mark the code used.
  const pair = await transaction(async (q) => {
    const { rows: spent } = await q(
      `update oauth_codes set used_at = now()
        where code_hash = $1 and used_at is null and expires_at > now()
        returning grant_id`,
      [hash]
    )
    if (!spent[0]) return null
    const issued = await insertPair(q, row.grant_id)
    await q('update oauth_grants set last_used_at = now() where id = $1', [row.grant_id])
    return issued
  })
  if (!pair) {
    // Lost the race: the code was spent by a concurrent exchange. Reuse, so revoke.
    await revokeGrant(row.grant_id)
    throw invalidCode()
  }
  await cleanupExpired()
  return pair
}

/** POST /oauth/token: authorization_code and refresh_token grants. Public clients only (PKCE). */
export async function token({ request }) {
  const form = await formBody(request)
  const grantType = form.get('grant_type')
  try {
    if (grantType === 'authorization_code') return json(await exchangeCode(form))
    if (grantType === 'refresh_token') {
      const clientId = form.get('client_id')
      if (!clientId) throw new OAuthError('invalid_request', 'client_id is required')
      return json(await rotate(form.get('refresh_token'), clientId))
    }
    return tokenError(400, 'unsupported_grant_type', 'grant_type must be authorization_code or refresh_token')
  } catch (err) {
    if (err instanceof OAuthError) return tokenError(err.status, err.code, err.message)
    throw err
  }
}

/** POST /oauth/revoke (RFC 7009): revokes the grant the token belongs to. Always 200. */
export async function revoke({ request }) {
  const form = await formBody(request)
  const value = form.get('token')
  if (value) {
    await query(
      `update oauth_grants set revoked_at = now()
        where revoked_at is null
          and id in (select grant_id from oauth_tokens where token_hash = $1)`,
      [hashToken(value)]
    )
  }
  return new Response(null, { status: 200, headers: { 'cache-control': 'no-store' } })
}

export const oauthRoutes = [
  { method: 'GET', path: '/.well-known/oauth-protected-resource', handler: protectedResourceMetadata },
  { method: 'GET', path: '/.well-known/oauth-protected-resource/api/mcp', handler: protectedResourceMetadata },
  { method: 'GET', path: '/.well-known/oauth-authorization-server', handler: authorizationServerMetadata },
  { method: 'POST', path: '/oauth/register', handler: register },
  { method: 'GET', path: '/oauth/authorize', handler: authorizeGet },
  { method: 'POST', path: '/oauth/authorize', handler: authorizePost },
  { method: 'POST', path: '/oauth/token', handler: token },
  { method: 'POST', path: '/oauth/revoke', handler: revoke }
]
