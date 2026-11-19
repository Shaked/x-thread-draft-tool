// Plan Task 1 step 7 (#170): the thread view in a sandboxed iframe with the host CSP of D4, driven by the
// hand-written host in fixtures/mcp-host.html. A robot can check the handshake, the text, the size and the
// absence of network requests; it cannot check how Claude or ChatGPT draws the view (plan section 3).
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { readUiResource, uiResourceUri } from '../../server/mcp/ui/index.js'

const HOST_CSP =
  "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; connect-src 'none'"
const FIXTURE = {
  content: [{ type: 'text', text: 'fixture' }],
  structuredContent: {
    draft: {
      title: 'Fixture thread',
      posts: [{ text: 'First post שלום' }, { text: 'Second post <img src=x onerror=alert(1)>' }]
    }
  }
}

// "No request from the page" only sees loads the page itself makes; the view's CSP (connect-src 'none') is what stops
// a view's own fetch, and the unit test greps the view source for fetch.
test('the thread view handshakes, shows the text, reports a size, and the page makes no request', async ({ page }) => {
  const requests: string[] = []
  page.on('request', (req) => requests.push(req.url()))

  await page.setContent(readFileSync(join(process.cwd(), 'tests/e2e/fixtures/mcp-host.html'), 'utf8'))
  const [view] = readUiResource(uiResourceUri('thread')) as Array<{ text: string }>
  const srcdoc = view.text.replace('<head>', `<head><meta http-equiv="Content-Security-Policy" content="${HOST_CSP}">`)
  await page.evaluate(
    ({ srcdoc, fixture }) => {
      ;(window as any).__fixture = fixture
      document.getElementById('view')!.setAttribute('srcdoc', srcdoc)
    },
    { srcdoc, fixture: FIXTURE }
  )

  const frame = page.frameLocator('#view')
  await expect(frame.getByText('First post שלום')).toBeVisible()
  await expect(frame.getByText('Second post <img src=x onerror=alert(1)>')).toBeVisible()
  await expect(frame.locator('img')).toHaveCount(0)

  const log = await page.evaluate(() => (window as any).__log as string[])
  expect(log).toEqual(expect.arrayContaining(['ui/initialize', 'ui/notifications/initialized']))

  await expect.poll(() => page.evaluate(() => (window as any).__size?.height ?? 0)).toBeGreaterThan(0)

  // Only the page itself and the frame's document were loaded; no request left the page.
  expect(requests.filter((u) => !u.startsWith('about:') && !u.startsWith('data:'))).toEqual([])
})
