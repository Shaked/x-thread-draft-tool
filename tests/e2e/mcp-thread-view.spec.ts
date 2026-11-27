// Plan Task 3 (#173): the X-style thread view in the hand-written host (tests/e2e/fixtures/mcp-host.html), under the
// host CSP of D4. A robot checks the layout and the rules: Hebrew and English direction, dark and light themes, no
// horizontal scroll at 390 px, markup as text, and an image only from the one image origin. It cannot check how Claude
// or ChatGPT draws the view (plan section 3). Screenshots go to test-results/screens/390 for a person to look at.
import { mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import { readUiResource, uiResourceUri } from '../../server/mcp/ui/index.js'

const HOST_CSP =
  "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: https://store1.public.blob.vercel-storage.com; connect-src 'none'"
const BLOB = 'https://store1.public.blob.vercel-storage.com'
const XSS = '<img src=x onerror=alert(1)>'
const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64'
)

const FIXTURE = {
  content: [{ type: 'text', text: 'fixture' }],
  structuredContent: {
    draft: {
      title: 'Thread ' + XSS,
      is_published: true,
      posts: [
        { text: 'שלום, this is the first post of a thread that goes on for a while to check the wrapping of long lines', images: [{ url: `${BLOB}/drafts/u/1.png` }, { url: 'https://other.example/x.png' }] },
        { text: 'Hello from an English post, with a link https://example.com/page and ' + XSS },
        { text: 'a'.repeat(120) + ' ' + XSS, embeddedTweet: 'https://x.com/jack/status/20' }
      ]
    }
  },
  _meta: {
    'x-thread/outline': {
      posts: [
        { chars: 150, over_limit: false },
        { chars: 60, over_limit: false },
        { chars: 285, over_limit: true }
      ]
    },
    'x-thread/imageOrigin': BLOB
  }
}

// The host's answers: capabilities (serverTools lets the view call tools), the answer to a tools/call, and a hold.
type HostSetup = { caps?: object; reply?: unknown; hold?: boolean }

async function load(page: Page, fixture = FIXTURE, host: HostSetup = {}) {
  // The one image host of D4 answers with a tiny PNG, so no request leaves the test machine.
  await page.route(`${BLOB}/**`, (route) => route.fulfill({ contentType: 'image/png', body: TINY_PNG }))
  await page.setContent(readFileSync(join(process.cwd(), 'tests/e2e/fixtures/mcp-host.html'), 'utf8'))
  const [view] = readUiResource(uiResourceUri('thread')) as Array<{ text: string }>
  const srcdoc = view.text.replace('<head>', `<head><meta http-equiv="Content-Security-Policy" content="${HOST_CSP}">`)
  await page.evaluate(
    ({ srcdoc, fixture, host }) => {
      const w = window as any
      w.__caps = host.caps || {}
      w.__callReply = host.reply
      w.__holdCall = host.hold === true
      w.__fixture = fixture
      document.getElementById('view')!.setAttribute('srcdoc', srcdoc)
    },
    { srcdoc, fixture, host }
  )
  // The view has rendered when its first post card is there.
  await expect(page.frameLocator('#view').locator('article').first()).toBeVisible()
}

// Sends a host-context-changed (for example a theme change) to the view, as a host does.
async function setTheme(page: Page, theme: 'dark' | 'light') {
  await page.evaluate((theme) => {
    const frame = document.getElementById('view') as HTMLIFrameElement
    frame.contentWindow!.postMessage(
      { jsonrpc: '2.0', method: 'ui/notifications/host-context-changed', params: { theme } },
      '*'
    )
  }, theme)
}

// Sizes the frame to the content the view reported, so the screenshot shows the whole thread.
async function fitFrame(page: Page) {
  await expect.poll(() => page.evaluate(() => (window as any).__size?.height ?? 0)).toBeGreaterThan(0)
  await page.evaluate(() => {
    const frame = document.getElementById('view') as HTMLIFrameElement
    frame.style.height = (window as any).__size.height + 'px'
  })
}

test.use({ viewport: { width: 390, height: 900 }, deviceScaleFactor: 2 })

