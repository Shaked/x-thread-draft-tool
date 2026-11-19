// Plan Task 6 (#187): the share link card in the hand-written host (tests/e2e/fixtures/mcp-host.html), under the host
// CSP of D4, with a fake clock. A robot checks the countdown, the "Expired" state with its buttons off, that the token
// is only in the two URL fields, and that no request leaves the page. It cannot check how Claude or ChatGPT draws it.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import { readUiResource, uiResourceUri } from '../../server/mcp/ui/index.js'

const HOST_CSP = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src 'none'; connect-src 'none'"
const TOKEN = 'tok3nE2EFIXTURE0123456789'
const NOW = Date.parse('2026-11-19T12:00:00Z')

function fixture(oneTime: boolean) {
  return {
    token: TOKEN,
    expires_at: new Date(NOW + 3600 * 1000).toISOString(),
    one_time: oneTime,
    preview_url: `https://app.example/x-thread-preview/${TOKEN}`,
    markdown_url: `https://app.example/api/share/${TOKEN}.md`
  }
}

// Loads the share card in the fixture host. The clock is installed first, so the countdown follows page.clock.
async function show(page: Page, structuredContent: unknown) {
  await page.clock.install({ time: NOW })
  await page.setContent(readFileSync(join(process.cwd(), 'tests/e2e/fixtures/mcp-host.html'), 'utf8'))
  const [view] = readUiResource(uiResourceUri('share')) as Array<{ text: string }>
  const srcdoc = view.text.replace('<head>', `<head><meta http-equiv="Content-Security-Policy" content="${HOST_CSP}">`)
  await page.evaluate(
    ({ srcdoc, fixture }) => {
      const w = window as any
      w.__theme = 'light'
      w.__fixture = { content: [{ type: 'text', text: 'fixture' }], structuredContent: fixture }
      document.getElementById('view')!.setAttribute('srcdoc', srcdoc)
    },
    { srcdoc, fixture: structuredContent }
  )
  return page.frameLocator('#view')
}

test('the card shows both links and counts down; after the expiry it says Expired and its buttons stop', async ({ page }) => {
  const requests: string[] = []
  page.on('request', (req) => requests.push(req.url()))

  const frame = await show(page, fixture(true))
  await expect(frame.getByText('Works once · Expires in 1:00:00')).toBeVisible()
  await expect(frame.getByText('Preview link')).toBeVisible()
  await expect(frame.getByText('Markdown link')).toBeVisible()

  await page.clock.fastForward(10 * 60 * 1000)
  await expect(frame.getByText('Expires in 50:00')).toBeVisible()

  await page.clock.fastForward(50 * 60 * 1000 + 1000)
  await expect(frame.getByText('Works once · Expired')).toBeVisible()
  await expect(frame.getByRole('button', { name: 'Open' }).first()).toBeDisabled()

  expect(requests.filter((u) => !u.startsWith('about:') && !u.startsWith('data:'))).toEqual([])
})

test('a reusable link says "Works until it expires"; the token is only in the two URL fields', async ({ page }) => {
  const frame = await show(page, fixture(false))
  await expect(frame.getByText('Works until it expires · Expires in 1:00:00')).toBeVisible()

  const text = await frame.locator('main').textContent()
  expect(text).not.toContain(TOKEN)
  const values = await frame.locator('input').evaluateAll((fields) => fields.map((f) => (f as HTMLInputElement).value))
  expect(values).toEqual([
    `https://app.example/x-thread-preview/${TOKEN}`,
    `https://app.example/api/share/${TOKEN}.md`
  ])
})
