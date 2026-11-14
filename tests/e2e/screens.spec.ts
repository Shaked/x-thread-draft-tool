// Screenshot harness for UI work (plan Task 6.0). Not part of the default run: `npm run screens`.
//
// Needs the built app and the local API:
//   npm run build && npm run preview -- --port 4173   # the app, http://localhost:4173 (proxies /api)
//   npm run dev:api                                   # the API, http://127.0.0.1:8787
// Use the built app, not `npm run dev`: in development React StrictMode runs the preview effect
// twice, and the second request hits the one-use share link and gets 410.
// Writes test-results/screens/<width>/<name>.png for 390 px and 1280 px wide:
// login, drafts-empty, drafts-three, editor, editor-export-menu, editor-bar-hidden (phones only), preview, share, tokens,
// consent-signed-out and consent (the OAuth approval pages, plan T3).
// Under 800 px wide, each shot also writes <name>-viewport.png: what is on the screen, with the fixed bar.
//
// Signed-in pages use a dev API token (POST /api/dev/token), sent as a bearer header on /api calls.
// Nothing here is stored; the data is created in the local API.

import { expect, test, type Browser, type APIRequestContext, type Locator, type Page } from '@playwright/test'
import { createHash, randomBytes } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import path from 'node:path'

const BASE = process.env.XT_BASE_URL ?? 'http://localhost:4173'
const ORIGIN = new URL(BASE).origin
const WIDTHS = [390, 1280]
const OUT = path.join('test-results', 'screens')

async function devToken(request: APIRequestContext, login: string): Promise<string> {
  const res = await request.post(`${BASE}/api/dev/token`, { data: { login } })
  expect(res.ok()).toBeTruthy()
  return (await res.json()).token as string
}

async function apiJson<T>(request: APIRequestContext, token: string, method: 'GET' | 'POST', route: string, data?: unknown): Promise<T> {
  const res = await request.fetch(`${BASE}${route}`, {
    method,
    headers: { authorization: `Bearer ${token}` },
    data
  })
  expect(res.ok(), `${method} ${route} -> ${res.status()}`).toBeTruthy()
  return (await res.json()) as T
}

function threePosts(imageUrl: string) {
  return [
    { id: 'p1', text: 'Opening post: what this thread is about and why it matters.', images: [], embeddedTweet: null },
    { id: 'p2', text: 'Second post with an image attached.', images: [imageUrl], embeddedTweet: null },
    { id: 'p3', text: 'Closing post with the takeaway for readers.', images: [], embeddedTweet: null }
  ]
}

async function shoot(
  browser: Browser,
  width: number,
  name: string,
  pagePath: string,
  options: { token?: string; ready?: (page: Page) => Locator; before?: (page: Page) => Promise<void> } = {}
) {
  const context = await browser.newContext({
    viewport: { width, height: width < 800 ? 844 : 800 },
    serviceWorkers: 'block'
  })
  if (options.token) {
    const bearer = `Bearer ${options.token}`
    await context.route(`${ORIGIN}/**`, (route) => {
      if (new URL(route.request().url()).pathname.startsWith('/api/')) {
        return route.continue({ headers: { ...route.request().headers(), authorization: bearer } })
      }
      return route.continue()
    })
  }
  const page = await context.newPage()
  await page.goto(`${BASE}${pagePath}`, { waitUntil: 'networkidle' })
  if (options.ready) await options.ready(page).first().waitFor({ timeout: 15_000 })
  if (options.before) await options.before(page)
  const dir = path.join(OUT, String(width))
  mkdirSync(dir, { recursive: true })
  await page.screenshot({ path: path.join(dir, `${name}.png`), fullPage: true })
  if (width < 800) await page.screenshot({ path: path.join(dir, `${name}-viewport.png`), fullPage: false })
  await context.close()
}

