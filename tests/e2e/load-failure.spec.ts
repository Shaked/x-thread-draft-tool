// A file of the app that fails to load after a deploy (#551). Runs in the required `chromium` project against the
// local API and the built app (playwright.config.ts); no person is needed.
// On Vercel, a file of the build before a deploy is gone and the catch-all rewrite answers it with index.html, so the
// browser's import fails. These tests answer that file with index.html the same way and expect a notice, never an
// empty page. The admin signs in with a real browser session; the admin pages read the real local API.

import { expect, request as playwrightRequest, test, type APIRequestContext, type Browser, type Page } from '@playwright/test'

const BASE = process.env.XT_BASE_URL ?? 'http://127.0.0.1:4173'
const ORIGIN = new URL(BASE).origin
const APP_ORIGIN = ORIGIN === 'http://127.0.0.1:4173' ? 'http://127.0.0.1:8787' : ORIGIN
const SIZES = [
  { name: '390', width: 390, height: 844 },
  { name: '1280', width: 1280, height: 800 }
]

// A deploy removes both the script and the stylesheet of a lazy part. The main bundle loads the stylesheet first, so its
// failure ("Unable to preload CSS") comes before the import's. The Rare UI parts share the `cn-*.css` stylesheet.
const ADMIN_FILES = /\/assets\/AdminLayout-[^/]+\.(js|css)$/
const RARE_FILES = /\/assets\/(ThemeSelector|cn)-[^/]+\.(js|css)$/

let api: APIRequestContext
let adminCookie = ''

test.beforeAll(async () => {
  api = await playwrightRequest.newContext({ baseURL: BASE })
  const session = await api.post('/api/dev/session', { data: { login: `load-failure-${Date.now()}`, admin: true } })
  adminCookie = session.headersArray().find((h) => h.name.toLowerCase() === 'set-cookie')?.value.match(/xt_session=([^;]+)/)?.[1] ?? ''
  expect(adminCookie).toBeTruthy()
})

test.afterAll(async () => {
  await api.dispose()
})

// The admin's browser. `missing` names the built file (a regular expression on its path) that answers index.html.
async function openAsAdmin(browser: Browser, size: { width: number; height: number }, missing: RegExp) {
  const context = await browser.newContext({ viewport: size, serviceWorkers: 'block' })
  await context.addCookies([{ name: 'xt_session', value: adminCookie, url: BASE }])
  // Writes are checked against the app origin; reads go to the real API untouched.
  await context.route(`${ORIGIN}/api/**`, async (route) => {
    if (route.request().method() === 'GET') return route.continue()
    const response = await route.fetch({ headers: { ...route.request().headers(), origin: APP_ORIGIN }, maxRedirects: 0 })
    return route.fulfill({ response })
  })
  let answered = 0
  await context.route(missing, async (route) => {
    answered += 1
    const html = await (await api.get('/')).text()
    return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: html })
  })
  const page = await context.newPage()
  return { context, page, answered: () => answered }
}

async function openMenu(page: Page) {
  await page.getByRole('button', { name: 'Menu', exact: true }).click()
  await expect(page.locator('#app-menu')).toBeVisible()
}

for (const size of SIZES) {
  test(`admin area at ${size.name} px: a missing admin file shows a Reload notice, and Reload opens the admin`, async ({ browser }) => {
    const { context, page, answered } = await openAsAdmin(browser, size, ADMIN_FILES)
    try {
      await page.goto(`${BASE}/`)
      await expect(page.getByRole('heading', { name: 'Your Threads', level: 1 })).toBeVisible()
      await openMenu(page)
      await page.locator('#app-menu').getByRole('link', { name: /^Admin/ }).first().click()

      await expect(page.getByRole('heading', { name: 'This page could not load', level: 1 })).toBeVisible()
      await expect(page.getByRole('alert')).toHaveText(/This part of the app could not load\. A new version may be out: reload to get it\./)
      // Not an empty page: the menu and the way back stay.
      await expect(page.getByRole('button', { name: 'Menu', exact: true })).toBeVisible()
      await expect(page.getByRole('link', { name: '← Back to drafts' })).toBeVisible()
      expect(answered(), 'the admin file was asked for and answered with index.html').toBeGreaterThan(0)

      // After the reload the file is there again (the new build): the admin pages open.
      await context.unroute(ADMIN_FILES)
      await page.getByRole('button', { name: 'Reload' }).click()
      await expect(page.getByRole('navigation', { name: 'Admin pages' })).toBeVisible()
      await expect(page.getByRole('heading', { name: 'Statistics', level: 2 })).toBeVisible()
    } finally {
      await context.close()
    }
  })

  test(`menu at ${size.name} px: a missing Rare UI theme selector file shows the plain theme choice`, async ({ browser }) => {
    const { context, page, answered } = await openAsAdmin(browser, size, RARE_FILES)
    try {
      // The admin's account has the Rare UI components on (the flag is the admin's, #483). Only this answer is fixed,
      // so this test does not change the shared admin account that other tests read.
      await context.route(`${ORIGIN}/api/admin/flags`, (route) => {
        if (route.request().method() !== 'GET') return route.continue()
        const flag = (name: string, value: string) => ({ name, value, values: ['default', 'rare'], default: 'default', meaning: '' })
        return route.fulfill({ json: { flags: [flag('look', 'default'), flag('components', 'rare')] } })
      })
      await page.goto(`${BASE}/`)
      await expect(page.getByRole('heading', { name: 'Your Threads', level: 1 })).toBeVisible()
      await openMenu(page)
      const menu = page.locator('#app-menu')
      // The plain choice: three radios (styled labels; the inputs are visually hidden), and no Rare UI element.
      await expect(menu.getByRole('radio')).toHaveCount(3)
      await expect(menu.getByText('Match device', { exact: true })).toBeVisible()
      await expect(menu.locator('[class*="ui-rare-"]')).toHaveCount(0)
      await expect(menu.getByRole('link', { name: 'API tokens' })).toBeVisible()
      expect(answered(), 'the Rare UI file was asked for and answered with index.html').toBeGreaterThan(0)
    } finally {
      await context.close()
    }
  })
}
