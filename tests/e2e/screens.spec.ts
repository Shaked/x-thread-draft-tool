// Screenshot harness for UI work (plan Task 6.0). Not part of the default run: `npm run screens`.
//
// Needs the built app and the local API:
//   npm run build && npm run preview -- --port 4173   # the app, http://localhost:4173 (proxies /api)
//   npm run dev:api                                   # the API, http://127.0.0.1:8787
// Use the built app, not `npm run dev`: in development React StrictMode runs the preview effect
// twice, and the second request hits the one-use share link and gets 410.
// Writes test-results/screens/<width>/<name>.png for 390 px and 1280 px wide:
// login, login-suspended, drafts-empty, drafts-three, editor, editor-export-menu, editor-bar-hidden (phones only), preview, share, tokens, apps, changelog,
// flags (the Feature flags page, #406), dialog-delete, dialog-revoke, toast-copied (plan U5), consent-signed-out and consent (the OAuth approval pages, plan T3).
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
// XT_SKIN=rare takes the shots with the Rare UI look (feature flag, Settings > Feature flags) into test-results/screens-rare.
const SKIN = process.env.XT_SKIN === 'rare' ? 'rare' : null
const OUT = path.join('test-results', SKIN ? `screens-${SKIN}` : 'screens')
// The dev API checks the Origin of cookie POSTs against its own address; the preview (4173) is proxied to it.
// A POST sent from the preview origin is therefore re-sent with the API origin (same trick as app-menu.spec.ts).
const APP_ORIGIN = ORIGIN === 'http://127.0.0.1:4173' || ORIGIN === 'http://localhost:4173' ? 'http://127.0.0.1:8787' : ORIGIN

