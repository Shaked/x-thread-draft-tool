// The thread editor's post controls (plan Task 9, docs/plans/ui-design-system.md): keyboard reorder, add, insert
// between posts, remove, copy, the counter's over-limit state and Hebrew direction. Runs in the required `chromium`
// project: playwright.config.ts starts the local API and the built app. Signed in with a dev API token.

import { expect, request as playwrightRequest, test, type APIRequestContext, type Browser, type BrowserContext, type Page } from '@playwright/test'

const BASE = process.env.XT_BASE_URL ?? 'http://127.0.0.1:4173'
const ORIGIN = new URL(BASE).origin
const DESKTOP = { width: 1280, height: 800 }

let api: APIRequestContext
let token = ''

test.beforeAll(async () => {
  api = await playwrightRequest.newContext({ baseURL: BASE })
  const signedIn = await api.post('/api/dev/token', { data: { login: `editor-posts-${Date.now()}` } })
  expect(signedIn.ok()).toBeTruthy()
  token = (await signedIn.json()).token as string
})

test.afterAll(async () => {
  await api.dispose()
})

// Each test gets its own draft with three posts (one Hebrew), so the tests can run in parallel and edit freely.
async function openEditor(browser: Browser) {
  const created = await api.post('/api/drafts', {
    headers: { authorization: `Bearer ${token}` },
    data: {
      title: 'Editor posts check',
      posts: [
        { id: 'q1', text: 'First post', images: [], embeddedTweet: null },
        { id: 'q2', text: 'Second post', images: [], embeddedTweet: null },
        { id: 'q3', text: 'שלישי בעברית', images: [], embeddedTweet: null }
      ]
    }
  })
  expect(created.ok()).toBeTruthy()
  const id = (await created.json()).draft.id as string
  const context: BrowserContext = await browser.newContext({ viewport: DESKTOP, serviceWorkers: 'block', permissions: ['clipboard-read', 'clipboard-write'] })
  const bearer = `Bearer ${token}`
  await context.route(`${ORIGIN}/**`, (route) => {
    if (new URL(route.request().url()).pathname.startsWith('/api/')) {
      return route.continue({ headers: { ...route.request().headers(), authorization: bearer } })
    }
    return route.continue()
  })
  const page: Page = await context.newPage()
  await page.goto(`${BASE}/draft/${id}`)
  await page.getByLabel('Draft title').waitFor()
  return { context, page }
}

// The text of each post, in order, read from the post textareas.
async function postTexts(page: Page): Promise<string[]> {
  return page.locator('textarea.post-textarea').evaluateAll((els) => els.map((el) => (el as HTMLTextAreaElement).value))
}

test('the posts are numbered inside a bidi isolate and the composer has its title', async ({ browser }) => {
  const { context, page } = await openEditor(browser)
  try {
    await expect(page.getByRole('heading', { name: 'Compose thread', level: 2 })).toBeVisible()
    await expect(page.locator('bdi', { hasText: /^1\/3$/ })).toBeVisible()
    await expect(page.locator('bdi', { hasText: /^3\/3$/ })).toBeVisible()
    // dnd-kit's keyboard instructions stay linked to the drag handle (the handle's own describedby must not replace them).
    await expect(page.getByRole('button', { name: 'Drag to reorder post 1' })).toHaveAttribute('aria-describedby', /.+/)
  } finally {
    await context.close()
  }
})

test('keyboard reorder: Space picks a post up, the arrow key moves it, Space drops it', async ({ browser }) => {
  const { context, page } = await openEditor(browser)
  try {
    expect(await postTexts(page)).toEqual(['First post', 'Second post', 'שלישי בעברית'])
    await page.getByRole('button', { name: 'Drag to reorder post 1' }).focus()
    await page.keyboard.press('Space')
    // dnd-kit announces each step in a live region. Wait for the pick-up before the arrow key, and for the move before the drop.
    await expect(page.locator('[aria-live]').filter({ hasText: 'moved over droppable area q1' })).toHaveCount(1)
    await page.keyboard.press('ArrowDown')
    await expect(page.locator('[aria-live]').filter({ hasText: 'moved over droppable area q2' })).toHaveCount(1)
    await page.keyboard.press('Space')
    await expect.poll(() => postTexts(page)).toEqual(['Second post', 'First post', 'שלישי בעברית'])
  } finally {
    await context.close()
  }
})

test('insert, add and remove change the number of posts; the last post cannot be removed', async ({ browser }) => {
  const { context, page } = await openEditor(browser)
  try {
    await page.getByRole('button', { name: 'Insert post here' }).nth(1).click()
    await expect(page.locator('textarea.post-textarea')).toHaveCount(4)
    expect((await postTexts(page))[1]).toBe('')

    await page.getByRole('button', { name: 'Add post' }).click()
    await expect(page.locator('textarea.post-textarea')).toHaveCount(5)

    await page.getByRole('button', { name: 'Remove post 2' }).click()
    await expect(page.locator('textarea.post-textarea')).toHaveCount(4)

    // Remove is hidden when only one post is left.
    for (let i = 0; i < 3; i += 1) {
      await page.getByRole('button', { name: /^Remove post/ }).first().click()
    }
    await expect(page.locator('textarea.post-textarea')).toHaveCount(1)
    await expect(page.getByRole('button', { name: /^Remove post/ })).toHaveCount(0)
  } finally {
    await context.close()
  }
})

test('Copy writes the post text to the clipboard and says Copied for a moment', async ({ browser }) => {
  const { context, page } = await openEditor(browser)
  try {
    const post = page.locator('.post-box').first()
    await post.getByRole('button', { name: 'Copy', exact: true }).click()
    await expect(post.getByRole('button', { name: '✓ Copied' })).toBeVisible()
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('First post')
  } finally {
    await context.close()
  }
})

test('the counter shows the over-limit state, and Hebrew text is right to left', async ({ browser }) => {
  const { context, page } = await openEditor(browser)
  try {
    const first = page.getByLabel('Post 1 text')
    await first.fill('a'.repeat(281))
    await expect(page.locator('.char-counter').first()).toHaveText('281/280 (1 over)')
    await expect(page.locator('.char-counter.over-limit').first()).toBeVisible()

    await expect(page.getByLabel('Post 3 text')).toHaveAttribute('dir', 'rtl')
    await expect(page.getByLabel('Post 1 text')).toHaveAttribute('dir', 'ltr')
  } finally {
    await context.close()
  }
})
