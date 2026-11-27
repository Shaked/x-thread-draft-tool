// The admin area works for the admin (#551). Runs in the required `chromium` project against the local API and the
// built app (playwright.config.ts); no person is needed. Unlike the UI audit, nothing here answers /api/admin/* with
// fixed data: the admin signs in with a real browser session and every page reads the real local API.
// For every entry of the admin menu, at 390 px and 1280 px: the page opens from the menu, the menu marks it, and its
// heading and one piece of real content show, with no error and no "Coming soon". When the data fails, each page says so.
// Budget: every dev admin session is one admin, and admin web reads are capped at 120 a minute (withinToolRate). One run
// of this file makes about 42 admin calls (checked), app-menu.spec.ts and load-failure.spec.ts about 20: keep it under the cap.

import { expect, request as playwrightRequest, test, type APIRequestContext, type Browser, type Page } from '@playwright/test'

const BASE = process.env.XT_BASE_URL ?? 'http://127.0.0.1:4173'
const ORIGIN = new URL(BASE).origin
const APP_ORIGIN = ORIGIN === 'http://127.0.0.1:4173' ? 'http://127.0.0.1:8787' : ORIGIN
const SIZES = [
  { name: '390', width: 390, height: 844 },
  { name: '1280', width: 1280, height: 800 }
]

let api: APIRequestContext
let adminCookie = ''
const login = `admin-area-${Date.now()}`
// Every dev admin session is the same user (the owner's GitHub id), and each one renames it: the users checks look for
// this normal user instead, whose login stays.
const userLogin = `${login}-user`
let userToken = ''
// A throwaway user this test suspends, so the audit log has a row this run wrote (admin suspends are capped at 30 an hour).
const auditLogin = `${login}-audit`

test.beforeAll(async () => {
  api = await playwrightRequest.newContext({ baseURL: BASE })
  const session = await api.post('/api/dev/session', { data: { login, admin: true } })
  adminCookie = session.headersArray().find((h) => h.name.toLowerCase() === 'set-cookie')?.value.match(/xt_session=([^;]+)/)?.[1] ?? ''
  expect(adminCookie).toBeTruthy()
  // One draft of the admin, so the statistics count something this test made. Through the browser session, not an API
  // token: every dev admin login is the same user, and its active tokens are capped (other specs make some).
  const draft = await api.post('/api/drafts', {
    headers: { cookie: `xt_session=${adminCookie}`, origin: APP_ORIGIN },
    data: { title: 'Admin area check', posts: [{ id: 'p1', text: 'One post.', images: [], embeddedTweet: null }] }
  })
  expect(draft.ok()).toBeTruthy()
  userToken = (await (await api.post('/api/dev/token', { data: { login: userLogin } })).json()).token as string
  expect(userToken).toBeTruthy()
  const audited = (await (await api.post('/api/dev/token', { data: { login: auditLogin } })).json()).user.id as string
  const suspended = await api.post(`/api/admin/users/${audited}/suspend`, {
    headers: { cookie: `xt_session=${adminCookie}`, origin: APP_ORIGIN, 'x-xt-admin': '1' },
    data: { confirm_login: auditLogin, reason: 'admin area e2e check' }
  })
  expect(suspended.ok(), await suspended.text()).toBeTruthy()
})

test.afterAll(async () => {
  await api.dispose()
})

async function openAsAdmin(browser: Browser, size: { width: number; height: number }) {
  const context = await browser.newContext({ viewport: size, serviceWorkers: 'block' })
  await context.addCookies([{ name: 'xt_session', value: adminCookie, url: BASE }])
  // Writes are checked against the app origin; reads go to the real API untouched.
  await context.route(`${ORIGIN}/api/**`, async (route) => {
    if (route.request().method() === 'GET') return route.continue()
    const response = await route.fetch({ headers: { ...route.request().headers(), origin: APP_ORIGIN }, maxRedirects: 0 })
    return route.fulfill({ response })
  })
  return { context, page: await context.newPage() }
}

const adminMenu = (page: Page) => page.getByRole('navigation', { name: 'Admin pages' })

