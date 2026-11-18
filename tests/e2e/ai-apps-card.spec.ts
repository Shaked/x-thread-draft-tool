// The "Use with AI apps" card on the API tokens page (settings-menu.md Task 7, U1). Runs in the required `chromium`
// project: playwright.config.ts starts the local API and the built app, so no person is needed.
// Signed in with a dev API token (bearer header on /api calls), as in app-menu.spec.ts.

import { expect, request as playwrightRequest, test } from '@playwright/test'

const BASE = process.env.XT_BASE_URL ?? 'http://127.0.0.1:4173'
const ORIGIN = new URL(BASE).origin
const SIZES = [
  { name: '390', width: 390, height: 844 },
  { name: '1280', width: 1280, height: 800 }
]

for (const size of SIZES) {
  test(`Use with AI apps card at ${size.name}px: Hebrew block is right-to-left, fits the screen, Copy writes it`, async ({ browser }) => {
    const api = await playwrightRequest.newContext({ baseURL: BASE })
    const signedIn = await api.post('/api/dev/token', { data: { login: `ai-apps-${size.name}-${Date.now()}` } })
    expect(signedIn.ok()).toBeTruthy()
    const token = (await signedIn.json()).token as string
    await api.dispose()

    const context = await browser.newContext({ viewport: { width: size.width, height: size.height }, serviceWorkers: 'block' })
    await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: ORIGIN })
    await context.route(`${ORIGIN}/**`, (route) => {
      if (new URL(route.request().url()).pathname.startsWith('/api/')) {
        return route.continue({ headers: { ...route.request().headers(), authorization: `Bearer ${token}` } })
      }
      return route.continue()
    })
    const page = await context.newPage()
    await page.goto(`${BASE}/settings/tokens`, { waitUntil: 'networkidle' })

    const card = page.locator('.ai-apps-card')
    await expect(card.getByRole('heading', { name: 'Use with AI apps' })).toBeVisible()

    const en = card.locator('blockquote[lang="en"]')
    const he = card.locator('blockquote[lang="he"]')
    await expect(en).toHaveAttribute('dir', 'auto')
    await expect(he).toHaveAttribute('dir', 'auto')
    await expect(he).toHaveCSS('direction', 'rtl')

    // No horizontal page scroll, and the Hebrew block sits inside the screen.
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
    expect(overflow).toBeLessThanOrEqual(0)
    const box = await he.boundingBox()
    expect(box).not.toBeNull()
    expect(box!.x).toBeGreaterThanOrEqual(0)
    expect(box!.x + box!.width).toBeLessThanOrEqual(size.width)

    await card.getByRole('button', { name: 'Copy Hebrew text' }).click()
    const copied = await page.evaluate(() => navigator.clipboard.readText())
    expect(copied).toBe((await he.textContent())?.trim())

    await context.close()
  })
}