test('the thread shows X-style cards, the counter, markup as text, and no horizontal scroll at 390 px', async ({ page }) => {
  await load(page)
  const frame = page.frameLocator('#view')

  await expect(frame.locator('article')).toHaveCount(3)
  await expect(frame.locator('article footer small').first()).toHaveText('150/280')
  await expect(frame.locator('article footer strong')).toHaveText('285/280 · over by 5')
  await expect(frame.getByText(XSS).first()).toBeVisible()
  await expect(frame.locator('img')).toHaveCount(1)

  const fits = await frame.locator('html').evaluate((el) => el.scrollWidth <= el.clientWidth)
  expect(fits).toBe(true)
})

test('Hebrew posts run right to left and English posts left to right, in one thread', async ({ page }) => {
  await load(page)
  const frame = page.frameLocator('#view')
  const hebrew = frame.locator('article p[dir="auto"]').nth(0)
  const english = frame.locator('article p[dir="auto"]').nth(1)
  await expect(hebrew).toHaveAttribute('dir', 'auto')
  expect(await hebrew.evaluate((el) => getComputedStyle(el).direction)).toBe('rtl')
  expect(await english.evaluate((el) => getComputedStyle(el).direction)).toBe('ltr')
})

test('an image loads only from the image origin, with alt text; another host becomes a link button', async ({ page }) => {
  await load(page)
  const frame = page.frameLocator('#view')
  const image = frame.locator('article img')
  await expect(image).toHaveAttribute('src', `${BLOB}/drafts/u/1.png`)
  await expect(image).toHaveAttribute('alt', 'Image 1 of 2')
  await expect(frame.locator('article ol button', { hasText: 'https://other.example/x.png' })).toBeVisible()
  await expect(frame.locator('img[src*="other.example"]')).toHaveCount(0)
})

test('dark and light themes follow the host, and both screenshots are written at 390 px', async ({ page }) => {
  await load(page)
  await fitFrame(page)
  const frame = page.frameLocator('#view')
  const bodyBackground = () => frame.locator('body').evaluate((el) => getComputedStyle(el).backgroundColor)

  expect(await bodyBackground()).toBe('rgb(255, 255, 255)')
  mkdirSync(join('test-results', 'screens', '390'), { recursive: true })
  await page.locator('#view').screenshot({ path: join('test-results', 'screens', '390', 'mcp-thread-light.png') })

  await setTheme(page, 'dark')
  await expect.poll(bodyBackground).toBe('rgb(0, 0, 0)')
  await fitFrame(page)
  await page.locator('#view').screenshot({ path: join('test-results', 'screens', '390', 'mcp-thread-dark.png') })
})

test('the view makes no request to any host other than the page itself', async ({ page }) => {
  const requests: string[] = []
  page.on('request', (req) => requests.push(req.url()))
  // No images in this one: an image URL is the only other thing that could make a request.
  const noImages = {
    ...FIXTURE,
    structuredContent: {
      draft: { ...FIXTURE.structuredContent.draft, posts: FIXTURE.structuredContent.draft.posts.map(({ text, embeddedTweet }) => ({ text, embeddedTweet })) }
    }
  }
  await load(page, noImages)
  await expect(page.frameLocator('#view').locator('article')).toHaveCount(3)
  expect(requests.filter((u) => !u.startsWith('about:') && !u.startsWith('data:'))).toEqual([])
})

// Plan Task 7 (#189): a saved draft with its id, and the share link that create_share_link returns for it.
const DRAFT_ID = '11111111-2222-4333-8444-555555555555'
const LINK_TOKEN = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'
const SAVED_WITH_ID = {
  ...FIXTURE,
  structuredContent: { draft: { ...FIXTURE.structuredContent.draft, id: DRAFT_ID } }
}
const SHARE_REPLY = {
  content: [{ type: 'text', text: 'link created' }],
  structuredContent: {
    draft_id: DRAFT_ID,
    token: LINK_TOKEN,
    expires_at: new Date(Date.now() + 3600 * 1000).toISOString(),
    one_time: true,
    preview_url: `https://app.example/x-thread-preview/${LINK_TOKEN}`,
    markdown_url: `https://app.example/api/share/${LINK_TOKEN}.md`
  }
}