// Every entry of the admin menu, with the path it opens and what real content looks like there.
const ENTRIES: { label: string; path: string; real: (page: Page) => Promise<void> }[] = [
  {
    label: 'Statistics',
    path: '/admin',
    real: async (page) => {
      await expect(page.getByRole('heading', { name: 'Statistics', level: 2 })).toBeVisible()
      await expect(page.getByText('Active users, 24 hours')).toBeVisible()
      // At least this test's draft is counted.
      const drafts = page.locator('dt', { hasText: /^Drafts$/ }).locator('xpath=following-sibling::dd[1]')
      await expect(drafts).toHaveText(/^[1-9]\d*$/)
      await expect(page.getByRole('table', { name: 'Signups in the last 30 days' })).toBeAttached()
    }
  },
  {
    label: 'Metrics',
    path: '/admin/metrics',
    real: async (page) => {
      await expect(page.getByRole('heading', { name: 'All routes', level: 2 })).toBeVisible()
      await expect(page.getByRole('heading', { name: 'By route', level: 2 })).toBeVisible()
      // This test's own requests are counted: at least one route row.
      await expect(page.getByRole('table', { name: 'Requests and times by route' }).getByRole('row').nth(1)).toBeAttached()
      // The Delivery and CI section loads after the numbers above: wait for it, so its error would be seen too.
      await expect(page.getByRole('table', { name: 'Delivery events, newest first' })).toBeAttached()
    }
  },
  {
    label: 'Feature flags',
    path: '/admin/flags',
    real: async (page) => {
      await expect(page.getByRole('heading', { name: 'Look', level: 2 })).toBeVisible()
      // The account's look is read: exactly one of the two is chosen (other specs may set either).
      await expect(page.getByRole('radio', { name: 'Purple (everyone)' }).or(page.getByRole('radio', { name: 'Rare UI (only you)' })).and(page.locator(':checked'))).toHaveCount(1)
      await expect(page.getByRole('heading', { name: 'Components', level: 2 })).toBeVisible()
    }
  },
  {
    label: 'Changelog',
    path: '/admin/changelog',
    real: async (page) => {
      await expect(page.getByRole('heading', { name: 'Changelog', level: 2 })).toBeVisible()
      await expect(page.locator('article').first()).toBeVisible()
    }
  },
  {
    label: 'Users',
    path: '/admin/users',
    real: async (page) => {
      // The list pages 50 users at a time and other tests add users: search finds this test's user on any page.
      await expect(page.getByRole('table', { name: 'Users' }).getByRole('row').nth(1)).toBeAttached()
      await findUser(page)
    }
  },
  {
    label: 'Audit log',
    path: '/admin/audit',
    real: async (page) => {
      await expect(page.getByRole('heading', { name: 'Audit log', level: 2 })).toBeVisible()
      await expect(page.getByRole('combobox', { name: 'Action' })).toBeVisible()
      // The row this run wrote: the suspend of its throwaway user.
      await expect(page.getByRole('row').filter({ hasText: auditLogin }).filter({ hasText: 'suspend_user' }).first()).toBeAttached()
    }
  }
]

// Searches the users list for this test's normal user and waits for its row.
async function findUser(page: Page) {
  const search = page.getByRole('search', { name: 'Find users' })
  await search.getByLabel('Login starts with').fill(userLogin)
  await search.getByRole('button', { name: 'Search' }).click()
  await expect(page.getByRole('table', { name: 'Users' }).getByRole('link', { name: userLogin, exact: true })).toBeVisible()
}

// No error state and no placeholder on the open page.
async function noErrorOrPlaceholder(page: Page) {
  await expect(page.getByText(/Could not load/)).toHaveCount(0)
  // The placeholder of an unbuilt page is exactly "Coming soon."; the real changelog may mention the words in its entries.
  await expect(page.getByText('Coming soon.', { exact: true })).toHaveCount(0)
  await expect(page.getByText('This page could not load')).toHaveCount(0)
  await expect(page.getByRole('alert')).toHaveCount(0)
}

