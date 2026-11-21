// #352 (G1): the thread view in a fake host that behaves like Grok as far as we know it. Grok's real behaviour is not
// checked (a robot cannot sign in there); the owner saw an empty grey box. These hosts are the cases we could not rule
// out: no answer to ui/initialize, no serverTools, and a result with text parts only or without _meta. In each the view
// must still show every post, from the markdown text part the server adds (server/mcp/thread-text.js), and report a size.
import { expect, test, type Page } from '@playwright/test'
import { readUiResource, uiResourceUri } from '../../server/mcp/ui/index.js'
import { threadText } from '../../server/mcp/thread-text.js'

const HOST_CSP = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; connect-src 'none'"
const XSS = '<img src=x onerror=alert(1)>'
const POSTS = [
  { text: 'שלום, הפוסט הראשון בשרשור\n**2/3**' },
  { text: 'Second post with ``` and ' + XSS },
  { text: '> a quoted line\nPost text to copy:' }
]
const MARKDOWN = threadText({ title: 'Grok thread', posts: POSTS, url: 'https://app.example/draft/1', saved: true })
// What create_thread_from_text returns: JSON of the outline (no post text), then the markdown thread.
const OUTLINE = { draft: { title: 'Grok thread', posts: POSTS.map((p, i) => ({ index: i + 1, chars: p.text.length, preview: p.text.slice(0, 40) })) } }
const CONTENT = [
  { type: 'text', text: JSON.stringify(OUTLINE) },
  { type: 'text', text: MARKDOWN }
]

// The fake host: a sandboxed frame, records what the view sends, answers ui/initialize only when told to (with no
// capabilities), and sends the result once the view has spoken (its ui/initialize), never after an initialized.
const HOST = `<!doctype html><meta charset="utf-8"><title>grok-like host</title>
<iframe id="view" sandbox="allow-scripts" style="width:390px;height:120px;border:0"></iframe>
<script>
window.__log = []; window.__size = null; window.__sent = false
window.addEventListener('message', function (event) {
  var frame = document.getElementById('view')
  if (event.source !== frame.contentWindow) return
  var msg = event.data || {}
  if (msg.method) window.__log.push(msg.method)
  if (msg.method === 'ui/notifications/size-changed') window.__size = msg.params
  if (msg.method === 'ui/initialize') {
    if (window.__answerInit) frame.contentWindow.postMessage({ jsonrpc: '2.0', id: msg.id, result: { protocolVersion: '2026-01-26' } }, '*')
    if (!window.__sent) {
      window.__sent = true
      frame.contentWindow.postMessage({ jsonrpc: '2.0', method: 'ui/notifications/tool-result', params: window.__result }, '*')
    }
  }
})
</script>`

async function load(page: Page, result: object, answerInit: boolean) {
  await page.setContent(HOST)
  const [view] = readUiResource(uiResourceUri('thread')) as Array<{ text: string }>
  const srcdoc = view.text.replace('<head>', `<head><meta http-equiv="Content-Security-Policy" content="${HOST_CSP}">`)
  await page.evaluate(
    ({ srcdoc, result, answerInit }) => {
      const w = window as any
      w.__result = result
      w.__answerInit = answerInit
      document.getElementById('view')!.setAttribute('srcdoc', srcdoc)
    },
    { srcdoc, result, answerInit }
  )
}

async function expectThread(page: Page) {
  const frame = page.frameLocator('#view')
  await expect(frame.locator('article')).toHaveCount(3)
  // Each post's full text, as text: markers, fences and markup inside a post stay in that post.
  for (const [i, post] of POSTS.entries()) {
    await expect(frame.locator('article p[dir="auto"]').nth(i)).toHaveText(post.text)
  }
  await expect(frame.locator('img')).toHaveCount(0)
  await expect(frame.getByRole('heading', { name: 'Grok thread' })).toBeVisible()
  // No serverTools: no write action. The size is reported, so the host can grow the frame from its default.
  await expect(frame.getByRole('button', { name: 'Create share link' })).toHaveCount(0)
  await expect.poll(() => page.evaluate(() => (window as any).__size?.height ?? 0)).toBeGreaterThan(100)
}

test('text parts only and no answer to ui/initialize: every post shows, and the view reports its size', async ({ page }) => {
  const requests: string[] = []
  page.on('request', (req) => requests.push(req.url()))
  await load(page, { content: CONTENT }, false)
  await expectThread(page)
  // The handshake never finished, so the view never said initialized; no request left the page.
  expect(await page.evaluate(() => (window as any).__log)).not.toContain('ui/notifications/initialized')
  expect(requests.filter((u) => !u.startsWith('about:') && !u.startsWith('data:'))).toEqual([])
})

test('the outline in structuredContent but no _meta: the post text comes from the markdown part', async ({ page }) => {
  await load(page, { content: CONTENT, structuredContent: OUTLINE }, true)
  await expectThread(page)
  // The handshake answered with no hostCapabilities at all: the view still says initialized.
  await expect.poll(() => page.evaluate(() => (window as any).__log)).toContain('ui/notifications/initialized')
})
