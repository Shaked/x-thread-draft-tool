// @vitest-environment node
// Plan M11 item 4. The official MCP TypeScript SDK client (Client, StreamableHTTPClientTransport, auth())
// runs the whole path against the in-process route(): discovery, registration, authorize with scripted
// consent, token, initialize, tools/list, one tools/call and refresh. Third-party spec-following code
// catches misreadings that our own mock client and our server could share. No network, no client app,
// no person, no LLM: a fetch guard fails on any real outbound request (the one allowed exception is the
// mocked client metadata document used by the metadata-document test).
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { auth, refreshAuthorization, discoverOAuthMetadata, UnauthorizedError } from '@modelcontextprotocol/sdk/client/auth.js'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../server/blob.js', () => ({ putBlob: vi.fn(), deleteBlobUrls: vi.fn(async () => {}) }))

import { route } from '../../server/router.js'
import { setMetadataResolverForTests } from '../../server/oauth/clients.js'
import { setupTestDb, APP_URL } from './helpers/db.js'

const MCP = `${APP_URL}/api/mcp`
const FORM = { 'content-type': 'application/x-www-form-urlencoded' }
const CLIENT_METADATA_URL = 'https://client.example.test/oauth/cli-metadata'
const CLIENT_METADATA = {
  client_id: CLIENT_METADATA_URL,
  client_name: 'SDK metadata client',
  redirect_uris: ['http://127.0.0.1/callback']
}

let db
let aliceCookie

beforeAll(async () => {
  db = await setupTestDb()
})

beforeEach(async () => {
  await db.reset()
  await db.pg.exec('delete from oauth_clients')
  const alice = await db.insertUser({ github_id: 1, login: 'alice' })
  aliceCookie = await db.cookieFor(alice)
  setMetadataResolverForTests(async () => [{ address: '93.184.216.34' }])
  // Fetch guard: anything that reaches the real global fetch fails, except the one metadata document.
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const href = input?.url ?? String(input)
    if (href === CLIENT_METADATA_URL) {
      return new Response(JSON.stringify(CLIENT_METADATA), { status: 200, headers: { 'content-type': 'application/json' } })
    }
    throw new Error(`outbound request blocked by the SDK client test: ${href}`)
  })
})

afterEach(() => {
  vi.restoreAllMocks()
})

/** The fetch the SDK is given: every request goes to the in-process router, never the network. */
const inProcessFetch = async (input, init) => {
  const request = input instanceof Request ? input : new Request(input, init)
  const url = new URL(request.url)
  if (url.origin !== APP_URL) throw new Error(`SDK requested a host outside the app: ${request.url}`)
  return route(request)
}

/** Performs the consent step the way mcp-contract.test.js does: signed-in user approves, code from the redirect. */
async function scriptedConsent(authorizationUrl) {
  const page = await route(new Request(authorizationUrl, { headers: { cookie: aliceCookie } }))
  expect(page.status).toBe(200)
  const requestToken = (await page.text()).match(/name="request" value="([^"]+)"/)?.[1]
  expect(requestToken).toBeTruthy()
  const res = await route(
    new Request(`${APP_URL}/api/oauth/authorize`, {
      method: 'POST',
      headers: { ...FORM, cookie: aliceCookie },
      body: new URLSearchParams({ request: requestToken, decision: 'approve' }).toString()
    })
  )
  expect(res.status).toBe(302)
  return new URL(res.headers.get('location'))
}

/** An in-memory OAuthClientProvider whose "browser" is scriptedConsent. */
function makeProvider({ clientMetadataUrl, redirectUrl = 'http://127.0.0.1/callback' } = {}) {
  const store = { client: undefined, tokens: undefined, verifier: undefined, state: 'sdk-state-1', redirect: undefined }
  const provider = {
    store,
    clientMetadataUrl,
    get redirectUrl() {
      return redirectUrl
    },
    get clientMetadata() {
      return {
        client_name: 'SDK test client',
        redirect_uris: [redirectUrl],
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
        token_endpoint_auth_method: 'none'
      }
    },
    state: () => store.state,
    clientInformation: () => store.client,
    saveClientInformation: (info) => {
      store.client = info
    },
    tokens: () => store.tokens,
    saveTokens: (tokens) => {
      store.tokens = tokens
    },
    saveCodeVerifier: (verifier) => {
      store.verifier = verifier
    },
    codeVerifier: () => store.verifier,
    redirectToAuthorization: async (url) => {
      store.redirect = await scriptedConsent(url)
    }
  }
  return provider
}

/** Runs the SDK sign-in: first auth() builds the redirect, consent is scripted, second auth() exchanges the code. */
async function signIn(provider) {
  const first = await auth(provider, { serverUrl: MCP, fetchFn: inProcessFetch })
  expect(first).toBe('REDIRECT')
  const back = provider.store.redirect
  expect(back.searchParams.get('state')).toBe(provider.store.state)
  expect(back.origin + back.pathname).toBe(provider.redirectUrl)
  const code = back.searchParams.get('code')
  expect(code).toBeTruthy()
  const second = await auth(provider, { serverUrl: MCP, authorizationCode: code, fetchFn: inProcessFetch })
  expect(second).toBe('AUTHORIZED')
  expect(provider.store.tokens.token_type.toLowerCase()).toBe('bearer')
  expect(provider.store.tokens.refresh_token).toBeTruthy()
  return provider.store.tokens
}

