import { expect, test } from '@playwright/test'
import { renderHtml, type Payload } from '../../supabase/functions/share/render.ts'

function payload(overrides: Partial<Payload> = {}): Payload {
  return {
    title: 'My X Thread',
    posts: [
      { text: 'First post in the thread' },
      { text: 'Second post in the thread' }
    ],
    author_name: 'Jane Doe',
    author_handle: 'janedoe',
    author_avatar: 'https://placehold.co/80x80/png',
    created_at: '2026-04-26T06:34:00Z',
    ...overrides
  }
}

async function loadThread(page: import('@playwright/test').Page, p: Payload) {
  const html = renderHtml(p)
  await page.setContent(html, { waitUntil: 'load' })
}

test.describe('X-thread rendered page', () => {
  test('renders the sticky header and post title', async ({ page }) => {
    await loadThread(page, payload())
    await expect(page.locator('.x-header-title')).toHaveText('Post')
    await expect(page).toHaveTitle('My X Thread')
  })

  test('renders one article per post with author header', async ({ page }) => {
    await loadThread(page, payload())
    const posts = page.locator('article.x-post')
    await expect(posts).toHaveCount(2)

    const firstHead = posts.first().locator('.x-post-head')
    await expect(firstHead).toContainText('Jane Doe')
    await expect(firstHead).toContainText('@janedoe')
    await expect(firstHead).toContainText('26/04/2026')
  })

  test('shows the verified badge on every post', async ({ page }) => {
    await loadThread(page, payload())
    await expect(page.locator('svg.x-verified')).toHaveCount(2)
  })

  test('draws a thread connector line between posts but not after the last', async ({ page }) => {
    await loadThread(page, payload())
    await expect(page.locator('.x-thread-line')).toHaveCount(1)
    await expect(page.locator('article.x-post.x-post-last')).toHaveCount(1)
  })

  test('shows action bar buttons on every post', async ({ page }) => {
    await loadThread(page, payload())
    const actions = page.locator('.x-actions').first()
    await expect(actions).toContainText('Reply')
    await expect(actions).toContainText('Repost')
    await expect(actions).toContainText('Like')
    await expect(actions).toContainText('Views')
  })

  test('renders RTL posts with dir="rtl"', async ({ page }) => {
    await loadThread(
      page,
      payload({
        posts: [{ text: 'שלום עולם' }, { text: 'hello' }]
      })
    )
    const articles = page.locator('article.x-post')
    await expect(articles.nth(0)).toHaveAttribute('dir', 'rtl')
    await expect(articles.nth(1)).toHaveAttribute('dir', 'ltr')
  })

  test('renders an avatar fallback initial when no avatar URL is present', async ({ page }) => {
    await loadThread(
      page,
      payload({ author_avatar: null, posts: [{ text: 'just text' }] })
    )
    const fallback = page.locator('.x-avatar-fallback').first()
    await expect(fallback).toBeVisible()
    await expect(fallback).toHaveText('J')
  })

  test('renders an image grid with the right layout class for each count', async ({ page }) => {
    const cases: Array<[number, string]> = [
      [1, 'x-media-one'],
      [2, 'x-media-two'],
      [3, 'x-media-three'],
      [4, 'x-media-four']
    ]

    for (const [count, klass] of cases) {
      const images = Array.from({ length: count }, (_, i) => `https://placehold.co/600x400?text=${i + 1}`)
      await loadThread(page, payload({ posts: [{ text: 'has images', images }] }))
      await expect(page.locator(`.x-media.${klass}`)).toHaveCount(1)
      await expect(page.locator('.x-media .x-media-item img')).toHaveCount(count)
    }
  })

  test('renders embed blockquote and includes Twitter widgets script', async ({ page }) => {
    await loadThread(
      page,
      payload({
        posts: [
          { text: 'see this', embeddedTweet: 'https://twitter.com/jack/status/20' }
        ]
      })
    )
    await expect(page.locator('blockquote.twitter-tweet')).toHaveCount(1)
    const widgetSrc = await page
      .locator('script[src*="platform.twitter.com/widgets.js"]')
      .count()
    expect(widgetSrc).toBe(1)
  })

  test('falls back to a plain link when an embed URL has no status id', async ({ page }) => {
    await loadThread(
      page,
      payload({
        posts: [{ text: 'see this', embeddedTweet: 'https://example.com/no-status' }]
      })
    )
    await expect(page.locator('.x-embed-fallback')).toHaveCount(1)
    await expect(page.locator('blockquote.twitter-tweet')).toHaveCount(0)
  })

  test('linkifies URLs inside post text', async ({ page }) => {
    await loadThread(
      page,
      payload({
        posts: [{ text: 'visit https://example.com today' }]
      })
    )
    const link = page.locator('.x-text a.x-link')
    await expect(link).toHaveAttribute('href', 'https://example.com')
    await expect(link).toHaveAttribute('target', '_blank')
    await expect(link).toHaveAttribute('rel', 'noopener noreferrer')
  })

  test('escapes injected HTML in post text', async ({ page }) => {
    await loadThread(
      page,
      payload({ posts: [{ text: 'before <img src=x onerror="window.__pwned=1"> after' }] })
    )
    await expect(page.locator('.x-text img')).toHaveCount(0)
    const pwned = await page.evaluate(() => (window as unknown as { __pwned?: boolean }).__pwned)
    expect(pwned).toBeUndefined()
  })

  test('escapes injected HTML in author name and title', async ({ page }) => {
    await loadThread(
      page,
      payload({
        title: '<script>window.__pwned=1</script>',
        author_name: '"><img src=x onerror="window.__pwned=2">'
      })
    )
    const pwned = await page.evaluate(() => (window as unknown as { __pwned?: number }).__pwned)
    expect(pwned).toBeUndefined()
  })
})
