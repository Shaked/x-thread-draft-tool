// "Copy link" on the sign-in page and on the consent page (plan T3). Runs in the required `chromium`
// project: playwright.config.ts starts the local API and the built app, so no person is needed.
// The client is registered with POST /api/oauth/register. The consent page needs a browser session,
// so the test takes one from POST /api/dev/session (dev API only).

import { createHash, randomBytes } from 'node:crypto'
import { expect, request as playwrightRequest, test, type APIRequestContext, type Browser, type BrowserContext, type Page } from '@playwright/test'

const BASE = process.env.XT_BASE_URL ?? 'http://127.0.0.1:4173'
const ORIGIN = new URL(BASE).origin
const REDIRECT = 'http://localhost:4000/cb'
const CLIENT_NAME = 'Copy link check'
const PHONE = { width: 390, height: 844 }

// In the local setup the page is served on :4173 and proxied to the dev API on :8787, whose own origin
// is the app origin (PUBLIC_APP_URL), so the server's Origin check refuses a cookie POST that carries
// :4173. In production both are one origin. Sending POSTs with the app origin mirrors that; the server is untouched.
const APP_ORIGIN = ORIGIN === 'http://127.0.0.1:4173' ? 'http://127.0.0.1:8787' : ORIGIN
async function postsFromAppOrigin(context: BrowserContext) {
  await context.route(`${ORIGIN}/api/**`, async (route) => {
    if (route.request().method() !== 'POST') return route.continue()
    // Chromium ignores an Origin override on continue(), so the request is sent from here instead.
    const response = await route.fetch({ headers: { ...route.request().headers(), origin: APP_ORIGIN }, maxRedirects: 0 })
    return route.fulfill({ response })
  })
}

let api: APIRequestContext
let clientId = ''

test.beforeAll(async () => {
  api = await playwrightRequest.newContext({ baseURL: BASE })
  const registered = await api.post('/api/oauth/register', { data: { client_name: CLIENT_NAME, redirect_uris: [REDIRECT] } })
  expect(registered.status()).toBe(201)
  clientId = (await registered.json()).client_id as string
})

test.afterAll(async () => {
  await api.dispose()
})

/** An authorize request with a fresh PKCE challenge. Returns the query string only. */
function authorizeQuery(): string {
  const verifier = randomBytes(48).toString('base64url')
  const challenge = createHash('sha256').update(verifier).digest('base64url')
  return new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: REDIRECT,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    state: 'copy-check'
  }).toString()
}

async function context(browser: Browser) {
  const ctx = await browser.newContext({ viewport: PHONE, serviceWorkers: 'block' })
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: ORIGIN })
  return ctx
}

/** Clicks Copy link, then checks the note and that the clipboard holds exactly the field's link. */
async function expectCopied(page: Page, query: string) {
  const value = await page.locator('#share-link').inputValue()
  expect(value.endsWith(`/api/oauth/authorize?${query}`)).toBeTruthy()
  await page.getByRole('button', { name: 'Copy link' }).click()
  await expect(page.locator('#copy-note')).toHaveText('Copied.')
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(value)
}

test('signed out: the sign-in page copies the approval link', async ({ browser }) => {
  const ctx = await context(browser)
  try {
    const page = await ctx.newPage()
    const query = authorizeQuery()
    await page.goto(`${BASE}/api/oauth/authorize?${query}`)
    await expect(page.getByRole('heading', { name: 'Sign in to continue' })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Continue with GitHub' })).toHaveAttribute('href', /\/api\/auth\/login\?return_to=/)
    await expectCopied(page, query)
  } finally {
    await ctx.close()
  }
})

test('signed in: the consent page greets the account and copies the same link', async ({ browser }) => {
  const login = `copy-${Date.now()}`
  const session = await api.post('/api/dev/session', { data: { login } })
  expect(session.ok()).toBeTruthy()
  const setCookie = session.headersArray().find((h) => h.name.toLowerCase() === 'set-cookie')?.value ?? ''
  const token = setCookie.match(/xt_session=([^;]+)/)?.[1]
  expect(token).toBeTruthy()

  const ctx = await context(browser)
  try {
    await ctx.addCookies([{ name: 'xt_session', value: token!, url: BASE }])
    const page = await ctx.newPage()
    const query = authorizeQuery()
    await page.goto(`${BASE}/api/oauth/authorize?${query}`)
    await expect(page.getByRole('heading', { name: `Hi @${login}, allow ${CLIENT_NAME} to use` })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Approve' })).toBeVisible()
    await expectCopied(page, query)
  } finally {
    await ctx.close()
  }
})

test('signed in: "Not you? Sign out" ends the session and shows the sign-in page for the same request', async ({ browser }) => {
  const login = `notyou-${Date.now()}`
  const session = await api.post('/api/dev/session', { data: { login } })
  expect(session.ok()).toBeTruthy()
  const setCookie = session.headersArray().find((h) => h.name.toLowerCase() === 'set-cookie')?.value ?? ''
  const token = setCookie.match(/xt_session=([^;]+)/)?.[1]
  expect(token).toBeTruthy()

  const ctx = await context(browser)
  try {
    await postsFromAppOrigin(ctx)
    await ctx.addCookies([{ name: 'xt_session', value: token!, url: BASE }])
    const page = await ctx.newPage()
    const query = authorizeQuery()
    await page.goto(`${BASE}/api/oauth/authorize?${query}`)
    await expect(page.getByRole('heading', { name: `Hi @${login}, allow ${CLIENT_NAME} to use` })).toBeVisible()
    await page.getByRole('button', { name: 'Sign out', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Sign in to continue' })).toBeVisible()
    expect(new URL(page.url()).pathname).toBe('/api/oauth/authorize')
    expect(new URL(page.url()).searchParams.get('state')).toBe('copy-check')
    await expect(page.locator('#share-link')).toHaveValue(/state=copy-check/)

    // The old cookie value no longer works anywhere.
    const old = await playwrightRequest.newContext({ baseURL: BASE, extraHTTPHeaders: { cookie: `xt_session=${token}` } })
    expect((await old.get('/api/drafts')).status()).toBe(401)
    await old.dispose()
  } finally {
    await ctx.close()
  }
})
