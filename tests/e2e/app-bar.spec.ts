// The app bar on signed-in pages at phone width (plan T3b-2). Runs in the required `chromium`
// project: playwright.config.ts starts the local API and the built app, so no person is needed.
// Signed in with a dev API token (POST /api/dev/token), sent as a bearer header on /api calls.
// Nothing here is stored; the draft is created in the local API.

import { expect, request as playwrightRequest, test, type APIRequestContext, type Browser, type BrowserContext, type Locator, type Page } from '@playwright/test'

const BASE = process.env.XT_BASE_URL ?? 'http://127.0.0.1:4173'
const ORIGIN = new URL(BASE).origin
const PHONE = { width: 390, height: 844 }
const LAST = 'LAST-POST'

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
let token = ''
let draftId = ''
let login = ''

test.beforeAll(async () => {
  api = await playwrightRequest.newContext({ baseURL: BASE })
  login = `app-bar-${Date.now()}`
  const signedIn = await api.post('/api/dev/token', { data: { login } })
  expect(signedIn.ok()).toBeTruthy()
  token = (await signedIn.json()).token as string

  // Eight Hebrew posts, so the editor is longer than the screen; the last one is marked.
  const posts = Array.from({ length: 8 }, (_, i) => ({
    id: `p${i + 1}`,
    text: i === 7 ? `${LAST} הפוסט האחרון בשרשור` : `פוסט מספר ${i + 1} בשרשור לבדיקת הסרגל התחתון.`,
    images: [],
    embeddedTweet: null
  }))
  const created = await api.post('/api/drafts', {
    headers: { authorization: `Bearer ${token}` },
    data: { title: 'App bar check', posts }
  })
  expect(created.ok()).toBeTruthy()
  draftId = (await created.json()).draft.id as string
})

test.afterAll(async () => {
  await api.dispose()
})

async function openContext(browser: Browser, options: { viewport?: { width: number; height: number }; reducedMotion?: 'reduce'; signedIn?: boolean } = {}) {
  const context: BrowserContext = await browser.newContext({
    viewport: options.viewport ?? PHONE,
    deviceScaleFactor: 2,
    serviceWorkers: 'block',
    reducedMotion: options.reducedMotion
  })
  if (options.signedIn !== false) {
    const bearer = `Bearer ${token}`
    await context.route(`${ORIGIN}/**`, (route) => {
      if (new URL(route.request().url()).pathname.startsWith('/api/')) {
        return route.continue({ headers: { ...route.request().headers(), authorization: bearer } })
      }
      return route.continue()
    })
  }
  return { context, page: await context.newPage() }
}

async function boxOf(locator: Locator) {
  const box = await locator.boundingBox()
  expect(box, 'element has a box').not.toBeNull()
  return box!
}

// Each visible button in the bar sits on the same row and is big enough to tap.
async function expectOneRow(page: Page) {
  const buttons = page.locator('.app-bar button:visible')
  const count = await buttons.count()
  expect(count).toBeGreaterThanOrEqual(2)
  const first = await boxOf(buttons.first())
  const firstCentre = first.y + first.height / 2
  for (let i = 0; i < count; i++) {
    const box = await boxOf(buttons.nth(i))
    expect(Math.abs(box.y + box.height / 2 - firstCentre), `button ${i} is on the same row`).toBeLessThanOrEqual(1)
    expect(box.width).toBeGreaterThanOrEqual(40)
    expect(box.height).toBeGreaterThanOrEqual(24)
  }
}

async function scrollToEnd(page: Page) {
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight))
  await page.waitForFunction(() => window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 1)
}

const SIGN_OUT = { name: 'Sign out', exact: true }
const HIDE = { name: 'Hide toolbar', exact: true }
const SHOW = { name: 'Show toolbar', exact: true }