test('"Create share link" sends one create_share_link with the draft id, then shows the card in place', async ({ page }) => {
  await load(page, SAVED_WITH_ID, { caps: { serverTools: {} }, reply: SHARE_REPLY })
  const frame = page.frameLocator('#view')
  await frame.getByRole('button', { name: 'Create share link' }).click()
  await expect(frame.getByText('Preview link')).toBeVisible()
  await expect(frame.getByRole('button', { name: 'Create share link' })).toHaveCount(0)
  await expect(frame.getByRole('button', { name: 'Stop this link' })).toBeVisible()
  const calls = await page.evaluate(() => (window as any).__calls.map((c: any) => ({ name: c.name, arguments: c.arguments })))
  expect(calls).toEqual([{ name: 'create_share_link', arguments: { id: DRAFT_ID } }])
})

test('without a host that can call tools, the thread has no "Create share link"', async ({ page }) => {
  await load(page, SAVED_WITH_ID, { caps: {} })
  await expect(page.frameLocator('#view').getByText('Start of thread')).toBeVisible()
  await expect(page.frameLocator('#view').getByRole('button', { name: 'Create share link' })).toHaveCount(0)
})

// #405 (B1 b): the host called get_draft, then update_post. The card of update_post shows the new text of the one
// changed post and its old text, not the other posts; "Show all 6 posts" draws the whole thread, as saved.
test('after update_post the card shows only the changed post, before and after, in Hebrew', async ({ page }) => {
  const { changeMeta } = await import('../../server/mcp/edit-result.js')
  const before = { title: 'שרשור', version: 1, posts: [1, 2, 3, 4, 5, 6].map((n) => ({ id: `p${n}`, text: `פוסט ישן ${n}`, images: [] })) }
  const after = { ...before, version: 2, posts: before.posts.map((post) => (post.id === 'p2' ? { ...post, text: 'פוסט חדש 2 ' + XSS } : post)) }
  const edited = {
    content: [{ type: 'text', text: 'fixture' }],
    structuredContent: { draft: { id: '00000000-0000-4000-8000-000000000001', title: after.title, posts: after.posts.map((post) => ({ id: post.id })) } },
    _meta: { 'x-thread/posts': after.posts, 'x-thread/changes': changeMeta(before, after) }
  }
  await load(page, edited as typeof FIXTURE)
  const frame = page.frameLocator('#view')
  await expect(frame.locator('article')).toHaveCount(1)
  await expect(frame.getByText('פוסט חדש 2 ' + XSS)).toBeVisible()
  await expect(frame.getByText('פוסט ישן 2')).toBeVisible()
  await expect(frame.getByText('פוסט ישן 3')).toHaveCount(0)
  await expect(frame.locator('img')).toHaveCount(0)
  await frame.getByRole('button', { name: 'Show all 6 posts' }).click()
  await expect(frame.locator('article')).toHaveCount(6)
  await expect(frame.getByText('פוסט ישן 2')).toHaveCount(0)
})

// #392 (W5): a draft saved with 1 post, then update_draft with 7 posts. The newest card says "7 posts" and shows all 7,
// built from the result as the server sends it (changeMeta of the 1-post draft before and the 7-post draft after).
test('after update_draft with 7 posts the new card says 7 posts and shows all 7', async ({ page }) => {
  const { changeMeta } = await import('../../server/mcp/edit-result.js')
  const before = { title: 'Seven', version: 1, posts: [{ id: 'p1', text: 'Only one', images: [] }] }
  const posts = [1, 2, 3, 4, 5, 6, 7].map((n) => ({ id: `p${n}`, text: `Post number ${n} with its full text`, images: [] }))
  const after = { title: 'Seven', version: 2, posts }
  const updated = {
    content: [{ type: 'text', text: 'fixture' }],
    structuredContent: { draft: { id: '00000000-0000-4000-8000-000000000002', title: 'Seven', version: 2, posts: posts.map((post) => ({ id: post.id })) } },
    _meta: { 'x-thread/outline': { posts: posts.map((post) => ({ chars: post.text.length, over_limit: false })) }, 'x-thread/posts': posts, 'x-thread/changes': changeMeta(before, after) }
  }
  await load(page, updated as unknown as typeof FIXTURE)
  const frame = page.frameLocator('#view')
  await expect(frame.locator('header p').first()).toContainText('7 posts')
  await expect(frame.locator('article')).toHaveCount(7)
  await expect(frame.getByText('Post number 7 with its full text')).toBeVisible()
  await expect(frame.getByText('Only one')).toHaveCount(0)
})