for (const size of SIZES) {
  test(`admin at ${size.name} px: every admin menu entry opens a working page with real data`, async ({ browser }) => {
    const { context, page } = await openAsAdmin(browser, size)
    try {
      // From the app: the one Admin link of the app menu opens the admin area.
      await page.goto(`${BASE}/`)
      await expect(page.getByRole('heading', { name: 'Your Threads', level: 1 })).toBeVisible()
      await page.getByRole('button', { name: 'Menu', exact: true }).click()
      await page.locator('#app-menu').getByRole('link', { name: 'Admin', exact: true }).click()
      await expect(page.getByRole('heading', { name: 'Admin', level: 1 })).toBeVisible()
      expect(await adminMenu(page).getByRole('link').allInnerTexts()).toEqual(ENTRIES.map((entry) => entry.label))

      for (const entry of ENTRIES) {
        await adminMenu(page).getByRole('link', { name: entry.label, exact: true }).click()
        await expect(page).toHaveURL(new RegExp(`${entry.path}$`))
        await expect(page.getByRole('heading', { name: 'Admin', level: 1 })).toBeVisible()
        await expect(adminMenu(page).locator('[aria-current="page"]')).toHaveText(entry.label)
        await entry.real(page)
        await noErrorOrPlaceholder(page)
        const widths = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, inner: window.innerWidth }))
        expect(widths.scroll, `${entry.label}: horizontal scroll`).toBeLessThanOrEqual(widths.inner)
      }

      // A user's page opens from the users table and shows that user.
      await adminMenu(page).getByRole('link', { name: 'Users', exact: true }).click()
      await findUser(page)
      await page.getByRole('table', { name: 'Users' }).getByRole('link', { name: userLogin, exact: true }).click()
      await expect(page).toHaveURL(/\/admin\/users\/[^/]+$/)
      await expect(page.getByRole('heading', { name: userLogin, level: 2 })).toBeVisible()
      await expect(page.getByRole('heading', { name: 'API tokens', level: 2 })).toBeVisible()
      await noErrorOrPlaceholder(page)
    } finally {
      await context.close()
    }
  })

  test(`admin at ${size.name} px: when the data fails, every admin page says so and offers Try again`, async ({ browser }) => {
    const { context, page } = await openAsAdmin(browser, size)
    try {
      // Only the page data fails; the session (/api/auth/me) is left alone. The app's own flags read at start tolerates a failure.
      await context.route(/\/api\/(admin\/(stats|metrics|flags|users|audit)|changelog)(\/|\?|$)/, (route) => route.fulfill({ status: 500, json: { error: 'Server error' } }))
      const failing = [
        ['/admin', 'Could not load the statistics.'],
        ['/admin/metrics', 'Could not load the metrics.'],
        ['/admin/flags', 'Could not load the feature flags.'],
        ['/admin/changelog', 'Could not load the changelog.'],
        ['/admin/users', 'Could not load the users.'],
        ['/admin/audit', 'Could not load the audit log.']
      ]
      for (const [path, message] of failing) {
        await page.goto(`${BASE}${path}`)
        await expect(adminMenu(page)).toBeVisible()
        await expect(page.getByRole('alert').filter({ hasText: message })).toBeVisible()
        await expect(page.getByRole('alert').filter({ hasText: message }).getByRole('button', { name: 'Try again' })).toBeVisible()
      }
    } finally {
      await context.close()
    }
  })
}

// A normal user never sees the admin area: /admin is an unknown path for them and goes to the start page.
test('normal user: /admin and every admin page go to the start page', async ({ browser }) => {
  const token = userToken
  const context = await browser.newContext({ viewport: SIZES[1], serviceWorkers: 'block' })
  await context.route(`${ORIGIN}/api/**`, (route) => route.continue({ headers: { ...route.request().headers(), authorization: `Bearer ${token}` } }))
  const page = await context.newPage()
  try {
    for (const entry of ENTRIES) {
      await page.goto(`${BASE}${entry.path}`)
      await expect(page.getByRole('heading', { name: 'Your Threads', level: 1 })).toBeVisible()
      expect(new URL(page.url()).pathname, entry.path).toBe('/')
      await expect(adminMenu(page)).toHaveCount(0)
    }
  } finally {
    await context.close()
  }
})