// Built inside the tests: the draft id exists only after beforeAll.
function pagesFor() {
  return [
    { name: 'draft list', path: '/', ready: (p: Page) => p.getByRole('heading', { name: 'Your Threads' }) },
    { name: 'editor', path: `/draft/${draftId}`, ready: (p: Page) => p.locator('.draft-title-input') },
    { name: 'settings', path: '/settings/tokens', ready: (p: Page) => p.getByRole('heading', { name: 'API tokens', level: 1 }) }
  ]
}

test.describe('app bar on phones', () => {
  test('one bar at the bottom of every signed-in page, with sign-out, at most 56 px high', async ({ browser }) => {
    for (const pageInfo of pagesFor()) {
      const { context, page } = await openContext(browser)
      try {
        await page.goto(`${BASE}${pageInfo.path}`)
        await pageInfo.ready(page).waitFor()
        const bar = page.locator('.app-bar')
        await expect(bar, pageInfo.name).toBeVisible()
        const box = await boxOf(bar)
        expect(box.height, pageInfo.name).toBeLessThanOrEqual(56)
        expect(Math.abs(box.y + box.height - PHONE.height), pageInfo.name).toBeLessThan(1)
        await expect(page.getByRole('button', SIGN_OUT), pageInfo.name).toBeVisible()
        const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth)
        expect(scrollWidth, pageInfo.name).toBeLessThanOrEqual(393)
      } finally {
        await context.close()
      }
    }
  })

  test('on the editor the bar is one row and the round toggle is gone', async ({ browser }) => {
    const { context, page } = await openContext(browser)
    try {
      await page.goto(`${BASE}/draft/${draftId}`)
      await page.locator('.draft-title-input').waitFor()
      await expectOneRow(page)
      await expect(page.locator('.sidebar-toggle')).toHaveCount(0)
    } finally {
      await context.close()
    }
  })

  test('the Export and Share menus open above the bar and stay on screen', async ({ browser }) => {
    const { context, page } = await openContext(browser)
    try {
      await page.goto(`${BASE}/draft/${draftId}`)
      await page.locator('.draft-title-input').waitFor()
      const bar = await boxOf(page.locator('.app-bar'))

      await page.getByRole('button', { name: 'Export', exact: true }).click()
      await expect(page.getByText('Copy with numbers')).toBeVisible()
      const exportMenu = await boxOf(page.locator('.share-menu'))
      expect(exportMenu.y).toBeGreaterThanOrEqual(0)
      expect(exportMenu.x).toBeGreaterThanOrEqual(0)
      expect(exportMenu.y + exportMenu.height).toBeLessThanOrEqual(bar.y)

      await page.keyboard.press('Escape')
      await page.getByRole('button', { name: 'Share', exact: true }).click()
      await expect(page.getByRole('button', { name: '1 hour', exact: false })).toBeVisible()
      const shareMenu = await boxOf(page.locator('.share-menu'))
      expect(shareMenu.y).toBeGreaterThanOrEqual(0)
      expect(shareMenu.x).toBeGreaterThanOrEqual(0)
      expect(shareMenu.y + shareMenu.height).toBeLessThanOrEqual(bar.y)
    } finally {
      await context.close()
    }
  })

  test('the last post is not covered by the bar, shown or hidden', async ({ browser }) => {
    const { context, page } = await openContext(browser)
    try {
      await page.goto(`${BASE}/draft/${draftId}`)
      await page.locator('.draft-title-input').waitFor()

      await scrollToEnd(page)
      const shownBarTop = (await boxOf(page.locator('.app-bar'))).y
      const lastField = page.locator('textarea').last()
      await expect(lastField).toHaveValue(new RegExp(LAST))
      const lastPost = await boxOf(lastField)
      expect(lastPost.y + lastPost.height).toBeLessThanOrEqual(shownBarTop)
      const shownPanel = await boxOf(page.locator('.main-panel'))
      expect(shownPanel.y + shownPanel.height).toBeLessThanOrEqual(shownBarTop)

      await page.getByRole('button', HIDE).click()
      await scrollToEnd(page)
      const tab = await boxOf(page.getByRole('button', SHOW))
      const panel = await boxOf(page.locator('.main-panel'))
      expect(panel.y + panel.height).toBeLessThanOrEqual(tab.y)
    } finally {
      await context.close()
    }
  })

  test('hiding the bar survives a reload and holds on the other pages', async ({ browser }) => {
    const { context, page } = await openContext(browser)
    try {
      await page.goto(`${BASE}/draft/${draftId}`)
      await page.locator('.draft-title-input').waitFor()

      await page.getByRole('button', HIDE).click()
      await expect(page.getByRole('button', SIGN_OUT)).toBeHidden()
      const tab = page.getByRole('button', SHOW)
      await expect(tab).toBeVisible()
      await expect(tab).toHaveAttribute('aria-expanded', 'false')
      const tabBox = await boxOf(tab)
      expect(tabBox.height).toBeLessThanOrEqual(36)
      expect(tabBox.width).toBeGreaterThanOrEqual(24)

      await page.reload()
      await expect(page.getByRole('button', SHOW)).toBeVisible()

      await page.goto(`${BASE}/`)
      await expect(page.getByRole('button', SHOW)).toBeVisible()
      await page.goto(`${BASE}/settings/tokens`)
      await expect(page.getByRole('button', SHOW)).toBeVisible()

      await page.getByRole('button', SHOW).click()
      await expect(page.getByRole('button', SIGN_OUT)).toBeVisible()
      await page.reload()
      await expect(page.getByRole('button', HIDE)).toBeVisible()
      await expect(page.getByRole('button', SIGN_OUT)).toBeVisible()
    } finally {
      await context.close()
    }
  })

  for (const width of [360, 320]) {
    test(`the editor bar is one row at ${width} px`, async ({ browser }) => {
      const { context, page } = await openContext(browser, { viewport: { width, height: 740 } })
      try {
        await page.goto(`${BASE}/draft/${draftId}`)
        await page.locator('.draft-title-input').waitFor()
        const box = await boxOf(page.locator('.app-bar'))
        expect(box.height).toBeLessThanOrEqual(56)
        await expectOneRow(page)
      } finally {
        await context.close()
      }
    })
  }

  test('on wide screens there is no fixed bar: the actions sit in the header', async ({ browser }) => {
    const { context, page } = await openContext(browser, { viewport: { width: 1280, height: 800 } })
    try {
      await page.goto(`${BASE}/draft/${draftId}`)
      await page.locator('.draft-title-input').waitFor()
      await expect(page.locator('.app-bar-toggle')).toBeHidden()
      await expect(page.getByRole('button', SIGN_OUT)).toBeVisible()
      expect((await boxOf(page.getByRole('button', SIGN_OUT))).y).toBeLessThan(100)
      const position = await page.evaluate(() => getComputedStyle(document.querySelector('.app-bar') as Element).position)
      expect(position).toBe('static')
    } finally {
      await context.close()
    }
  })

  // Signs in with a session cookie (a bearer header would stay signed in after sign-out). The same login
  // is the same user, so the cookie owns the draft made with the bearer token.
  test('Sign out in the bar ends the session on the server and clears cached drafts, on every page', async ({ browser }) => {
    for (const pageInfo of pagesFor()) {
      const dev = await playwrightRequest.newContext({ baseURL: BASE })
      const session = await dev.post('/api/dev/session', { data: { login } })
      expect(session.ok()).toBeTruthy()
      const setCookie = session.headersArray().find((h) => h.name.toLowerCase() === 'set-cookie')?.value ?? ''
      const cookieValue = setCookie.match(/xt_session=([^;]+)/)?.[1]
      expect(cookieValue).toBeTruthy()
      await dev.dispose()

      const { context, page } = await openContext(browser, { signedIn: false })
      try {
        await postsFromAppOrigin(context)
        await context.addCookies([{ name: 'xt_session', value: cookieValue!, url: BASE }])
        await page.goto(`${BASE}${pageInfo.path}`)
        await pageInfo.ready(page).waitFor()
        // A cached draft that sign-out must remove, in the store idb-keyval uses.
        await page.evaluate(
          () =>
            new Promise<void>((resolve, reject) => {
              const open = indexedDB.open('keyval-store')
              open.onupgradeneeded = () => open.result.createObjectStore('keyval')
              open.onsuccess = () => {
                const tx = open.result.transaction('keyval', 'readwrite')
                tx.objectStore('keyval').put({ title: 'cached' }, 'draft-sign-out-check')
                tx.oncomplete = () => resolve()
                tx.onerror = () => reject(tx.error)
              }
              open.onerror = () => reject(open.error)
            })
        )
        if (pageInfo.name === 'editor') {
          // The editor caches the draft it loaded; wait for that write so it cannot land after sign-out.
          await expect
            .poll(() =>
              page.evaluate(
                () =>
                  new Promise<string[]>((resolve) => {
                    const open = indexedDB.open('keyval-store')
                    open.onsuccess = () => {
                      const req = open.result.transaction('keyval', 'readonly').objectStore('keyval').getAllKeys()
                      req.onsuccess = () => resolve(req.result.map(String))
                    }
                  })
              )
            )
            .toContain(`draft-${draftId}`)
        }
        if (pageInfo.name === 'settings') {
          await page.getByRole('button', HIDE).click()
          await page.getByRole('button', SHOW).click()
        }
        await page.getByRole('button', SIGN_OUT).click()
        await expect(page.getByRole('button', { name: 'Sign in with GitHub' }), pageInfo.name).toBeVisible()
        const left = await page.evaluate(
          () =>
            new Promise<string[]>((resolve, reject) => {
              const open = indexedDB.open('keyval-store')
              open.onsuccess = () => {
                const req = open.result.transaction('keyval', 'readonly').objectStore('keyval').getAllKeys()
                req.onsuccess = () => resolve(req.result.map(String))
                req.onerror = () => reject(req.error)
              }
              open.onerror = () => reject(open.error)
            })
        )
        expect(left.filter((key) => key.startsWith('draft-')), pageInfo.name).toEqual([])

        // The old cookie value is refused by the server now.
        const old = await playwrightRequest.newContext({ baseURL: BASE, extraHTTPHeaders: { cookie: `xt_session=${cookieValue}` } })
        const list = await old.get('/api/drafts')
        expect(list.status(), pageInfo.name).toBe(401)
        await old.dispose()
      } finally {
        await context.close()
      }
    }
  })

  test('the login page and the shared preview have no bar', async ({ browser }) => {
    const shared = await api.post(`/api/drafts/${draftId}/share-tokens`, {
      headers: { authorization: `Bearer ${token}` }
    })
    expect(shared.ok()).toBeTruthy()
    const shareToken = (await shared.json()).token as string

    const { context, page } = await openContext(browser, { signedIn: false })
    try {
      await page.goto(`${BASE}/`)
      await expect(page.getByRole('button', { name: 'Sign in with GitHub' })).toBeVisible()
      await expect(page.locator('.app-bar')).toHaveCount(0)

      await page.goto(`${BASE}/x-thread-preview/${shareToken}`)
      await expect(page.locator('body')).toContainText(LAST)
      await expect(page.locator('.app-bar')).toHaveCount(0)
    } finally {
      await context.close()
    }
  })

  test('the bar does not animate for people who ask for reduced motion', async ({ browser }) => {
    const { context, page } = await openContext(browser, { reducedMotion: 'reduce' })
    try {
      await page.goto(`${BASE}/draft/${draftId}`)
      await page.locator('.draft-title-input').waitFor()
      const duration = await page.evaluate(() => getComputedStyle(document.querySelector('.app-bar-actions') as Element).transitionDuration)
      expect(duration).toBe('0s')
    } finally {
      await context.close()
    }
  })
})
