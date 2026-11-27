// The first paint of the look (#406, #483): the inline script in index.html sets data-skin before any app script runs.
// The app's own scripts are blocked here, so only that inline script can have set the look. Runs in the required `chromium` project.

import { expect, test, type Browser } from '@playwright/test'

const BASE = process.env.XT_BASE_URL ?? 'http://127.0.0.1:4173'

async function skinAtFirstPaint(browser: Browser, stored: Record<string, string>) {
  const context = await browser.newContext({ serviceWorkers: 'block' })
  try {
    await context.addInitScript((entries) => {
      for (const [key, value] of Object.entries(entries)) localStorage.setItem(key, value)
    }, stored)
    await context.route('**/assets/**/*.js', (route) => route.abort())
    const page = await context.newPage()
    await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' })
    return await page.evaluate(() => document.documentElement.dataset.skin)
  } finally {
    await context.close()
  }
}

test.describe('first paint of the look', () => {
  test('a signed-out visitor (nothing stored) sees the purple look before any app script runs', async ({ browser }) => {
    expect(await skinAtFirstPaint(browser, {})).toBe('default')
  })

  test('a device that last saw the admin with Rare UI chosen paints Rare UI', async ({ browser }) => {
    expect(await skinAtFirstPaint(browser, { 'xt-admin': '1', 'xt-skin': 'rare' })).toBe('rare')
  })

  test('a stored Rare UI choice on a device the admin never used still paints the purple look', async ({ browser }) => {
    expect(await skinAtFirstPaint(browser, { 'xt-skin': 'rare' })).toBe('default')
  })

  test('the admin with the look left on purple paints the purple look', async ({ browser }) => {
    expect(await skinAtFirstPaint(browser, { 'xt-admin': '1', 'xt-skin': 'default' })).toBe('default')
  })
})
