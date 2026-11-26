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
let adminToken = ''

test.beforeAll(async () => {
  api = await playwrightRequest.newContext({ baseURL: BASE })
  login = `app-menu-${Date.now()}`
  const signedIn = await api.post('/api/dev/token', { data: { login } })
  expect(signedIn.ok()).toBeTruthy()
  token = (await signedIn.json()).token as string
  adminToken = (await (await api.post('/api/dev/token', { data: { login: `${login}-admin`, admin: true } })).json()).token as string
  const posts = Array.from({ length: 8 }, (_, i) => ({ id: `p${i + 1}`, text: `Post ${i + 1} for the menu check.`, images: [], embeddedTweet: null }))
  const created = await api.post('/api/drafts', { headers: { authorization: `Bearer ${token}` }, data: { title: 'Menu check', posts } })
  expect(created.ok()).toBeTruthy()
  draftId = (await created.json()).draft.id as string
})

test.afterAll(async () => {
  await api.dispose()
})

async function open(browser: Browser, size: { width: number; height: number }, options: { cookie?: string; reducedMotion?: 'reduce'; bearer?: string } = {}) {
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
        return route.continue({ headers: { ...route.request().headers(), authorization: `Bearer ${options.bearer ?? token}` } })
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
  { name: 'editor', path: `/draft/${draftId}`, ready: (p: Page) => p.getByLabel('Draft title') },
  { name: 'settings', path: '/settings/tokens', ready: (p: Page) => p.getByRole('heading', { name: 'API tokens', level: 1 }) },
  { name: 'connected apps', path: '/settings/apps', ready: (p: Page) => p.getByRole('heading', { name: 'Connected apps', level: 1 }) }
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
        await page.getByLabel('Draft title').waitFor()
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
          const spots = [document.querySelector('.ui-page-header'), document.querySelector('.app-bar')]
          return spots.map((el) => {
            const r = el!.getBoundingClientRect()
            const hit = document.elementFromPoint(r.left + r.width * 0.75, r.top + r.height / 2)
            return !!hit?.closest('.ui-dialog__scrim, #app-menu')
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
        await drawer(page).getByRole('link', { name: 'API tokens' }).click()
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
        const header = page.locator('header.ui-page-header')
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
    await page.getByLabel('Draft title').waitFor()
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

for (const size of SIZES) {
  test(`dark theme: the drawer opens and is separated from the page at ${size.name} px`, async ({ browser }) => {
    const { context, page } = await open(browser, size)
    try {
      await page.addInitScript(() => localStorage.setItem('xt-theme', 'dark'))
      await page.goto(`${BASE}/`)
      await page.getByRole('heading', { name: 'Your Threads' }).waitFor()
      await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
      await openMenu(page)
      const colours = await page.evaluate(() => ({
        page: getComputedStyle(document.body).backgroundColor,
        drawer: getComputedStyle(document.querySelector('#app-menu')!).backgroundColor,
        border: getComputedStyle(document.querySelector('#app-menu')!).borderInlineEndColor
      }))
      expect(colours.drawer).not.toBe(colours.page)
      expect(colours.border).not.toBe(colours.drawer)
    } finally {
      await context.close()
    }
  })
}

test('no menu button on the login page or the shared preview', async ({ browser }) => {
  const shared = await api.post(`/api/drafts/${draftId}/share-tokens`, { headers: { authorization: `Bearer ${token}` } })
  expect(shared.ok()).toBeTruthy()
  const shareToken = (await shared.json()).token as string
  const context = await browser.newContext({ viewport: SIZES[0], serviceWorkers: 'block' })
  const page = await context.newPage()
  try {
    await page.goto(`${BASE}/`)
    await expect(page.getByRole('button', { name: 'Sign in with GitHub' })).toBeVisible()
    await expect(hamburger(page)).toHaveCount(0)
    await page.goto(`${BASE}/x-thread-preview/${shareToken}`)
    await expect(page.frameLocator('iframe[title="Thread preview"]').locator('body')).toContainText('Post 1 for the menu check')
    await expect(hamburger(page)).toHaveCount(0)
  } finally {
    await context.close()
  }
})

for (const size of SIZES) {
  test(`the version line is inside the open drawer, above the bar, and opens /about at ${size.name} px`, async ({ browser }) => {
    const { context, page } = await open(browser, size)
    try {
      await page.goto(`${BASE}/`)
      await page.getByRole('heading', { name: 'Your Threads' }).waitFor()
      await openMenu(page)
      const line = drawer(page).getByRole('link', { name: /^Version / })
      await expect(line).toContainText('Version ')
      await expect(line).toContainText('deployed ')
      // Wait for the 0.2 s slide to end, then measure the line and hit-test its middle in the same frame.
      await expect.poll(() => drawer(page).evaluate((el) => el.getAnimations().length)).toBe(0)
      const measured = await line.evaluate((el) => {
        const r = el.getBoundingClientRect()
        const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)
        return { bottom: r.bottom, height: r.height, innerHeight: window.innerHeight, inDrawer: !!hit?.closest('#app-menu') }
      })
      expect(measured.height).toBeGreaterThan(0)
      expect(measured.bottom).toBeLessThanOrEqual(measured.innerHeight)
      // The middle of the line is the drawer, not the scrim or the bottom bar behind it.
      expect(measured.inDrawer).toBe(true)

      await line.click()
      await expect(page).toHaveURL(/\/about$/)
      await expect(drawer(page)).toHaveCount(0)
    } finally {
      await context.close()
    }
  })

  test(`/about loads for a signed-in user at ${size.name} px`, async ({ browser }) => {
    const { context, page } = await open(browser, size)
    try {
      await page.goto(`${BASE}/about`)
      await expect(page.getByRole('heading', { name: 'About', level: 1 })).toBeVisible()
      await expect(page.getByRole('heading', { name: 'This app' })).toBeVisible()
      await expect(page.getByRole('heading', { name: 'Server' })).toBeVisible()
      // Locally the server may answer with a null commit: the page still renders its details.
      await expect(page.getByRole('region', { name: 'Server' }).locator('.ui-description-list')).toContainText('Commit')
    } finally {
      await context.close()
    }
  })
}

test('API tokens page at 390 px: no horizontal overflow, a 44 px Create button, and a created token shows once in the one-time box', async ({ browser }) => {
  const dev = await playwrightRequest.newContext({ baseURL: BASE })
  const session = await dev.post('/api/dev/session', { data: { login } })
  const cookie = session.headersArray().find((h) => h.name.toLowerCase() === 'set-cookie')?.value.match(/xt_session=([^;]+)/)?.[1]
  await dev.dispose()
  expect(cookie).toBeTruthy()
  const { context, page } = await open(browser, SIZES[0], { cookie })
  try {
    await page.goto(`${BASE}/settings/tokens`)
    await expect(page.getByRole('heading', { name: 'API tokens', level: 1 })).toBeVisible()
    const scrollWidth = () => page.evaluate(() => document.documentElement.scrollWidth)
    expect(await scrollWidth()).toBeLessThanOrEqual(390)
    const create = page.getByRole('button', { name: 'Create token' })
    expect((await create.boundingBox())!.height).toBeGreaterThanOrEqual(44)

    await page.getByLabel('Token name').fill(`Menu check ${Date.now()}`)
    await create.click()
    await expect(page.getByRole('status').filter({ hasText: 'Copy this token now.' }).locator('code')).toBeVisible()
    await expect(page.getByText(/Copy this token now/)).toBeVisible()
    expect(await scrollWidth()).toBeLessThanOrEqual(390)
    expect((await page.getByRole('button', { name: 'Copy', exact: true }).boundingBox())!.height).toBeGreaterThanOrEqual(44)
  } finally {
    await context.close()
  }
})

// The changelog page (settings-menu.md Task 6): reached from the drawer, paged, readable in both themes.
const overflows = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)

for (const size of SIZES) {
  for (const theme of ['light', 'dark'] as const) {
    test(`changelog at ${size.name} px, ${theme}: opens from the drawer, Show older, no overflow, readable text`, async ({ browser }) => {
      const { context, page } = await open(browser, size, { bearer: adminToken })
      try {
        if (theme === 'dark') await page.addInitScript(() => localStorage.setItem('xt-theme', 'dark'))
        await page.goto(`${BASE}/`)
        await page.getByRole('heading', { name: 'Your Threads' }).waitFor()
        await openMenu(page)
        await drawer(page).getByRole('link', { name: 'Changelog', exact: true }).click()
        await expect(page).toHaveURL(/\/changelog$/)
        await expect(drawer(page)).toHaveCount(0)
        await expect(page.getByRole('heading', { name: 'Changelog', level: 1 })).toBeVisible()

        const entries = page.locator('article')
        await expect(entries.first()).toBeVisible()
        expect(await overflows(page)).toBe(false)

        // Readable: the entry text on its surface, the day and version text on the page, at least 4.5:1.
        const ratios = await page.evaluate(() => {
          const luminance = (css: string) => {
            const [r, g, b] = (css.match(/[\d.]+/g) ?? []).slice(0, 3).map((v) => {
              const c = Number(v) / 255
              return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
            })
            return 0.2126 * r + 0.7152 * g + 0.0722 * b
          }
          const ratio = (a: string, b: string) => {
            const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
            return (hi + 0.05) / (lo + 0.05)
          }
          const colour = (el: Element | null, prop: 'color' | 'backgroundColor') => getComputedStyle(el!)[prop]
          const entry = document.querySelector('article .ui-card')!
          const page = getComputedStyle(document.body).backgroundColor
          return {
            entry: ratio(colour(entry.querySelector('p') ?? entry, 'color'), colour(entry, 'backgroundColor')),
            day: ratio(colour(document.querySelector('.ui-section h2'), 'color'), page),
            version: ratio(colour(document.querySelector('.ui-page-header__subtitle'), 'color'), page)
          }
        })
        for (const [name, value] of Object.entries(ratios)) expect(value, name).toBeGreaterThanOrEqual(4.5)

        // Show older: the next entries are added, focus moves to the first new one, the page does not overflow.
        const before = await entries.count()
        // The page groups a day's entries by Area, so the first new entry is not always at DOM index `before`:
        // read its id from the answer and check that exact entry has focus.
        const olderAnswer = page.waitForResponse((res) => res.url().includes('/changelog?') && res.url().includes('before='))
        await page.getByRole('button', { name: 'Show older' }).click()
        const firstNew = (await (await olderAnswer).json()).entries[0].id
        await expect.poll(() => entries.count()).toBeGreaterThan(before)
        await expect(page.locator(`#changelog-${firstNew}`)).toBeFocused()
        expect(await overflows(page)).toBe(false)

        // The last entry is not covered by the bottom bar once the page is scrolled to its end.
        await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight))
        // The last entry that is shown: a day can fold older entries into a closed <details>, whose articles are in the DOM but hidden.
        const clear = await page.evaluate(() => {
          const shown = [...document.querySelectorAll('article')].filter((el) => el.checkVisibility())
          const r = shown[shown.length - 1].getBoundingClientRect()
          return !!document.elementFromPoint(r.left + r.width / 2, r.bottom - 6)?.closest('article')
        })
        expect(clear).toBe(true)
      } finally {
        await context.close()
      }
    })
  }
}