// #420 (plan 4.3): "Add image" under a post. The view shrinks the chosen file and asks the host to call add_image_from_url
// with the bytes (data, mime); when the host refuses, fails or times out, it asks for an upload link and shows it as text.
const IMAGE_FILE = { name: 'photo.png', mimeType: 'image/png', buffer: TINY_PNG }
const WITH_POST_IDS = {
  ...SAVED_WITH_ID,
  structuredContent: { draft: { ...SAVED_WITH_ID.structuredContent.draft, posts: SAVED_WITH_ID.structuredContent.draft.posts.map((post, i) => ({ ...post, id: `post-${i + 1}` })) } }
}
const ADDED = { content: [{ type: 'text', text: 'added' }], structuredContent: { ok: true } }
const REFUSED = { content: [{ type: 'text', text: 'no' }], isError: true }
const LINK = { content: [{ type: 'text', text: 'link' }], structuredContent: { upload: { link: 'https://app.example/upload#tok', post: 1, slots: 2 } } }

// The host answers each tools/call from this list in turn; "hold" keeps the first answer back (a timeout).
async function replies(page: Page, list: unknown[], holdFirst = false) {
  await page.evaluate(
    ({ list, holdFirst }) => {
      const w = window as any
      let answered = 0
      let held = 0
      Object.defineProperty(w, '__callReply', { get: () => list[Math.min(answered++, list.length - 1)] })
      Object.defineProperty(w, '__holdCall', { get: () => holdFirst && held++ === 0 })
    },
    { list, holdFirst }
  )
}
const hostCalls = (page: Page) => page.evaluate(() => (window as any).__calls.map((c: any) => ({ name: c.name, arguments: c.arguments })))

test('"Add image" sends the shrunk file as bytes to add_image_from_url and says it was added', async ({ page }) => {
  await load(page, WITH_POST_IDS, { caps: { serverTools: {} }, reply: ADDED })
  const frame = page.frameLocator('#view')
  await expect(frame.getByRole('button', { name: 'Add image' })).toHaveCount(3)
  await frame.locator('input[type=file]').first().setInputFiles(IMAGE_FILE)
  await expect(frame.getByText('Image added.')).toBeVisible()
  const calls = await hostCalls(page)
  expect(calls).toHaveLength(1)
  expect(calls[0].name).toBe('add_image_from_url')
  expect(calls[0].arguments).toMatchObject({ draftId: DRAFT_ID, postId: 'post-1', mime: 'image/jpeg' })
  expect(Buffer.from(calls[0].arguments.data, 'base64').subarray(0, 3)).toEqual(Buffer.from([0xff, 0xd8, 0xff]))
  expect(calls[0].arguments.url).toBeUndefined()
})

test('when the host refuses the bytes, the view asks for an upload link and shows it as text', async ({ page }) => {
  await load(page, WITH_POST_IDS, { caps: { serverTools: {} } })
  await replies(page, [REFUSED, LINK])
  const frame = page.frameLocator('#view')
  await frame.locator('input[type=file]').first().setInputFiles(IMAGE_FILE)
  await expect(frame.getByText('Upload link: https://app.example/upload#tok')).toBeVisible()
  const calls = await hostCalls(page)
  expect(calls.map((c: any) => c.name)).toEqual(['add_image_from_url', 'add_image_from_url'])
  expect(calls[1].arguments).toEqual({ draftId: DRAFT_ID, postId: 'post-1', upload_link: true })
})

test('when the host does not answer the bytes in time, the view asks for an upload link', async ({ page }) => {
  await page.clock.install()
  await load(page, WITH_POST_IDS, { caps: { serverTools: {} } })
  await replies(page, [LINK], true)
  const frame = page.frameLocator('#view')
  await frame.locator('input[type=file]').first().setInputFiles(IMAGE_FILE)
  await expect.poll(async () => (await hostCalls(page)).length).toBe(1)
  await page.clock.fastForward(121000)
  await expect(frame.getByText('Upload link: https://app.example/upload#tok')).toBeVisible()
})

test('without a host that can call tools, there is no "Add image"', async ({ page }) => {
  await load(page, WITH_POST_IDS, { caps: {} })
  await expect(page.frameLocator('#view').getByText('Start of thread')).toBeVisible()
  await expect(page.frameLocator('#view').getByRole('button', { name: 'Add image' })).toHaveCount(0)
})
