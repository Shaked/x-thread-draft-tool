// The left menu on signed-in pages (settings-menu.md Task 2). Runs in the required `chromium` project:
// the local API and the built app are started by playwright.config.ts, so no person is needed.
// Signed in with a dev API token (bearer header on /api calls) or a dev session cookie (sign-out).

import { expect, request as playwrightRequest, test, type APIRequestContext, type Browser, type BrowserContext, type Page } from '@playwright/test'

const BASE = process.env.XT_BASE_URL ?? 'http://127.0.0.1:4173'
const ORIGIN = new URL(BASE).origin
const APP_ORIGIN = ORIGIN === 'http://127.0.0.1:4173' ? 'http://127.0.0.1:8787' : ORIGIN
const SIZES = [
  { name: '390', width: 390, height: 844 },
  { name: '1280', width: 1280, height: 800 }
]

let api: APIRequestContext
let token = ''
let draftId = ''
let login = ''

test.beforeAll(async () => {
  api = await playwrightRequest.newContext({ baseURL: BASE })
  login = `app-menu-${Date.now()}`
  const signedIn = await api.post('/api/dev/token', { data: { login } })
  expect(signedIn.ok()).toBeTruthy()
  token = (await signedIn.json()).token as string
  const posts = Array.from({ length: 8 }, (_, i) => ({ id: `p${i + 1}`, text: `Post ${i + 1} for the menu check.`, images: [], embeddedTweet: null }))
  const created = await api.post('/api/drafts', { headers: { authorization: `Bearer ${token}` }, data: { title: 'Menu check', posts } })
  expect(created.ok()).toBeTruthy()
  draftId = (await created.json()).draft.id as string
})

test.afterAll(async () => {
  await api.dispose()
})

async function open(browser: Browser, size: { width: number; height: number }, options: { cookie?: string; reducedMotion?: 'reduce' } = {}) {
  const context: BrowserContext = await browser.newContext({ viewport: size, serviceWorkers: 'block', reducedMotion: options.reducedMotion })
  if (options.cookie) {
    await context.route(`${ORIGIN}/api/**`, async (route) => {
      if (route.request().method() !== 'POST') return route.continue()
      const response = await route.fetch({ headers: { ...route.request().headers(), origin: APP_ORIGIN }, maxRedirects: 0 })
      return route.fulfill({ response })
    })
    await context.addCookies([{ name: 'xt_session', value: options.cookie, url: BASE }])
  } else {
    await context.route(`${ORIGIN}/**`, (route) => {
      if (new URL(route.request().url()).pathname.startsWith('/api/')) {
        return route.continue({ headers: { ...route.request().headers(), authorization: `Bearer ${token}` } })
      }
      return route.continue()
    })
  }
  return { context, page: await context.newPage() }
}

const MENU = { name: 'Menu', exact: true }
const hamburger = (page: Page) => page.getByRole('button', MENU)
const drawer = (page: Page) => page.locator('#app-menu')

async function openMenu(page: Page) {
  await hamburger(page).click()
  await expect(drawer(page)).toBeVisible()
}

const pages = () => [
  { name: 'list', path: '/', ready: (p: Page) => p.getByRole('heading', { name: 'Your Threads' }) },
  { name: 'editor', path: `/draft/${draftId}`, ready: (p: Page) => p.locator('.draft-title-input') },
  { name: 'settings', path: '/settings/tokens', ready: (p: Page) => p.getByRole('heading', { name: 'API tokens', level: 1 }) }
]

