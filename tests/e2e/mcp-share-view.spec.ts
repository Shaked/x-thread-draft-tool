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

// The host's answers for this card: its capabilities (serverTools lets the view call tools), the answer to a tools/call,
// and whether that answer is held back (the host waits for the user's OK in the chat).
type HostSetup = { caps?: object; reply?: unknown; hold?: boolean }

// Loads the share card in the fixture host. The clock is installed first, so the countdown follows page.clock.
async function show(page: Page, structuredContent: unknown, host: HostSetup = {}) {
  await page.clock.install({ time: NOW })
  await page.setContent(readFileSync(join(process.cwd(), 'tests/e2e/fixtures/mcp-host.html'), 'utf8'))
  const [view] = readUiResource(uiResourceUri('share')) as Array<{ text: string }>
  const srcdoc = view.text.replace('<head>', `<head><meta http-equiv="Content-Security-Policy" content="${HOST_CSP}">`)
  await page.evaluate(
    ({ srcdoc, fixture, host }) => {
      const w = window as any
      w.__theme = 'light'
      w.__caps = host.caps || {}
      w.__callReply = host.reply
      w.__holdCall = host.hold === true
      w.__fixture = { content: [{ type: 'text', text: 'fixture' }], structuredContent: fixture }
      document.getElementById('view')!.setAttribute('srcdoc', srcdoc)
    },
    { srcdoc, fixture: structuredContent, host }
  )
  return page.frameLocator('#view')
}

// Plan Task 7 (#189): a link with both ids (the stop action needs them), as create_share_link returns it now.
const DRAFT = '11111111-2222-4333-8444-555555555555'
const UUID_TOKEN = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'
const STOPPED = { content: [{ type: 'text', text: '{"ok":true}' }], structuredContent: { ok: true } }

function withIds(oneTime = true) {
  return {
    ...fixture(oneTime),
    draft_id: DRAFT,
    token: UUID_TOKEN,
    preview_url: `https://app.example/x-thread-preview/${UUID_TOKEN}`,
    markdown_url: `https://app.example/api/share/${UUID_TOKEN}.md`
  }
}

// The calls the host has received from the view (tools/call only).
const hostCalls = (page: Page) => page.evaluate(() => (window as any).__calls.map((c: any) => ({ name: c.name, arguments: c.arguments })))

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

test('without a host that can call tools, the card has no "Stop this link"', async ({ page }) => {
  const frame = await show(page, withIds(true), { caps: {} })
  await expect(frame.getByText('Works once · Expires in 1:00:00')).toBeVisible()
  await expect(frame.getByRole('button', { name: 'Stop this link' })).toHaveCount(0)
  expect(await hostCalls(page)).toEqual([])
})

test('"Stop this link" sends nothing until "Yes": then exactly one revoke_share_link with the draft id and this link\'s token', async ({ page }) => {
  const frame = await show(page, withIds(true), { caps: { serverTools: {} }, reply: STOPPED })

  await frame.getByRole('button', { name: 'Stop this link' }).click()
  await expect(frame.getByText('Are you sure? The link stops working at once.')).toBeVisible()
  expect(await hostCalls(page)).toEqual([])

  // Cancel goes back without a call.
  await frame.getByRole('button', { name: 'Cancel' }).click()
  await expect(frame.getByRole('button', { name: 'Stop this link' })).toBeVisible()
  expect(await hostCalls(page)).toEqual([])

  await frame.getByRole('button', { name: 'Stop this link' }).click()
  await frame.getByRole('button', { name: 'Yes, stop this link' }).click()
  await expect(frame.getByText('Stopped')).toBeVisible()
  expect(await hostCalls(page)).toEqual([{ name: 'revoke_share_link', arguments: { id: DRAFT, token: UUID_TOKEN } }])
  await expect(frame.getByRole('button', { name: 'Stop this link' })).toHaveCount(0)
})

test('while the host has not answered, the card says it waits for the OK in the chat', async ({ page }) => {
  const frame = await show(page, withIds(false), { caps: { serverTools: {} }, reply: STOPPED, hold: true })

  await frame.getByRole('button', { name: 'Stop this link' }).click()
  await frame.getByRole('button', { name: 'Yes, stop this link' }).click()
  await expect(frame.getByText('Waiting for your OK in the chat')).toBeVisible()
  expect(await hostCalls(page)).toHaveLength(1)
})
