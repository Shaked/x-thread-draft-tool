// Plan Task 6 (#187): the share link card in jsdom. The two links and their Open and Copy buttons, the countdown and
// the "Expired" state (fake timers), the copy fallback when the clipboard write fails, and that the token appears
// only inside the two URLs. The Playwright check is in tests/e2e/mcp-share-view.spec.ts.
import './helpers/page-globals.js'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { countdownText, localTime, renderShare, shareFrom } from '../../server/mcp/ui/share.js'
import { listUiResources, readUiResource, uiResourceUri } from '../../server/mcp/ui/index.js'

const TOKEN = 'tok3nABCDEF0123456789'
const PREVIEW = `https://app.example/x-thread-preview/${TOKEN}`
const MARKDOWN = `https://app.example/api/share/${TOKEN}.md`
const NOW = Date.parse('2026-11-19T12:00:00Z')

function result(overrides = {}) {
  return {
    structuredContent: {
      token: TOKEN,
      expires_at: new Date(NOW + 3600 * 1000).toISOString(),
      one_time: true,
      preview_url: PREVIEW,
      markdown_url: MARKDOWN,
      ...overrides
    }
  }
}

function render(share, open = vi.fn()) {
  const root = document.createElement('main')
  const stop = renderShare(root, share, { open, now: () => Date.now(), locale: 'en-US' })
  return { root, stop, open }
}

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  delete navigator.clipboard
  document.body.textContent = ''
})

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(NOW)
})

describe('shareFrom', () => {
  it('reads both https URLs, the expiry and one_time', () => {
    // The token here is not a UUID, so the stop action has no token to use (null), as the card expects.
    expect(shareFrom(result())).toEqual({
      preview: PREVIEW,
      markdown: MARKDOWN,
      expiresAt: NOW + 3600 * 1000,
      oneTime: true,
      token: null,
      draftId: null
    })
  })

  it('is null without both https URLs (a plain http link is refused)', () => {
    expect(shareFrom(result({ preview_url: 'http://app.example/x' }))).toBeNull()
    expect(shareFrom(result({ markdown_url: undefined }))).toBeNull()
    expect(shareFrom({ isError: true, content: [] })).toBeNull()
  })

  it('an unreadable expiry is null (the card shows no countdown)', () => {
    expect(shareFrom(result({ expires_at: 'soon' })).expiresAt).toBeNull()
  })
})

describe('the countdown', () => {
  it('reads m:ss, and h:mm:ss from an hour up', () => {
    expect(countdownText(NOW + 3600 * 1000, NOW)).toBe('1:00:00')
    expect(countdownText(NOW + 3599 * 1000, NOW)).toBe('59:59')
    expect(countdownText(NOW + 59 * 60 * 1000 + 12 * 1000, NOW)).toBe('59:12')
    expect(countdownText(NOW + 7322 * 1000, NOW)).toBe('2:02:02')
    expect(countdownText(NOW + 500, NOW)).toBe('0:01')
  })

  it('shows the local time of the expiry in the locale', () => {
    expect(localTime(NOW, 'en-US')).toBe(new Date(NOW).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }))
  })
})

