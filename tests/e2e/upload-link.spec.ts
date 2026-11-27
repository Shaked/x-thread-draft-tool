// The one-time upload page (#418): open the link, pick a file, see its thumbnail, and the post has the image.
// Runs in the required `chromium` project against the local API and the built app. No sign-in in the browser.

import { expect, request as playwrightRequest, test, type APIRequestContext } from '@playwright/test'

const BASE = process.env.XT_BASE_URL ?? 'http://127.0.0.1:4173'

// A 1x1 PNG, so the test needs no fixture file.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==',
  'base64'
)

let api: APIRequestContext
let auth: { authorization: string }
let draftId = ''

test.beforeAll(async () => {
  api = await playwrightRequest.newContext({ baseURL: BASE })
  const signedIn = await api.post('/api/dev/token', { data: { login: `upload-link-${Date.now()}` } })
  expect(signedIn.ok()).toBeTruthy()
  auth = { authorization: `Bearer ${(await signedIn.json()).token}` }
  const created = await api.post('/api/drafts', { headers: auth, data: { title: 'Secret title', posts: [{ id: 'p1', text: 'Secret text', images: [], embeddedTweet: null }] } })
  expect(created.ok()).toBeTruthy()
  draftId = (await created.json()).draft.id as string
})

test.afterAll(async () => {
  await api.delete(`/api/drafts/${draftId}`, { headers: auth }).catch(() => {})
  await api.dispose()
})

test('the upload page takes a picked file, shows its thumbnail and shows no draft text', async ({ page }) => {
  const made = await api.post(`/api/drafts/${draftId}/posts/p1/upload-links`, { headers: auth, data: {} })
  expect(made.status()).toBe(201)
  const { url } = await made.json()
  expect(url).toContain('/upload#')

  await page.goto(BASE + new URL(url).pathname + new URL(url).hash)
  await expect(page.getByRole('heading', { name: 'Add up to 4 images to post 1' })).toBeVisible()
  await expect(page.getByText('Secret')).toHaveCount(0)

  await page.getByLabel('Choose images').setInputFiles({ name: 'dot.png', mimeType: 'image/png', buffer: PNG })
  await expect(page.getByRole('img', { name: 'Uploaded' })).toBeVisible()
  await expect(page.getByText('(3 left)')).toBeVisible()
  await expect(page.getByText('Secret')).toHaveCount(0)

  const read = await api.get(`/api/drafts/${draftId}`, { headers: auth })
  expect((await read.json()).draft.posts[0].images).toHaveLength(1)
})

test('a dead link shows the expired message', async ({ page }) => {
  await page.goto(BASE + '/upload#' + 'A'.repeat(43))
  await expect(page.getByRole('alert')).toContainText('expired or was already used')
})