test.describe('screens', () => {
  for (const width of WIDTHS) {
    test(`captures every screen at ${width}px`, async ({ browser, request }) => {
      test.setTimeout(180_000)

      // A fresh login per run and width, so drafts from earlier runs or the other viewport never show up.
      const run = `${width}-${Date.now()}`
      const owner = await devToken(request, `screens-owner-${run}`)
      const empty = await devToken(request, `screens-empty-${run}`)

      // Empty list: a user with no drafts.
      await shoot(browser, width, 'drafts-empty', '/', { token: empty })

      // Three drafts for the owner; the editor draft has three posts, one with an image.
      const imageUrl = `${BASE}/pwa-192x192.png`
      const drafts = [
        { title: 'Launch thread', posts: threePosts(imageUrl) },
        { title: 'Weekly notes', posts: [{ id: 'n1', text: 'Notes for the week.', images: [], embeddedTweet: null }] },
        { title: 'Ideas', posts: [{ id: 'i1', text: 'An idea worth a thread.', images: [], embeddedTweet: null }] }
      ]
      const created: { draft: { id: string } }[] = []
      for (const draft of drafts) {
        created.push(await apiJson(request, owner, 'POST', '/api/drafts', draft))
      }
      const editorId = created[0].draft.id

      await shoot(browser, width, 'login', '/')
      await shoot(browser, width, 'drafts-three', '/', { token: owner, ready: (p) => p.getByText('Launch thread') })
      await shoot(browser, width, 'editor', `/draft/${editorId}`, { token: owner, ready: (p) => p.locator('.draft-title-input') })
      await shoot(browser, width, 'editor-export-menu', `/draft/${editorId}`, {
        token: owner,
        ready: (p) => p.locator('.draft-title-input'),
        before: async (p) => {
          await p.getByRole('button', { name: 'Export' }).click()
          await p.getByText('Copy with numbers').waitFor()
        }
      })
      // The hide control exists on phones only (wide screens have no fixed bar).
      if (width < 800) {
        await shoot(browser, width, 'editor-bar-hidden', `/draft/${editorId}`, {
          token: owner,
          ready: (p) => p.locator('.draft-title-input'),
          before: async (p) => {
            await p.getByRole('button', { name: 'Hide toolbar' }).click()
            await p.getByRole('button', { name: 'Show toolbar' }).waitFor()
          }
        })
      }

      // Preview page and share page each need their own one-use share token.
      const previewToken = (await apiJson<{ token: string }>(request, owner, 'POST', `/api/drafts/${editorId}/share-tokens`)).token
      const shareToken = (await apiJson<{ token: string }>(request, owner, 'POST', `/api/drafts/${editorId}/share-tokens`)).token
      await shoot(browser, width, 'preview', `/x-thread-preview/${previewToken}`, { ready: (p) => p.getByText('Opening post') })
      await shoot(browser, width, 'share', `/api/share/${shareToken}.html`, { ready: (p) => p.getByText('Opening post') })

      await shoot(browser, width, 'tokens', '/settings/tokens', { token: owner, ready: (p) => p.locator('.tokens-page') })
    })

    // The OAuth approval pages (server HTML, plan T3): signed out, and signed in with a browser session.
    test(`captures the approval pages at ${width}px`, async ({ browser, request }) => {
      const redirect = 'http://localhost:4000/cb'
      const registered = await request.post(`${BASE}/api/oauth/register`, { data: { client_name: 'Grok', redirect_uris: [redirect] } })
      expect(registered.status()).toBe(201)
      const clientId = (await registered.json()).client_id as string
      const challenge = createHash('sha256').update(randomBytes(48).toString('base64url')).digest('base64url')
      const query = new URLSearchParams({
        response_type: 'code',
        client_id: clientId,
        redirect_uri: redirect,
        code_challenge: challenge,
        code_challenge_method: 'S256',
        state: 'screens'
      }).toString()
      const dir = path.join(OUT, String(width))
      mkdirSync(dir, { recursive: true })
      const height = width < 800 ? 844 : 800

      const signedOut = await browser.newContext({ viewport: { width, height }, serviceWorkers: 'block' })
      const outPage = await signedOut.newPage()
      await outPage.goto(`${BASE}/api/oauth/authorize?${query}`)
      await outPage.getByRole('heading', { name: 'Sign in to continue' }).waitFor()
      await outPage.screenshot({ path: path.join(dir, 'consent-signed-out.png'), fullPage: true })
      await signedOut.close()

      const login = `screens-consent-${width}-${Date.now()}`
      const session = await request.post(`${BASE}/api/dev/session`, { data: { login } })
      expect(session.ok()).toBeTruthy()
      const cookie = session.headersArray().find((h) => h.name.toLowerCase() === 'set-cookie')?.value ?? ''
      const sessionToken = cookie.match(/xt_session=([^;]+)/)?.[1]
      expect(sessionToken).toBeTruthy()
      const signedIn = await browser.newContext({ viewport: { width, height }, serviceWorkers: 'block' })
      await signedIn.addCookies([{ name: 'xt_session', value: sessionToken!, url: BASE }])
      const inPage = await signedIn.newPage()
      await inPage.goto(`${BASE}/api/oauth/authorize?${query}`)
      await inPage.getByRole('button', { name: 'Approve' }).waitFor()
      await inPage.screenshot({ path: path.join(dir, 'consent.png'), fullPage: true })
      await signedIn.close()
    })
  }
})
