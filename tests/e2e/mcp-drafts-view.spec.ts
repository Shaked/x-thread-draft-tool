// Plan Task 5 (#182): the drafts list view in the hand-written host (tests/e2e/fixtures/mcp-host.html), under the host
// CSP of D4. A robot checks 0, 1 and 30 drafts, Hebrew titles, dark and light, the editor link, "View thread" (a
// tools/call for get_draft with the row id, then the thread), a get_draft error, and that no request leaves the page.
// It cannot check how Claude or ChatGPT draws the view (plan section 3).
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import { readUiResource, uiResourceUri } from '../../server/mcp/ui/index.js'

const HOST_CSP = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src 'none'; connect-src 'none'"

function id(n: number) {
  return `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
}

function drafts(count: number) {
  return Array.from({ length: count }, (_, i) => ({
    id: id(i + 1),
    title: i === 0 ? 'שלום עולם, טיוטה ראשונה' : i === 1 ? '' : `Draft ${i + 1}`,
    is_published: i % 3 === 0,
    // Two hours before the test runs, so the relative date reads "2 hours ago" on any clock.
    updated_at: new Date(Date.now() - 2 * 3600 * 1000).toISOString(),
    published_at: '2026-11-01T08:00:00Z',
    version: 1,
    post_count: 2,
    total_chars: 40,
    over_limit_count: i === 2 ? 1 : 0,
    image_count: i === 3 ? 2 : 0
  }))
}

// Loads the list view in the fixture host with the given structured result and host theme.
async function show(page: Page, structuredContent: unknown, theme = 'light') {
  await page.setContent(readFileSync(join(process.cwd(), 'tests/e2e/fixtures/mcp-host.html'), 'utf8'))
  const [view] = readUiResource(uiResourceUri('drafts')) as Array<{ text: string }>
  const srcdoc = view.text.replace('<head>', `<head><meta http-equiv="Content-Security-Policy" content="${HOST_CSP}">`)
  await page.evaluate(
    ({ srcdoc, fixture, theme }) => {
      const w = window as any
      w.__theme = theme
      w.__fixture = { content: [{ type: 'text', text: 'fixture' }], structuredContent: fixture, _meta: { 'x-thread/editorBase': 'https://app.example/draft/' } }
      document.getElementById('view')!.setAttribute('srcdoc', srcdoc)
    },
    { srcdoc, fixture: structuredContent, theme }
  )
  return page.frameLocator('#view')
}

test('0 drafts: "No drafts yet"; 1 draft: one row; 30 drafts: thirty rows', async ({ page }) => {
  const frame = await show(page, { drafts: [] })
  await expect(frame.getByText('No drafts yet')).toBeVisible()
  await expect(frame.locator('li')).toHaveCount(0)

  const one = await show(page, { drafts: drafts(1) })
  await expect(one.locator('li')).toHaveCount(1)

  const thirty = await show(page, { drafts: drafts(30) })
  await expect(thirty.locator('li')).toHaveCount(30)
})

test('Hebrew and empty titles: dir auto, Untitled, the counts, the over-limit chip and the dates', async ({ page }) => {
  const frame = await show(page, { drafts: drafts(4) })
  await expect(frame.getByText('שלום עולם, טיוטה ראשונה')).toBeVisible()
  await expect(frame.getByRole('heading', { name: 'Untitled' })).toBeVisible()
  await expect(frame.locator('h2').first()).toHaveAttribute('dir', 'auto')
  await expect(frame.getByText('1 over 280')).toBeVisible()
  await expect(frame.getByText('2 images')).toBeVisible()
  await expect(frame.getByText('Published Nov 1, 2026').first()).toBeVisible()
  await expect(frame.getByText('Updated 2 hours ago').first()).toBeVisible()
})

test('dark and light: the page follows the host theme', async ({ page }) => {
  const light = await show(page, { drafts: drafts(2) }, 'light')
  await expect(light.getByRole('heading', { name: 'Untitled' })).toBeVisible()
  const lightBackground = await light.locator('body').evaluate((el) => getComputedStyle(el).backgroundColor)
  expect(await light.locator('html').getAttribute('data-theme')).toBe('light')

  const dark = await show(page, { drafts: drafts(2) }, 'dark')
  await expect(dark.getByRole('heading', { name: 'Untitled' })).toBeVisible()
  const darkBackground = await dark.locator('body').evaluate((el) => getComputedStyle(el).backgroundColor)
  expect(await dark.locator('html').getAttribute('data-theme')).toBe('dark')
  expect(darkBackground).not.toBe(lightBackground)
})

test('the list fits 390 px: the main column is no wider than the screen', async ({ page }) => {
  const frame = await show(page, { drafts: drafts(3) })
  await expect(frame.getByText('Draft 3')).toBeVisible()
  const box = await frame.locator('main').boundingBox()
  expect(box?.width ?? 0).toBeLessThanOrEqual(390)
})

test('View thread calls get_draft for the row, shows the thread, and Back to list returns; no request leaves the page', async ({ page }) => {
  const requests: string[] = []
  page.on('request', (req) => requests.push(req.url()))
  const frame = await show(page, { drafts: drafts(2) })
  await expect(frame.getByRole('heading', { name: 'Untitled' })).toBeVisible()

  await page.evaluate(() => {
    ;(window as any).__callReply = {
      content: [{ type: 'text', text: 'fixture' }],
      structuredContent: { draft: { title: 'Opened thread', is_published: false, url: 'https://app.example/draft/x', posts: [{ text: 'Opened post <b>text</b>' }] } },
      _meta: { 'x-thread/outline': { posts: [{ chars: 12, over_limit: false }] }, 'x-thread/editorBase': 'https://app.example/draft/' }
    }
  })

  await frame.locator('li').first().getByRole('button', { name: 'View thread' }).click()
  await expect.poll(() => page.evaluate(() => (window as any).__calls.length)).toBe(1)
  expect(await page.evaluate(() => (window as any).__calls[0])).toEqual({ name: 'get_draft', arguments: { id: id(1) } })
  await expect(frame.getByRole('heading', { name: 'Opened thread' })).toBeVisible()
  await expect(frame.getByText('Opened post <b>text</b>')).toBeVisible()

  await frame.getByRole('button', { name: 'Back to list' }).click()
  await expect(frame.locator('li')).toHaveCount(2)

  expect(requests.filter((u) => !u.startsWith('about:') && !u.startsWith('data:'))).toEqual([])
})

test('Open in editor is a link the host opens; the page makes no request for it', async ({ page }) => {
  const requests: string[] = []
  page.on('request', (req) => requests.push(req.url()))
  const frame = await show(page, { drafts: drafts(1) })
  await expect(frame.getByText('שלום עולם, טיוטה ראשונה')).toBeVisible()
  await frame.locator('li').first().getByRole('button', { name: 'Open in editor' }).click()
  expect(requests.filter((u) => !u.startsWith('about:') && !u.startsWith('data:'))).toEqual([])
})

test('a get_draft error shows its text', async ({ page }) => {
  const frame = await show(page, { drafts: drafts(1) })
  await expect(frame.locator('li')).toHaveCount(1)
  await page.evaluate(() => {
    ;(window as any).__callReply = { content: [{ type: 'text', text: 'Draft not found' }], isError: true }
  })
  await frame.locator('li').first().getByRole('button', { name: 'View thread' }).click()
  await expect(frame.getByText('Draft not found')).toBeVisible()
})
