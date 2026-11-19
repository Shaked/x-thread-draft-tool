// The editor tells a signed-out user that their text is still there (#164, follow-up F4).
// Runs in the required `chromium` project: playwright.config.ts starts the local API and the built app.
// The session ends for real: the editor's API token is revoked through the API, then the user types.

import { expect, request as playwrightRequest, test, type APIRequestContext, type Browser, type Page } from '@playwright/test'

const BASE = process.env.XT_BASE_URL ?? 'http://127.0.0.1:4173'
const ORIGIN = new URL(BASE).origin
const PHONE = { width: 390, height: 844 }
const NOTE = 'You are signed out. Your text is still here: copy it, then sign in again.'

let api: APIRequestContext
let editorToken = ''
let editorTokenId = ''
let draftId = ''

test.beforeAll(async () => {
  api = await playwrightRequest.newContext({ baseURL: BASE })
  const login = `signed-out-${Date.now()}`
  const signedIn = await api.post('/api/dev/token', { data: { login } })
  expect(signedIn.ok()).toBeTruthy()
  editorToken = (await signedIn.json()).token as string

  // The id of that token, for the revoke. Its label is the dev route's name for this login.
  const listed = await api.get('/api/tokens', { headers: { authorization: `Bearer ${editorToken}` } })
  expect(listed.ok()).toBeTruthy()
  const own = ((await listed.json()).tokens as { id: string; name: string }[]).find((t) => t.name === `dev ${login}`)
  expect(own).toBeDefined()
  editorTokenId = own!.id

  const created = await api.post('/api/drafts', {
    headers: { authorization: `Bearer ${editorToken}` },
    data: { title: 'Signed out check', posts: [{ id: 'p1', text: 'טקסט שנשאר במסך גם אחרי התנתקות.', images: [], embeddedTweet: null }] }
  })
  expect(created.ok()).toBeTruthy()
  draftId = (await created.json()).draft.id as string
})

test.afterAll(async () => {
  await api.dispose()
})

async function openEditor(browser: Browser, theme: 'light' | 'dark') {
  const context = await browser.newContext({ viewport: PHONE, deviceScaleFactor: 2, serviceWorkers: 'block' })
  const bearer = `Bearer ${editorToken}`
  await context.route(`${ORIGIN}/**`, (route) => {
    if (new URL(route.request().url()).pathname.startsWith('/api/')) {
      return route.continue({ headers: { ...route.request().headers(), authorization: bearer } })
    }
    return route.continue()
  })
  const page: Page = await context.newPage()
  await page.goto(`${BASE}/draft/${draftId}`)
  await page.locator('.draft-title-input').waitFor()
  await page.evaluate((t) => document.documentElement.setAttribute('data-theme', t), theme)
  return { context, page }
}

test('a signed-out editor says so and keeps the text, in light and dark, at 390 px', async ({ browser }, testInfo) => {
  const { context, page } = await openEditor(browser, 'light')

  // The session ends: revoke the editor's token. The next autosave is refused with 401.
  const revoked = await api.delete(`/api/tokens/${editorTokenId}`, { headers: { authorization: `Bearer ${editorToken}` } })
  expect(revoked.ok()).toBeTruthy()

  const title = page.locator('.draft-title-input')
  await title.click()
  await title.press('End')
  await title.pressSequentially(' edited')

  const alert = page.getByRole('alert')
  await expect(alert).toContainText(NOTE, { timeout: 5000 })
  await expect(page.locator('.sync-status')).toHaveText('Not saved')
  await expect(title).toHaveValue('Signed out check edited')

  // No horizontal page scroll at phone width.
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  expect(overflow).toBeLessThanOrEqual(0)

  const light = testInfo.outputPath('signed-out-390-light.png')
  await page.screenshot({ path: light, fullPage: true })
  await testInfo.attach('signed-out-390-light', { path: light, contentType: 'image/png' })

  await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'))
  const dark = testInfo.outputPath('signed-out-390-dark.png')
  await page.screenshot({ path: dark, fullPage: true })
  await testInfo.attach('signed-out-390-dark', { path: dark, contentType: 'image/png' })

  await context.close()
})