describe('the card', () => {
  it('shows the two links as read-only fields, with the URLs as their values', () => {
    const { root } = render(shareFrom(result()))
    const fields = Array.from(root.querySelectorAll('input'))
    expect(fields.map((field) => field.value)).toEqual([PREVIEW, MARKDOWN])
    expect(fields.every((field) => field.readOnly)).toBe(true)
    expect(root.textContent).toContain('Preview link')
    expect(root.textContent).toContain('Markdown link')
  })

  it('says "Works once" or "Works until it expires", and counts down each second', () => {
    const { root, stop } = render(shareFrom(result()))
    expect(root.textContent).toContain('Works once · Expires in 1:00:00')
    vi.advanceTimersByTime(10 * 1000)
    expect(root.textContent).toContain('Works once · Expires in 59:50')
    stop()
    const reusable = render(shareFrom(result({ one_time: false })))
    expect(reusable.root.textContent).toContain('Works until it expires')
  })

  it('after the expiry the card says "Expired" and its buttons stop working', () => {
    const { root, stop } = render(shareFrom(result()))
    vi.advanceTimersByTime(3600 * 1000)
    expect(root.textContent).toContain('Works once · Expired')
    const buttons = Array.from(root.querySelectorAll('button'))
    expect(buttons.length).toBeGreaterThan(0)
    expect(buttons.every((button) => button.disabled)).toBe(true)
    expect(vi.getTimerCount()).toBe(0)
    stop()
  })

  it('stops the countdown when stopped', () => {
    const { root, stop } = render(shareFrom(result()))
    stop()
    vi.advanceTimersByTime(5000)
    expect(root.textContent).toContain('Expires in 1:00:00')
  })

  it('Open asks the host to open that link', () => {
    const open = vi.fn()
    const { root } = render(shareFrom(result()), open)
    const [previewOpen] = Array.from(root.querySelectorAll('button')).filter((b) => b.textContent === 'Open')
    previewOpen.click()
    expect(open).toHaveBeenCalledWith(PREVIEW)
  })

  it('no Copy button when the page cannot write the clipboard', () => {
    delete navigator.clipboard
    const { root } = render(shareFrom(result()))
    expect(Array.from(root.querySelectorAll('button')).map((b) => b.textContent)).toEqual(['Open', 'Open'])
  })

  it('Copy says "Copied" when the write works', async () => {
    const writeText = vi.fn(async () => {})
    navigator.clipboard = { writeText }
    const { root } = render(shareFrom(result()))
    const copy = Array.from(root.querySelectorAll('button')).find((b) => b.textContent === 'Copy')
    copy.click()
    await vi.runAllTicks()
    await Promise.resolve()
    expect(writeText).toHaveBeenCalledWith(PREVIEW)
    expect(copy.textContent).toBe('Copied')
  })

  it('when the clipboard write throws, Copy says "Select and copy" and selects the field', async () => {
    navigator.clipboard = {
      writeText() {
        throw new Error('denied')
      }
    }
    const { root } = render(shareFrom(result()))
    const field = root.querySelector('input')
    const select = vi.spyOn(field, 'select')
    const copy = Array.from(root.querySelectorAll('button')).find((b) => b.textContent === 'Copy')
    copy.click()
    await Promise.resolve()
    await Promise.resolve()
    expect(copy.textContent).toBe('Select and copy')
    expect(select).toHaveBeenCalled()
  })

  it('a rejected clipboard write gets the same fallback', async () => {
    navigator.clipboard = { writeText: vi.fn(() => Promise.reject(new Error('denied'))) }
    const { root } = render(shareFrom(result()))
    const copy = Array.from(root.querySelectorAll('button')).find((b) => b.textContent === 'Copy')
    copy.click()
    await Promise.resolve()
    await Promise.resolve()
    expect(copy.textContent).toBe('Select and copy')
  })

  it('the token appears only inside the two URL fields, never as text of the card', () => {
    const { root } = render(shareFrom(result()))
    expect(root.textContent).not.toContain(TOKEN)
    const values = Array.from(root.querySelectorAll('input')).map((field) => field.value)
    expect(values.every((value) => value.includes(TOKEN))).toBe(true)
  })
})

describe('the view resource', () => {
  it('is listed under the share name with its clipboard permission, and its HTML is a document', () => {
    const uri = uiResourceUri('share')
    expect(listUiResources().map((e) => e.uri)).toContain(uri)
    const [content] = readUiResource(uri)
    expect(content.text.startsWith('<!doctype html>')).toBe(true)
    expect(content.text).not.toContain('innerHTML')
    expect(content.text).not.toMatch(/\bfetch\(/)
  })
})
