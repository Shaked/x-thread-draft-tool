// #371 (Task C2 of #273): the thread view, the share card and the drafts list in Hebrew, in the hand-written host
// (tests/e2e/fixtures/mcp-host.html) under the host CSP of D4. The host's locale decides the language; without a locale
// the main script of the draft text does; English stays the default. A robot checks the page language and direction, the
// labels, that post text keeps dir="auto" and is unchanged, and that no request leaves the page. It cannot check how
// Claude or ChatGPT draws the view.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import { readUiResource, uiResourceUri } from '../../server/mcp/ui/index.js'

const HOST_CSP = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src 'none'; connect-src 'none'"
const DRAFT = '11111111-2222-4333-8444-555555555555'
const TOKEN = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'
const HEBREW_POST = 'שלום עולם, זה שרשור על קפה'
const THREAD = {
  content: [{ type: 'text', text: 'fixture' }],
  structuredContent: { draft: { id: DRAFT, title: 'שרשור על קפה', posts: [{ text: HEBREW_POST }, { text: 'Second post' }] } }
}
const SHARE = {
  content: [{ type: 'text', text: 'fixture' }],
  structuredContent: {
    token: TOKEN,
    draft_id: DRAFT,
    expires_at: new Date(Date.now() + 3600 * 1000).toISOString(),
    one_time: true,
    preview_url: `https://app.example/x-thread-preview/${TOKEN}`,
    markdown_url: `https://app.example/api/share/${TOKEN}.md`
  }
}
const LIST = {
  content: [{ type: 'text', text: 'fixture' }],
  structuredContent: { drafts: [{ id: DRAFT, title: 'שרשור על קפה', post_count: 2, total_chars: 40, over_limit_count: 0, image_count: 0, is_published: false, updated_at: '2026-11-19T10:00:00Z' }] }
}

// Loads one view in the fixture host. locale undefined means the host sends none; caps are the host capabilities.
async function show(page: Page, view: string, fixture: unknown, host: { locale?: string; caps?: object } = {}) {
  const requests: string[] = []
  page.on('request', (req) => requests.push(req.url()))
  await page.setContent(readFileSync(join(process.cwd(), 'tests/e2e/fixtures/mcp-host.html'), 'utf8'))
  const [resource] = readUiResource(uiResourceUri(view)) as Array<{ text: string }>
  const srcdoc = resource.text.replace('<head>', `<head><meta http-equiv="Content-Security-Policy" content="${HOST_CSP}">`)
  await page.evaluate(
    ({ srcdoc, fixture, host }) => {
      const w = window as any
      w.__theme = 'light'
      w.__locale = host.locale === undefined ? null : host.locale
      w.__caps = host.caps || {}
      w.__fixture = fixture
      document.getElementById('view')!.setAttribute('srcdoc', srcdoc)
    },
    { srcdoc, fixture, host }
  )
  return { frame: page.frameLocator('#view'), requests }
}

const attr = (page: Page, name: string) => page.frameLocator('#view').locator('html').getAttribute(name)

test('the thread view is Hebrew and right to left for a Hebrew host locale, and post text stays as written', async ({ page }) => {
  const { frame, requests } = await show(page, 'thread', THREAD, { locale: 'he-IL' })
  await expect(frame.getByText('תחילת השרשור')).toBeVisible()
  await expect(frame.getByText('סוף השרשור')).toBeVisible()
  await expect(frame.getByText('2 פוסטים')).toBeVisible()
  await expect(frame.getByText(HEBREW_POST, { exact: true })).toBeVisible()
  await expect(frame.getByText('Second post', { exact: true })).toBeVisible()
  expect(await attr(page, 'lang')).toBe('he')
  expect(await attr(page, 'dir')).toBe('rtl')
  await expect(frame.locator('article p[dir="auto"]')).toHaveCount(2)
  await expect(frame.getByText('Start of thread')).toHaveCount(0)
  expect(requests.filter((u) => !u.startsWith('about:') && !u.startsWith('data:'))).toEqual([])
})

test('without a host locale the thread view follows the draft text, and an English host locale keeps English', async ({ page }) => {
  const noLocale = await show(page, 'thread', THREAD)
  await expect(noLocale.frame.getByText('תחילת השרשור')).toBeVisible()
  expect(await attr(page, 'dir')).toBe('rtl')
  const english = await show(page, 'thread', THREAD, { locale: 'en-US' })
  await expect(english.frame.getByText('Start of thread')).toBeVisible()
  expect(await attr(page, 'lang')).toBe('en')
  expect(await attr(page, 'dir')).toBeNull()
  const plain = await show(page, 'thread', { ...THREAD, structuredContent: { draft: { id: DRAFT, title: 'Coffee', posts: [{ text: 'Coffee notes' }] } } })
  await expect(plain.frame.getByText('Start of thread')).toBeVisible()
})

test('the Create share link button and the share card it opens are in Hebrew', async ({ page }) => {
  const { frame } = await show(page, 'thread', THREAD, { locale: 'he', caps: { serverTools: {} } })
  const create = frame.getByRole('button', { name: 'צור קישור לשיתוף' })
  await expect(create).toBeVisible()
  await page.evaluate((reply) => {
    ;(window as any).__callReply = reply
  }, SHARE)
  await create.click()
  await expect(frame.getByText('קישור לתצוגה מקדימה')).toBeVisible()
  await expect(frame.getByText('קישור ל-Markdown')).toBeVisible()
  await expect(frame.getByRole('button', { name: 'עצור את הקישור הזה' })).toBeVisible()
  await expect(frame.getByText(/עובד פעם אחת/)).toBeVisible()
})

test('the share view is Hebrew and right to left for a Hebrew host locale, English by default', async ({ page }) => {
  const he = await show(page, 'share', SHARE, { locale: 'he', caps: { serverTools: {} } })
  await expect(he.frame.getByRole('heading', { name: 'קישור לשיתוף' })).toBeVisible()
  await expect(he.frame.getByText(/עובד פעם אחת/)).toBeVisible()
  await expect(he.frame.getByRole('button', { name: 'עצור את הקישור הזה' })).toBeVisible()
  expect(await attr(page, 'dir')).toBe('rtl')
  const fields = he.frame.locator('input')
  await expect(fields.first()).toHaveAttribute('dir', 'ltr')
  const en = await show(page, 'share', SHARE, { caps: { serverTools: {} } })
  await expect(en.frame.getByRole('heading', { name: 'Share link' })).toBeVisible()
  expect(await attr(page, 'lang')).toBe('en')
})

test('the drafts view is Hebrew for a Hebrew host locale', async ({ page }) => {
  const { frame } = await show(page, 'drafts', LIST, { locale: 'he' })
  await expect(frame.getByRole('heading', { name: 'טיוטות' })).toBeVisible()
  await expect(frame.getByRole('button', { name: 'הצג שרשור' })).toBeVisible()
  await expect(frame.getByText('שרשור על קפה')).toBeVisible()
  expect(await attr(page, 'dir')).toBe('rtl')
})
