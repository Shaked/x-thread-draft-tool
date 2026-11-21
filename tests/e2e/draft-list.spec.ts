// The draft list on the design system (plan task T6, #322): a row opens with Enter, the tabs work with the arrow
// keys, and the empty Drafts tab offers the first draft instead of the header button.
import { expect, test, type APIRequestContext, type Browser } from '@playwright/test'

const BASE = process.env.XT_BASE_URL ?? 'http://localhost:4173'
const ORIGIN = new URL(BASE).origin

async function devToken(request: APIRequestContext, login: string): Promise<string> {
  const res = await request.post(`${BASE}/api/dev/token`, { data: { login } })
  expect(res.ok()).toBeTruthy()
  return (await res.json()).token as string
}

// A browser context whose /api calls carry this user's bearer token.
async function signedInContext(browser: Browser, request: APIRequestContext) {
  const token = await devToken(request, `draft-list-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  const context = await browser.newContext({ serviceWorkers: 'block' })
  await context.route(`${ORIGIN}/api/**`, (route) =>
    route.continue({ headers: { ...route.request().headers(), authorization: `Bearer ${token}` } })
  )
  return { context, token }
}

test('a row opens its draft with Enter', async ({ browser, request }) => {
  const { context, token } = await signedInContext(browser, request)
  try {
    const res = await request.post(`${BASE}/api/drafts`, {
      data: { title: 'Keyboard thread', posts: [{ id: 'k1', text: 'x', images: [], embeddedTweet: null }] },
      headers: { authorization: `Bearer ${token}` }
    })
    expect(res.ok()).toBeTruthy()
    const id = (await res.json()).draft.id as string

    const page = await context.newPage()
    await page.goto(`${BASE}/`)
    const row = page.getByRole('link', { name: 'Keyboard thread' })
    await row.focus()
    await page.keyboard.press('Enter')
    await expect(page).toHaveURL(new RegExp(`/draft/${id}$`))
  } finally {
    await context.close()
  }
})

test('the arrow keys move between the tabs, and the empty Drafts tab offers a first draft', async ({ browser, request }) => {
  const { context } = await signedInContext(browser, request)
  try {
    const page = await context.newPage()
    await page.goto(`${BASE}/`)
    await expect(page.getByRole('button', { name: 'Create your first draft' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'New draft' })).toHaveCount(0)

    const drafts = page.getByRole('tab', { name: 'Drafts (0)' })
    await drafts.focus()
    await page.keyboard.press('ArrowRight')
    await expect(page.getByRole('tab', { name: 'Published (0)' })).toHaveAttribute('aria-selected', 'true')
    await expect(page.getByText('No published threads yet.')).toBeVisible()
  } finally {
    await context.close()
  }
})