async function connect(provider) {
  const client = new Client({ name: 'sdk-contract-client', version: '1.0.0' })
  const transport = new StreamableHTTPClientTransport(new URL(MCP), { authProvider: provider, fetch: inProcessFetch })
  await client.connect(transport)
  return { client, transport }
}

async function exerciseMcp(client, transport) {
  expect(transport.protocolVersion).toBe('2025-11-25')
  expect(client.getServerVersion()?.name).toBeTruthy()
  const { tools } = await client.listTools()
  expect(tools.length).toBeGreaterThan(0)
  for (const tool of tools) {
    expect(tool.name).toBeTruthy()
    expect(tool.inputSchema, tool.name).toMatchObject({ type: 'object' })
  }
  expect(tools.map((tool) => tool.name)).toContain('list_drafts')
  const result = await client.callTool({ name: 'list_drafts', arguments: {} })
  expect(result.isError).not.toBe(true)
  expect(Array.isArray(result.content)).toBe(true)
  expect(result.content.length).toBeGreaterThan(0)
  expect(result.content[0].type).toBe('text')
}

describe('SDK client against the in-process server', () => {
  it('without credentials the SDK transport reports Unauthorized after finding the metadata', async () => {
    const client = new Client({ name: 'sdk-contract-client', version: '1.0.0' })
    const provider = makeProvider()
    const transport = new StreamableHTTPClientTransport(new URL(MCP), { authProvider: provider, fetch: inProcessFetch })
    await expect(client.connect(transport)).rejects.toBeInstanceOf(UnauthorizedError)
    // The transport ran discovery, registered the client and asked for the authorize redirect.
    expect(provider.store.client?.client_id).toBeTruthy()
    expect(provider.store.redirect.searchParams.get('code')).toBeTruthy()
  })

  it('dynamic registration: discovery, authorize, token, MCP calls and refresh rotation', async () => {
    const provider = makeProvider()
    const tokens = await signIn(provider)
    // The SDK registered the client through the advertised registration endpoint.
    expect(provider.store.client.client_id).toBeTruthy()

    const { client, transport } = await connect(provider)
    await exerciseMcp(client, transport)
    await client.close()

    // Refresh through auth(): it sees the refresh token, refreshes and saves a rotated pair.
    const refreshed = await auth(provider, { serverUrl: MCP, fetchFn: inProcessFetch })
    expect(refreshed).toBe('AUTHORIZED')
    const fresh = provider.store.tokens
    expect(fresh.access_token).not.toBe(tokens.access_token)
    expect(fresh.refresh_token).not.toBe(tokens.refresh_token)

    // The refreshed access token works over MCP.
    const again = await connect(provider)
    await exerciseMcp(again.client, again.transport)
    await again.client.close()

    // The old refresh token is spent: the SDK surfaces invalid_grant.
    const meta = await discoverOAuthMetadata(MCP, undefined, inProcessFetch)
    await expect(
      refreshAuthorization(meta.issuer, {
        metadata: meta,
        clientInformation: provider.store.client,
        refreshToken: tokens.refresh_token,
        resource: new URL(MCP),
        fetchFn: inProcessFetch
      })
    ).rejects.toMatchObject({ errorCode: 'invalid_grant' })
  })

  it('client metadata document: the SDK uses its URL as the client id and skips registration', async () => {
    const provider = makeProvider({ clientMetadataUrl: CLIENT_METADATA_URL })
    await signIn(provider)
    expect(provider.store.client.client_id).toBe(CLIENT_METADATA_URL)
    const { client, transport } = await connect(provider)
    await exerciseMcp(client, transport)
    await client.close()
  })

  it('prompts: listPrompts, getPrompt, and an unknown name is -32602', async () => {
    const provider = makeProvider()
    await signIn(provider)
    const { client } = await connect(provider)
    expect(client.getServerCapabilities()?.prompts).toBeTruthy()
    const { prompts } = await client.listPrompts()
    expect(prompts.map((p) => p.name)).toEqual(['thread_from_notes', 'tighten_draft', 'review_before_publish', 'rewrite_hook'])
    const got = await client.getPrompt({ name: 'thread_from_notes', arguments: { notes: 'שלום עולם' } })
    expect(got.messages[0].role).toBe('user')
    expect(got.messages[0].content.text).toContain('שלום עולם')
    await expect(client.getPrompt({ name: 'no_such_prompt' })).rejects.toMatchObject({ code: -32602 })
    await client.close()
  })

  it('skills: the extension is declared, and readResource returns the SKILL.md text', async () => {
    const provider = makeProvider()
    await signIn(provider)
    const { client } = await connect(provider)
    const caps = client.getServerCapabilities()
    expect(caps?.extensions?.['io.modelcontextprotocol/skills']).toEqual({})
    expect(caps?.resources).toBeTruthy()
    const { resources } = await client.listResources()
    expect(resources.map((r) => r.uri)).toEqual(['skill://x-thread-drafts/SKILL.md'])
    const read = await client.readResource({ uri: 'skill://x-thread-drafts/SKILL.md' })
    expect(read.contents[0].mimeType).toBe('text/markdown')
    expect(read.contents[0].text).toMatch(/^---\nname: x-thread-drafts\n/)
    await expect(client.readResource({ uri: 'skill://x-thread-drafts/nope.md' })).rejects.toMatchObject({ code: -32002 })
    await client.close()
  })
})