for (const size of SIZES) {
  test.describe(`menu at ${size.name} px`, () => {
    test('closed on load; opens, stays inside the viewport and does not overflow; Escape and scrim close it', async ({ browser }) => {
      for (const info of pages()) {
        const { context, page } = await open(browser, size)
        try {
          await page.goto(`${BASE}${info.path}`)
          await info.ready(page).waitFor()
          await expect(drawer(page), info.name).toHaveCount(0)
          await expect(hamburger(page), info.name).toHaveAttribute('aria-expanded', 'false')

          await openMenu(page)
          await expect(hamburger(page)).toHaveAttribute('aria-expanded', 'true')
          // Wait for the 0.2 s slide to end before measuring.
          await expect.poll(async () => (await drawer(page).boundingBox())!.x, info.name).toBeGreaterThanOrEqual(0)
          const box = (await drawer(page).boundingBox())!
          expect(box.x, info.name).toBeGreaterThanOrEqual(0)
          expect(box.x + box.width, info.name).toBeLessThanOrEqual(size.width)
          expect(box.width, info.name).toBeLessThanOrEqual(320)
          expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), info.name).toBe(true)

          await page.keyboard.press('Escape')
          await expect(drawer(page), info.name).toHaveCount(0)
          await expect(hamburger(page), info.name).toBeFocused()

          await openMenu(page)
          await page.mouse.click(size.width - 5, size.height / 2)
          await expect(drawer(page), info.name).toHaveCount(0)
          await expect(hamburger(page), info.name).toBeFocused()
        } finally {
          await context.close()
        }
      }
    })

    test('the page behind is inert; the drawer is above the fixed bar and the sticky editor header', async ({ browser }) => {
      const { context, page } = await open(browser, size)
      try {
        await page.goto(`${BASE}/draft/${draftId}`)
        await page.locator('.draft-title-input').waitFor()
        await openMenu(page)
        await expect(page.locator('#root')).toHaveAttribute('inert', '')
        expect(await page.evaluate(() => document.querySelector('#root')!.contains(document.activeElement))).toBe(false)
        // Tab never reaches the page behind.
        for (let i = 0; i < 10; i++) {
          await page.keyboard.press('Tab')
          expect(await page.evaluate(() => !!document.activeElement?.closest('#app-menu'))).toBe(true)
        }
        // At every point of the header and the bar, the top element is the scrim or the drawer.
        const covered = await page.evaluate(() => {
          const spots = [document.querySelector('.editor-header'), document.querySelector('.app-bar')]
          return spots.map((el) => {
            const r = el!.getBoundingClientRect()
            const hit = document.elementFromPoint(r.left + r.width * 0.75, r.top + r.height / 2)
            return !!hit?.closest('.app-menu-scrim, #app-menu')
          })
        })
        expect(covered).toEqual([true, true])
      } finally {
        await context.close()
      }
    })

    test('a drawer link navigates and closes the menu; Theme works inside the drawer', async ({ browser }) => {
      const { context, page } = await open(browser, size)
      try {
        await page.goto(`${BASE}/`)
        await page.getByRole('heading', { name: 'Your Threads' }).waitFor()
        await openMenu(page)
        await drawer(page).getByText('Dark', { exact: true }).click()
        await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
        await drawer(page).getByRole('link', { name: 'API tokens and apps' }).click()
        await expect(page).toHaveURL(/\/settings\/tokens$/)
        await expect(drawer(page)).toHaveCount(0)
        await expect(page.locator('#root')).not.toHaveAttribute('inert', /.*/)
      } finally {
        await context.close()
      }
    })

    test('the drafts list header has no Theme control and no tokens button', async ({ browser }) => {
      const { context, page } = await open(browser, size)
      try {
        await page.goto(`${BASE}/`)
        await page.getByRole('heading', { name: 'Your Threads' }).waitFor()
        const header = page.locator('.draft-list-header')
        await expect(header.getByText('Theme')).toHaveCount(0)
        await expect(header.getByRole('button', { name: 'API tokens' })).toHaveCount(0)
        await expect(page.getByRole('button', { name: 'API tokens' })).toHaveCount(0)
      } finally {
        await context.close()
      }
    })
  })
}

test('phone: the bottom bar is clickable after the menu closes and its Sign out still works', async ({ browser }) => {
  const dev = await playwrightRequest.newContext({ baseURL: BASE })
  const session = await dev.post('/api/dev/session', { data: { login } })
  const cookie = session.headersArray().find((h) => h.name.toLowerCase() === 'set-cookie')?.value.match(/xt_session=([^;]+)/)?.[1]
  await dev.dispose()
  expect(cookie).toBeTruthy()
  const { context, page } = await open(browser, SIZES[0], { cookie })
  try {
    await page.goto(`${BASE}/draft/${draftId}`)
    await page.locator('.draft-title-input').waitFor()
    await openMenu(page)
    await page.keyboard.press('Escape')
    await expect(drawer(page)).toHaveCount(0)
    await page.getByRole('button', { name: 'Hide toolbar', exact: true }).click()
    await page.getByRole('button', { name: 'Show toolbar', exact: true }).click()
    await page.locator('.app-bar').getByRole('button', { name: 'Sign out', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Sign in with GitHub' })).toBeVisible()
  } finally {
    await context.close()
  }
})

for (const size of SIZES) {
  test(`Sign out in the drawer signs out and shows the login page at ${size.name} px`, async ({ browser }) => {
    const dev = await playwrightRequest.newContext({ baseURL: BASE })
    const session = await dev.post('/api/dev/session', { data: { login } })
    const cookie = session.headersArray().find((h) => h.name.toLowerCase() === 'set-cookie')?.value.match(/xt_session=([^;]+)/)?.[1]
    await dev.dispose()
    expect(cookie).toBeTruthy()
    const { context, page } = await open(browser, size, { cookie })
    try {
      await page.goto(`${BASE}/`)
      await page.getByRole('heading', { name: 'Your Threads' }).waitFor()
      await openMenu(page)
      await drawer(page).getByRole('button', { name: 'Sign out', exact: true }).click()
      await expect(page.getByRole('button', { name: 'Sign in with GitHub' })).toBeVisible()
    } finally {
      await context.close()
    }
  })
}

test('with reduced motion the drawer does not animate', async ({ browser }) => {
  const { context, page } = await open(browser, SIZES[0], { reducedMotion: 'reduce' })
  try {
    await page.goto(`${BASE}/`)
    await page.getByRole('heading', { name: 'Your Threads' }).waitFor()
    await openMenu(page)
    expect(await drawer(page).evaluate((el) => getComputedStyle(el).animationName)).toBe('none')
  } finally {
    await context.close()
  }
})