async function devToken(request: APIRequestContext, login: string, admin = false): Promise<string> {
  const res = await request.post(`${BASE}/api/dev/token`, { data: { login, admin } })
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

async function sessionCookie(request: APIRequestContext, login: string): Promise<string> {
  const res = await request.post(`${BASE}/api/dev/session`, { data: { login } })
  expect(res.ok()).toBeTruthy()
  const cookie = res.headersArray().find((h) => h.name.toLowerCase() === 'set-cookie')?.value.match(/xt_session=([^;]+)/)?.[1]
  expect(cookie).toBeTruthy()
  return cookie!
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
  options: { token?: string; cookie?: string; theme?: 'dark'; ready?: (page: Page) => Locator; before?: (page: Page) => Promise<void>; viewportOnly?: boolean } = {}
) {
  const context = await browser.newContext({
    viewport: { width, height: width < 800 ? 844 : 800 },
    serviceWorkers: 'block',
    permissions: ['clipboard-read', 'clipboard-write']
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
  if (options.cookie) {
    // Creating a token needs a browser session (cookie), so POSTs go out with the API origin.
    await context.addCookies([{ name: 'xt_session', value: options.cookie, url: BASE }])
    await context.route(`${ORIGIN}/api/**`, async (route) => {
      if (route.request().method() !== 'POST') return route.continue()
      const response = await route.fetch({ headers: { ...route.request().headers(), origin: APP_ORIGIN }, maxRedirects: 0 })
      return route.fulfill({ response })
    })
  }
  const page = await context.newPage()
  if (options.theme) await page.addInitScript((value) => localStorage.setItem('xt-theme', value), options.theme)
  if (SKIN) await page.addInitScript((value) => localStorage.setItem('xt-skin', value), SKIN)
  await page.goto(`${BASE}${pagePath}`, { waitUntil: 'networkidle' })
  if (options.ready) await options.ready(page).first().waitFor({ timeout: 15_000 })
  if (options.before) await options.before(page)
  const dir = path.join(OUT, String(width))
  mkdirSync(dir, { recursive: true })
  await page.screenshot({ path: path.join(dir, `${name}.png`), fullPage: !options.viewportOnly })
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
      const admin = await devToken(request, 'screens-admin', true) // the changelog is admin only (#368)

      // Empty list: a user with no drafts.
      await shoot(browser, width, 'drafts-empty', '/', { token: empty })
      await shoot(browser, width, 'drafts-empty-dark', '/', { token: empty, theme: 'dark', ready: (p) => p.getByRole('button', { name: 'Create your first draft' }) })

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
      await shoot(browser, width, 'login-suspended', '/?suspended=1', { ready: (p) => p.getByRole('alert').getByText('This account is suspended.') })
      await shoot(browser, width, 'drafts-three', '/', { token: owner, ready: (p) => p.getByText('Launch thread') })
      await shoot(browser, width, 'drafts-three-dark', '/', { token: owner, theme: 'dark', ready: (p) => p.getByText('Launch thread') })

      // The draft list with a Hebrew title (plan T6): the Drafts tab, and the Published tab with one published draft.
      const hebrew = await devToken(request, `screens-hebrew-${run}`)
      const hebrewPublished = await apiJson<{ draft: { id: string } }>(request, hebrew, 'POST', '/api/drafts', {
        title: 'שרשור שפורסם',
        posts: [{ id: 'hp1', text: 'טקסט בעברית לדוגמה', images: [], embeddedTweet: null }]
      })
      await apiJson(request, hebrew, 'POST', `/api/drafts/${hebrewPublished.draft.id}/publish`)
      await apiJson(request, hebrew, 'POST', '/api/drafts', {
        title: 'טיוטה חדשה',
        posts: [{ id: 'hd1', text: 'עוד טקסט בעברית', images: [], embeddedTweet: null }]
      })
      const showPublished = async (p: Page) => {
        await p.getByRole('tab', { name: 'Published (1)' }).click()
        await p.getByText('שרשור שפורסם').waitFor()
      }
      await shoot(browser, width, 'drafts-hebrew', '/', { token: hebrew, ready: (p) => p.getByText('טיוטה חדשה') })
      await shoot(browser, width, 'drafts-hebrew-dark', '/', { token: hebrew, theme: 'dark', ready: (p) => p.getByText('טיוטה חדשה') })
      await shoot(browser, width, 'drafts-published', '/', { token: hebrew, ready: (p) => p.getByText('טיוטה חדשה'), before: showPublished })
      await shoot(browser, width, 'drafts-published-dark', '/', { token: hebrew, theme: 'dark', ready: (p) => p.getByText('טיוטה חדשה'), before: showPublished })
      // The editor's posts over the limit and in Hebrew (plan T9). Their own user, so no other scene's list changes.
      const editorUser = await devToken(request, `screens-editor-${run}`)
      const overLimit = await apiJson<{ draft: { id: string } }>(request, editorUser, 'POST', '/api/drafts', {
        title: 'Over the limit',
        posts: [
          { id: 'ol1', text: 'A post well within the limit.', images: [], embeddedTweet: null },
          { id: 'ol2', text: 'A longer post. '.repeat(20), images: [], embeddedTweet: null }
        ]
      })
      const hebrewEditor = await apiJson<{ draft: { id: string } }>(request, editorUser, 'POST', '/api/drafts', {
        title: 'שרשור בעברית',
        posts: [
          { id: 'hb1', text: 'טקסט בעברית לדוגמה, והשרשור ממשיך כאן.', images: [], embeddedTweet: null },
          { id: 'hb2', text: 'המשך השרשור בעברית.', images: [], embeddedTweet: null }
        ]
      })
      await shoot(browser, width, 'editor-over-limit', `/draft/${overLimit.draft.id}`, { token: editorUser, ready: (p) => p.getByLabel('Draft title') })
      await shoot(browser, width, 'editor-over-limit-dark', `/draft/${overLimit.draft.id}`, { token: editorUser, theme: 'dark', ready: (p) => p.getByLabel('Draft title') })
      await shoot(browser, width, 'editor-hebrew', `/draft/${hebrewEditor.draft.id}`, { token: editorUser, ready: (p) => p.getByLabel('Draft title') })
      await shoot(browser, width, 'editor-hebrew-dark', `/draft/${hebrewEditor.draft.id}`, { token: editorUser, theme: 'dark', ready: (p) => p.getByLabel('Draft title') })

      await shoot(browser, width, 'editor', `/draft/${editorId}`, { token: owner, ready: (p) => p.getByLabel('Draft title') })
      await shoot(browser, width, 'editor-dark', `/draft/${editorId}`, { token: owner, theme: 'dark', ready: (p) => p.getByLabel('Draft title') })
      await shoot(browser, width, 'editor-export-menu', `/draft/${editorId}`, {
        token: owner,
        ready: (p) => p.getByLabel('Draft title'),
        before: async (p) => {
          await p.getByRole('button', { name: 'Export' }).click()
          await p.getByText('Copy with numbers').waitFor()
        }
      })
      await shoot(browser, width, 'editor-export-menu-dark', `/draft/${editorId}`, {
        token: owner,
        theme: 'dark',
        ready: (p) => p.getByLabel('Draft title'),
        before: async (p) => {
          await p.getByRole('button', { name: 'Export' }).click()
          await p.getByText('Copy with numbers').waitFor()
        }
      })
      // The share menu: its lifetimes list (plan T8), light and dark.
      const openShare = async (p: Page) => {
        await p.getByRole('button', { name: 'Share', exact: true }).click()
        await p.getByRole('menuitem', { name: '1 hour (default)' }).waitFor()
      }
      await shoot(browser, width, 'editor-share-menu', `/draft/${editorId}`, { token: owner, ready: (p) => p.getByLabel('Draft title'), before: openShare })
      await shoot(browser, width, 'editor-share-menu-dark', `/draft/${editorId}`, { token: owner, theme: 'dark', ready: (p) => p.getByLabel('Draft title'), before: openShare })
      // The hide control exists on phones only (wide screens have no fixed bar).
      if (width < 800) {
        await shoot(browser, width, 'editor-bar-hidden', `/draft/${editorId}`, {
          token: owner,
          ready: (p) => p.getByLabel('Draft title'),
          before: async (p) => {
            await p.getByRole('button', { name: 'Hide toolbar' }).click()
            await p.getByRole('button', { name: 'Show toolbar' }).waitFor()
          }
        })
      }

      // Preview page and share page each need their own one-use share token.
      const previewToken = (await apiJson<{ token: string }>(request, owner, 'POST', `/api/drafts/${editorId}/share-tokens`)).token
      const shareToken = (await apiJson<{ token: string }>(request, owner, 'POST', `/api/drafts/${editorId}/share-tokens`)).token
      await shoot(browser, width, 'preview', `/x-thread-preview/${previewToken}`, { ready: (p) => p.frameLocator('iframe[title="Thread preview"]').getByText('Opening post') })
      await shoot(browser, width, 'share', `/api/share/${shareToken}.html`, { ready: (p) => p.getByText('Opening post') })

      // The menu drawer: light and dark on both widths.
      const openMenu = async (p: Page) => {
        await p.getByRole('button', { name: 'Menu', exact: true }).click()
        await p.locator('#app-menu').waitFor()
        await p.waitForTimeout(300)
      }
      await shoot(browser, width, 'menu-open', `/draft/${editorId}`, { token: owner, ready: (p) => p.getByLabel('Draft title'), before: openMenu })
      await shoot(browser, width, 'menu-open-dark', `/draft/${editorId}`, { token: owner, theme: 'dark', ready: (p) => p.getByLabel('Draft title'), before: openMenu })

      // The API tokens page (settings-menu.md M12), light and dark; then after a token is created, so the one-time box shows.
      const tokensReady = (p: Page) => p.getByRole('heading', { name: 'API tokens', level: 1 })
      const cookie = await sessionCookie(request, `screens-tokens-${width}-${run}`)
      const createToken = async (p: Page) => {
        await p.getByLabel('Token name').fill('Screens check')
        await p.getByRole('button', { name: 'Create token' }).click()
        await p.getByRole('status').filter({ hasText: 'Copy this token now.' }).locator('code').waitFor()
      }
      await shoot(browser, width, 'tokens', '/settings/tokens', { token: owner, ready: tokensReady })
      await shoot(browser, width, 'tokens-dark', '/settings/tokens', { token: owner, theme: 'dark', ready: tokensReady })
      await shoot(browser, width, 'tokens-created', '/settings/tokens', { cookie, ready: tokensReady, before: createToken })
      await shoot(browser, width, 'tokens-created-dark', '/settings/tokens', { cookie, theme: 'dark', ready: tokensReady, before: createToken })

      // Dialog and Toast (plan U5), light and dark: delete asks on the draft list, revoke asks on API tokens, a toast after Copy.
      const openDelete = async (p: Page) => {
        await p.getByRole('button', { name: 'Delete draft' }).first().click()
        await p.getByRole('dialog', { name: 'Delete this draft?' }).waitFor()
        await p.waitForTimeout(400)
      }
      const openRevoke = async (p: Page) => {
        await createToken(p)
        await p.getByRole('button', { name: 'Revoke' }).first().click()
        await p.getByRole('dialog', { name: 'Revoke this token?' }).waitFor()
        await p.waitForTimeout(400)
      }
      const copyThread = async (p: Page) => {
        await p.getByRole('button', { name: 'Export' }).click()
        await p.getByRole('menuitem', { name: 'Copy thread' }).click()
        await p.getByRole('status').filter({ hasText: 'Thread copied!' }).waitFor()
        await p.waitForTimeout(400)
      }
      const draftsReady = (p: Page) => p.getByText('Launch thread')
      await shoot(browser, width, 'dialog-delete', '/', { token: owner, ready: draftsReady, viewportOnly: true, before: openDelete })
      await shoot(browser, width, 'dialog-delete-dark', '/', { token: owner, theme: 'dark', ready: draftsReady, viewportOnly: true, before: openDelete })
      await shoot(browser, width, 'dialog-revoke', '/settings/tokens', { cookie, ready: tokensReady, viewportOnly: true, before: openRevoke })
      await shoot(browser, width, 'dialog-revoke-dark', '/settings/tokens', { cookie, theme: 'dark', ready: tokensReady, viewportOnly: true, before: openRevoke })
      await shoot(browser, width, 'toast-copied', `/draft/${editorId}`, { token: owner, ready: (p) => p.getByLabel('Draft title'), viewportOnly: true, before: copyThread })
      await shoot(browser, width, 'toast-copied-dark', `/draft/${editorId}`, { token: owner, theme: 'dark', ready: (p) => p.getByLabel('Draft title'), viewportOnly: true, before: copyThread })

      // The Connected apps page (plan T4), light and dark.
      const appsReady = (p: Page) => p.getByRole('heading', { name: 'Connected apps', level: 1 })
      await shoot(browser, width, 'apps', '/settings/apps', { token: owner, ready: appsReady })
      await shoot(browser, width, 'apps-dark', '/settings/apps', { token: owner, theme: 'dark', ready: appsReady })
      const flagsReady = (p: Page) => p.getByRole('heading', { name: 'Feature flags', level: 1 })
      await shoot(browser, width, 'flags', '/settings/flags', { token: owner, ready: flagsReady })
      await shoot(browser, width, 'flags-dark', '/settings/flags', { token: owner, theme: 'dark', ready: flagsReady })

      // The changelog page (settings-menu.md Task 6): light at both widths, dark on phones.
      const changelogReady = (p: Page) => p.locator('article').first()
      await shoot(browser, width, 'changelog', '/changelog', { token: admin, ready: changelogReady })
      await shoot(browser, width, 'changelog-dark', '/changelog', { token: admin, theme: 'dark', ready: changelogReady })

      // The admin metrics page (#337): light and dark at both widths.
      const metricsReady = (p: Page) => p.getByRole('heading', { name: 'All routes' })
      await shoot(browser, width, 'admin-metrics', '/admin/metrics', { token: admin, ready: metricsReady })
      await shoot(browser, width, 'admin-metrics-dark', '/admin/metrics', { token: admin, theme: 'dark', ready: metricsReady })

      // The About page (plan U2): light and dark at both widths. Ready once the server's version has loaded.
      const aboutReady = (p: Page) => p.getByRole('heading', { name: 'About', level: 1 })
      const aboutLoaded = async (p: Page) => {
        await p.getByText('Deployed').nth(1).waitFor()
      }
      await shoot(browser, width, 'about', '/about', { token: owner, ready: aboutReady, before: aboutLoaded })
      await shoot(browser, width, 'about-dark', '/about', { token: owner, theme: 'dark', ready: aboutReady, before: aboutLoaded })
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

    // The owner's consent page. The dev session is the owner's id; the page shows nothing about admin.
    test(`captures the owner's consent page at ${width}px`, async ({ browser, request }) => {
      const redirect = 'https://claude.ai/api/mcp/auth_callback'
      const registered = await request.post(`${BASE}/api/oauth/register`, { data: { client_name: 'Claude', redirect_uris: [redirect] } })
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
      const session = await request.post(`${BASE}/api/dev/session`, { data: { login: `screens-owner-${width}`, admin: true } })
      expect(session.ok()).toBeTruthy()
      const cookie = session.headersArray().find((h) => h.name.toLowerCase() === 'set-cookie')?.value.match(/xt_session=([^;]+)/)?.[1]
      expect(cookie).toBeTruthy()
      const approve = (p: Page) => p.getByRole('button', { name: 'Approve' })

      await shoot(browser, width, 'consent-admin', `/api/oauth/authorize?${query}`, { cookie: cookie!, ready: approve })
    })
  }
})
