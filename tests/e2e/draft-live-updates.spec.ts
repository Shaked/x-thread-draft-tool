// The open editor shows a change another app made, without a reload (#363). Runs in the required `chromium` project:
// playwright.config.ts starts the local API and the built app. An API call stands in for the AI app.

import { expect, request as playwrightRequest, test, type APIRequestContext } from '@playwright/test'

const BASE = process.env.XT_BASE_URL ?? 'http://127.0.0.1:4173'
const ORIGIN = new URL(BASE).origin

let api: APIRequestContext
let token = ''

test.beforeAll(async () => {
  api = await playwrightRequest.newContext({ baseURL: BASE })
  const signedIn = await api.post('/api/dev/token', { data: { login: `live-updates-${Date.now()}` } })
  expect(signedIn.ok()).toBeTruthy()
  token = (await signedIn.json()).token as string
})

test.afterAll(async () => {
  await api.dispose()
})

test('an AI edit to post 2 shows in the open editor within 6 s, with no reload and a highlight', async ({ browser }) => {
  const bearer = `Bearer ${token}`
  const created = await api.post('/api/drafts', {
    headers: { authorization: bearer },
    data: {
      title: 'Live updates check',
      posts: [
        { id: 'l1', text: 'Post one', images: [], embeddedTweet: null },
        { id: 'l2', text: 'Post two', images: [], embeddedTweet: null }
      ]
    }
  })
  expect(created.ok()).toBeTruthy()
  const id = (await created.json()).draft.id as string

  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, serviceWorkers: 'block' })
  await context.route(`${ORIGIN}/**`, (route) => {
    if (new URL(route.request().url()).pathname.startsWith('/api/')) {
      return route.continue({ headers: { ...route.request().headers(), authorization: bearer } })
    }
    return route.continue()
  })
  const page = await context.newPage()
  await page.goto(`${BASE}/draft/${id}`)
  await page.getByLabel('Draft title').waitFor()

  // The other app saves post 2 (no If-Match: the AI app is not editing the editor's copy).
  const current = await api.get(`/api/drafts/${id}`, { headers: { authorization: bearer } })
  const draft = (await current.json()).draft
  const changed = await api.patch(`/api/drafts/${id}`, {
    headers: { authorization: bearer },
    data: { posts: [draft.posts[0], { ...draft.posts[1], text: 'Post two, changed by the AI app' }] }
  })
  expect(changed.ok()).toBeTruthy()

  const second = page.locator('textarea.post-textarea').nth(1)
  await expect(second).toHaveValue('Post two, changed by the AI app', { timeout: 6000 })
  await expect(page.locator('.thread-post--updated').first()).toBeVisible()
  await expect(page.getByText('Updated just now')).toBeVisible()
  await context.close()
})