for (const size of SIZES) {
  test(`About links to the changelog ("See what changed") at ${size.name} px`, async ({ browser }) => {
    const { context, page } = await open(browser, size, { bearer: adminToken })
    try {
      await page.goto(`${BASE}/about`)
      await expect(page.getByRole('heading', { name: 'About', level: 1 })).toBeVisible()
      await page.getByRole('link', { name: 'See what changed' }).click()
      await expect(page).toHaveURL(/\/changelog$/)
      await expect(page.getByRole('heading', { name: 'Changelog', level: 1 })).toBeVisible()
    } finally {
      await context.close()
    }
  })
}

// The changelog is admin only (#368): a normal user sees no link to it, and /changelog is an unknown address for them.
for (const size of SIZES) {
  test(`normal user at ${size.name} px: no changelog link on About or in the drawer, and /changelog goes home`, async ({ browser }) => {
    const { context, page } = await open(browser, size)
    try {
      await page.goto(`${BASE}/about`)
      await expect(page.getByRole('heading', { name: 'About', level: 1 })).toBeVisible()
      await expect(page.getByRole('link', { name: 'See what changed' })).toHaveCount(0)
      await page.goto(`${BASE}/changelog`)
      await expect(page.getByRole('heading', { name: 'Your Threads' })).toBeVisible()
      expect(new URL(page.url()).pathname).toBe('/')
      await openMenu(page)
      await expect(drawer(page).getByRole('link', { name: 'Changelog', exact: true })).toHaveCount(0)
    } finally {
      await context.close()
    }
  })
}
