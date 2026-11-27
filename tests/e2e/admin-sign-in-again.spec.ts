// An old sign-in on an admin change opens the sign-in pop-up, and the change is saved by itself after signing in (#552).
// The first save of the flag is answered with the server's `sign_in_again` refusal (the real 7-day rule is checked in tests/api);
// the pop-up is a stub, so no GitHub is needed and no person is needed.

import { expect, request as playwrightRequest, test } from '@playwright/test'

const BASE = process.env.XT_BASE_URL ?? 'http://127.0.0.1:4173'
const ORIGIN = new URL(BASE).origin
const APP_ORIGIN = ORIGIN === 'http://127.0.0.1:4173' ? 'http://127.0.0.1:8787' : ORIGIN

test('saving a feature flag with an old sign-in opens the pop-up, signs in, saves and shows a toast, with no raw error text', async ({ browser }) => {
  const api = await playwrightRequest.newContext({ baseURL: BASE })
  const session = await api.post('/api/dev/session', { data: { login: `sign-in-again-${Date.now()}`, admin: true } })
  const cookie = session.headersArray().find((h) => h.name.toLowerCase() === 'set-cookie')?.value.match(/xt_session=([^;]+)/)?.[1]
  expect(cookie).toBeTruthy()
  await api.dispose()

  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, serviceWorkers: 'block' })
  try {
    await context.addCookies([{ name: 'xt_session', value: cookie!, url: BASE }])
    let posts = 0
    await context.route(`${ORIGIN}/api/admin/flags`, async (route) => {
      if (route.request().method() !== 'POST') return route.continue()
      posts += 1
      if (posts === 1) {
        return route.fulfill({
          status: 403,
          json: { error: 'Sign in again: admin changes on the web need a sign-in from the last 7 days.', code: 'sign_in_again' }
        })
      }
      const response = await route.fetch({ headers: { ...route.request().headers(), origin: APP_ORIGIN }, maxRedirects: 0 })
      return route.fulfill({ response })
    })
    const page = await context.newPage()
    // The pop-up is a stub that closes itself after the click, as the real one does after the GitHub sign-in.
    await page.addInitScript(() => {
      window.open = () => {
        const popup = { closed: false }
        setTimeout(() => { popup.closed = true }, 100)
        return popup as unknown as Window
      }
    })
    await page.goto(`${BASE}/admin/flags`)
    // Rare UI is the default (#406), so the change that saves is the admin's off switch: the old look.
    await page.getByText('Purple (only you)', { exact: true }).click()
    const dialog = page.getByRole('dialog', { name: 'Sign in again to save' })
    await expect(dialog).toBeVisible()
    await expect(page.locator('body')).not.toContainText('Could not save the flag')
    await dialog.getByRole('button', { name: 'Sign in with GitHub' }).click()
    await expect(page.getByText('Flag saved.')).toBeVisible()
    await expect(dialog).toHaveCount(0)
    await expect(page.locator('body')).not.toContainText('Sign in again: admin changes')
    expect(posts).toBe(2)
  } finally {
    await context.close()
  }
})
