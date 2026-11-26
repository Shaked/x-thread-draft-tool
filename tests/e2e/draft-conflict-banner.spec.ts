// A user edit that meets an AI app's edit to the same post shows the conflict banner and loses nothing (#474 part 2, #354).
// Two writers: the browser (the user, typing in the editor) and an API call (the AI app). Runs in the required `chromium`
// project: playwright.config.ts starts the local API and the built app.

import { expect, request as playwrightRequest, test, type APIRequestContext } from '@playwright/test'

const BASE = process.env.XT_BASE_URL ?? 'http://127.0.0.1:4173'
const ORIGIN = new URL(BASE).origin

let api: APIRequestContext
let token = ''
let bearer = ''

test.beforeAll(async () => {
  api = await playwrightRequest.newContext({ baseURL: BASE })
  const signedIn = await api.post('/api/dev/token', { data: { login: `conflict-banner-${Date.now()}` } })
  expect(signedIn.ok()).toBeTruthy()
  token = (await signedIn.json()).token as string
  bearer = `Bearer ${token}`
})

test.afterAll(async () => {
  await api.dispose()
})

type Post = { id: string; text: string; images: unknown[]; embeddedTweet: null }
const post = (id: string, text: string): Post => ({ id, text, images: [], embeddedTweet: null })

async function createDraft(title: string): Promise<string> {
  const created = await api.post('/api/drafts', {
    headers: { authorization: bearer },
    data: { title, posts: [post('c1', 'Post one'), post('c2', 'Post two')] }
  })
  expect(created.ok()).toBeTruthy()
  return (await created.json()).draft.id as string
}

async function storedPosts(id: string): Promise<string[]> {
  const read = await api.get(`/api/drafts/${id}`, { headers: { authorization: bearer } })
  return (await read.json()).draft.posts.map((p: Post) => p.text)
}

test('the AI app and the user change the same post: the banner shows, the AI text is stored, and my text is in the copy box', async ({
  browser
}) => {
  const id = await createDraft('Conflict banner check')

  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, serviceWorkers: 'block' })
  await context.route(`${ORIGIN}/**`, (route) => {
    if (new URL(route.request().url()).pathname.startsWith('/api/')) {
      return route.continue({ headers: { ...route.request().headers(), authorization: bearer } })
    }
    return route.continue()
  })
  const page = await context.newPage()
  await page.goto(`${BASE}/draft/${id}`)
  await page.getByLabel('Draft title').waitFor()
  const second = page.locator('textarea.post-textarea').nth(1)
  await expect(second).toHaveValue('Post two')

  // The AI app saves post 2 first. The editor's copy is now one version behind.
  const current = (await (await api.get(`/api/drafts/${id}`, { headers: { authorization: bearer } })).json()).draft
  const aiSaved = await api.patch(`/api/drafts/${id}`, {
    headers: { authorization: bearer },
    data: { posts: [current.posts[0], { ...current.posts[1], text: 'Post two, by the AI app' }] }
  })
  expect(aiSaved.ok()).toBeTruthy()

  // The user types in the same post before the editor has seen the AI change. The next autosave gets 412.
  await second.click()
  await second.pressSequentially(' and my words')

  const banner = page.getByRole('alert')
  await expect(banner).toContainText('This draft changed in another app while you were editing.', { timeout: 10000 })

  // Nothing was written over the AI text.
  expect(await storedPosts(id)).toEqual(['Post one', 'Post two, by the AI app'])

  // Show their changes: the AI text is in the editor, and my text is in the copy box.
  await page.getByRole('button', { name: 'Show their changes' }).click()
  await expect(second).toHaveValue('Post two, by the AI app')
  await expect(page.getByLabel('Your text')).toHaveValue(/Post two and my words/)
  await expect(banner).toHaveCount(0)

  expect(await storedPosts(id)).toEqual(['Post one', 'Post two, by the AI app'])
  await context.close()
})
