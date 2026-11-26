// The editor fits the screen on phones, even when embedded tweets load (plan W1, docs/plans/mobile-width.md).
// Runs in the required `chromium` project: playwright.config.ts starts the local API and the built app.
// Signed in with a dev API token (POST /api/dev/token), sent as a bearer header on /api calls.
// The Twitter widget script is stubbed, so no network call leaves the test.

import { expect, request as playwrightRequest, test, type APIRequestContext, type Browser, type BrowserContext, type Page } from '@playwright/test'

const BASE = process.env.XT_BASE_URL ?? 'http://127.0.0.1:4173'
const ORIGIN = new URL(BASE).origin
const PHONE = { width: 390, height: 844 }
const DESKTOP = { width: 1280, height: 800 }

// A widget that renders a 550 px iframe, like the real one: the page must not grow to fit it.
const WIDGET_STUB = `window.twttr={widgets:{createTweet(id,el){const f=document.createElement('iframe');f.style.cssText='display:block;width:550px;min-width:250px;max-width:550px;height:400px';el.appendChild(f);return Promise.resolve(f)}}}`

let api: APIRequestContext
let token = ''
let draftId = ''

test.beforeAll(async () => {
  api = await playwrightRequest.newContext({ baseURL: BASE })
  const signedIn = await api.post('/api/dev/token', { data: { login: `editor-width-${Date.now()}` } })
  expect(signedIn.ok()).toBeTruthy()
  token = (await signedIn.json()).token as string

  // Three Hebrew posts; the first one embeds a tweet.
  const posts = [
    { id: 'p1', text: 'פוסט ראשון בשרשור עם ציוץ מוטמע לבדיקת הרוחב.', images: [], embeddedTweet: 'https://x.com/a/status/123' },
    { id: 'p2', text: 'פוסט שני בשרשור לבדיקת הרוחב במסך טלפון.', images: [], embeddedTweet: null },
    { id: 'p3', text: 'פוסט שלישי ואחרון בשרשור.', images: [], embeddedTweet: null }
  ]
  const created = await api.post('/api/drafts', {
    headers: { authorization: `Bearer ${token}` },
    data: { title: 'Editor width check', posts }
  })
  expect(created.ok()).toBeTruthy()
  draftId = (await created.json()).draft.id as string
})

test.afterAll(async () => {
  await api.dispose()
})

async function openEditor(browser: Browser, viewport: { width: number; height: number }, id = draftId) {
  const context: BrowserContext = await browser.newContext({ viewport, deviceScaleFactor: 2, serviceWorkers: 'block' })
  const bearer = `Bearer ${token}`
  await context.route(`${ORIGIN}/**`, (route) => {
    if (new URL(route.request().url()).pathname.startsWith('/api/')) {
      return route.continue({ headers: { ...route.request().headers(), authorization: bearer } })
    }
    return route.continue()
  })
  await context.route('https://platform.twitter.com/widgets.js', (route) =>
    route.fulfill({ status: 200, contentType: 'application/javascript', body: WIDGET_STUB })
  )
  const page: Page = await context.newPage()
  await page.goto(`${BASE}/draft/${id}`)
  await page.getByLabel('Draft title').waitFor()
  return { context, page }
}

async function scrollWidth(page: Page) {
  return page.evaluate(() => document.documentElement.scrollWidth)
}

// The counter uses the X rules: a URL counts 23, so 'see ' + URL + 200 letters shows 27/280 (src/utils/xLength.js).
test('the post counter counts a URL as 23 characters', async ({ browser }) => {
  const created = await api.post('/api/drafts', {
    headers: { authorization: `Bearer ${token}` },
    data: { title: 'Counter check', posts: [{ id: 'c1', text: `see https://example.com/${'a'.repeat(200)}`, images: [], embeddedTweet: null }] }
  })
  expect(created.ok()).toBeTruthy()
  const id = (await created.json()).draft.id as string
  const { context, page } = await openEditor(browser, DESKTOP, id)
  try {
    // Rare UI is the default: the number is read once (sr-only), and the limit stays as plain text.
    const counter = page.locator('.char-counter').first()
    await expect(counter.locator('.sr-only')).toHaveText('27')
    await expect(counter).toContainText('/280')
  } finally {
    await context.close()
  }
})

test.describe('editor width', () => {
  test('on a 390 px phone the page does not scroll sideways once the embed loads', async ({ browser }) => {
    const { context, page } = await openEditor(browser, PHONE)
    try {
      await page.locator('.embedded-tweet-container').scrollIntoViewIfNeeded()
      await page.locator('.tweet-embed iframe').waitFor()

      expect(await scrollWidth(page)).toBeLessThanOrEqual(PHONE.width)

      const header = await page.locator('.ui-page-header').boundingBox()
      expect(header, 'header has a box').not.toBeNull()
      expect(header!.x).toBeGreaterThanOrEqual(0)
      expect(header!.x + header!.width).toBeLessThanOrEqual(PHONE.width)

      const post = await page.locator('.post-box').first().boundingBox()
      expect(post, 'post has a box').not.toBeNull()
      expect(post!.width).toBeGreaterThanOrEqual(0.92 * PHONE.width)

      const iframe = await page.locator('.tweet-embed iframe').boundingBox()
      expect(iframe, 'iframe has a box').not.toBeNull()
      expect(iframe!.x + iframe!.width).toBeLessThanOrEqual(PHONE.width)
    } finally {
      await context.close()
    }
  })

  test('on a 1280 px screen the header and composer show and the page does not overflow', async ({ browser }) => {
    const { context, page } = await openEditor(browser, DESKTOP)
    try {
      await page.locator('.embedded-tweet-container').scrollIntoViewIfNeeded()
      await page.locator('.tweet-embed iframe').waitFor()

      await expect(page.locator('.ui-page-header')).toBeVisible()
      await expect(page.locator('.thread-composer')).toBeVisible()
      expect(await scrollWidth(page)).toBeLessThanOrEqual(DESKTOP.width)
    } finally {
      await context.close()
    }
  })
})
