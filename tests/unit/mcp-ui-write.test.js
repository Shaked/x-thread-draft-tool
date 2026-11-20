// Plan Task 7 (#189): the write actions in the views, in jsdom. "Stop this link" (share card) and "Create share link"
// (thread view) send exactly one tools/call per confirmed click, nothing before the confirm step, and show the
// waiting and refusal lines. The Playwright checks are in tests/e2e/mcp-share-view.spec.ts and mcp-thread-view.spec.ts.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderShare, shareFrom } from '../../server/mcp/ui/share.js'
import { createShareNode } from '../../server/mcp/ui/thread.js'
import { threadFrom } from '../../server/mcp/ui/client.js'

const DRAFT = '11111111-2222-4333-8444-555555555555'
const TOKEN = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'
const PREVIEW = `https://app.example/x-thread-preview/${TOKEN}`
const MARKDOWN = `https://app.example/api/share/${TOKEN}.md`
const NOW = Date.parse('2026-11-20T12:00:00Z')

function shareResult(overrides = {}) {
  return {
    structuredContent: {
      draft_id: DRAFT,
      token: TOKEN,
      expires_at: new Date(NOW + 3600 * 1000).toISOString(),
      one_time: true,
      preview_url: PREVIEW,
      markdown_url: MARKDOWN,
      ...overrides
    }
  }
}

const button = (root, name) => [...root.querySelectorAll('button')].find((b) => b.textContent === name)
// Lets the promise callbacks run. Fake timers stay in place, so this only flushes microtasks.
const tick = async () => {
  for (let i = 0; i < 5; i++) await Promise.resolve()
}

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  document.body.textContent = ''
})

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(NOW)
})

function card(revoke) {
  const root = document.createElement('main')
  const share = shareFrom(shareResult())
  renderShare(root, share, { open: vi.fn(), now: () => Date.now(), locale: 'en-US', revoke })
  return root
}

describe('share card: Stop this link', () => {
  it('is not shown without a way to call tools (revoke is not set)', () => {
    const root = card(null)
    expect(button(root, 'Stop this link')).toBeUndefined()
  })

  it('shows "Are you sure?" first, and a cancel sends nothing', () => {
    const revoke = vi.fn()
    const root = card(revoke)
    button(root, 'Stop this link').click()
    expect(root.textContent).toContain('Are you sure?')
    button(root, 'Cancel').click()
    expect(revoke).not.toHaveBeenCalled()
    expect(button(root, 'Stop this link')).toBeDefined()
  })

  it('sends exactly one revoke with the draft id and this link\'s token, then says Stopped and turns the buttons off', async () => {
    const revoke = vi.fn(() => new Promise(() => {}))
    const root = card(revoke)
    button(root, 'Stop this link').click()
    button(root, 'Yes, stop this link').click()
    expect(revoke).toHaveBeenCalledTimes(1)
    expect(revoke).toHaveBeenCalledWith(DRAFT, TOKEN)
    expect(root.textContent).toContain('Waiting for your OK in the chat')
    expect(button(root, 'Yes, stop this link').disabled).toBe(true)
  })

  it('a successful stop says Stopped, disables the link buttons and removes the stop action', async () => {
    const revoke = vi.fn(() => Promise.resolve({ content: [{ type: 'text', text: '{"ok":true}' }], structuredContent: { ok: true } }))
    const root = card(revoke)
    button(root, 'Stop this link').click()
    button(root, 'Yes, stop this link').click()
    await tick()
    expect(root.textContent).toContain('Stopped')
    expect(button(root, 'Stop this link')).toBeUndefined()
    expect(button(root, 'Open').disabled).toBe(true)
    // The countdown is stopped too: advancing the clock does not bring the text back.
    vi.advanceTimersByTime(5000)
    expect(root.textContent).toContain('Stopped')
    expect(revoke).toHaveBeenCalledTimes(1)
  })

  it('a tool error shows its text and lets the user try again', async () => {
    const revoke = vi.fn(() => Promise.resolve({ isError: true, content: [{ type: 'text', text: 'Link not found' }] }))
    const root = card(revoke)
    button(root, 'Stop this link').click()
    button(root, 'Yes, stop this link').click()
    await tick()
    expect(root.textContent).toContain('Link not found')
    expect(button(root, 'Stop this link')).toBeDefined()
  })

  it('a host that refuses the call removes the action and says so', async () => {
    const revoke = vi.fn(() => Promise.reject(new Error('tool call not allowed')))
    const root = card(revoke)
    button(root, 'Stop this link').click()
    button(root, 'Yes, stop this link').click()
    await tick()
    expect(root.textContent).toContain('Your app does not allow this here.')
    expect(button(root, 'Stop this link')).toBeUndefined()
  })

  it('a timeout says there was no answer and can be tried again', async () => {
    const revoke = vi.fn(() => Promise.reject(new Error('tools/call timed out')))
    const root = card(revoke)
    button(root, 'Stop this link').click()
    button(root, 'Yes, stop this link').click()
    await tick()
    expect(root.textContent).toContain('No answer from the host. Try again.')
    expect(button(root, 'Yes, stop this link').disabled).toBe(false)
  })

  it('the token is not written to the page, not even when the stop action is shown', () => {
    const root = card(vi.fn())
    expect(root.textContent).not.toContain(TOKEN)
    const values = [...root.querySelectorAll('input')].map((f) => f.value)
    expect(values).toEqual([PREVIEW, MARKDOWN])
  })
})

describe('thread view: Create share link', () => {
  const thread = (overrides = {}) => ({
    title: 'Draft',
    posts: [{ text: 'hi', images: [], embeddedTweet: null }],
    saved: true,
    is_published: false,
    url: null,
    counts: null,
    editorBase: null,
    imageOrigin: null,
    id: DRAFT,
    share: { create: vi.fn(() => new Promise(() => {})), revoke: vi.fn(), locale: 'en-US' },
    ...overrides
  })

  it('one click calls create_share_link with the draft id and nothing else, and says it waits for the OK', () => {
    const t = thread()
    const node = createShareNode(t, vi.fn())
    node.querySelector('button').click()
    expect(t.share.create).toHaveBeenCalledTimes(1)
    expect(t.share.create).toHaveBeenCalledWith(DRAFT)
    expect(node.textContent).toContain('Waiting for your OK in the chat')
  })

  it('a created link shows the share card in place and removes the button', async () => {
    const t = thread({ share: { create: vi.fn(() => Promise.resolve(shareResult())), revoke: vi.fn(), locale: 'en-US' } })
    const node = createShareNode(t, vi.fn())
    node.querySelector('button').click()
    await tick()
    expect(button(node, 'Create share link')).toBeUndefined()
    expect(node.textContent).toContain('Share link')
    expect(node.textContent).toContain('Stop this link')
  })

  it('a tool error shows its text and the button can be used again', async () => {
    const t = thread({ share: { create: vi.fn(() => Promise.resolve({ isError: true, content: [{ type: 'text', text: 'Draft not found' }] })), revoke: vi.fn(), locale: 'en-US' } })
    const node = createShareNode(t, vi.fn())
    node.querySelector('button').click()
    await tick()
    expect(node.textContent).toContain('Draft not found')
    expect(node.querySelector('button').disabled).toBe(false)
  })

  it('a refusal by the host removes the button and says so', async () => {
    const t = thread({ share: { create: vi.fn(() => Promise.reject(new Error('not allowed'))), revoke: vi.fn(), locale: 'en-US' } })
    const node = createShareNode(t, vi.fn())
    node.querySelector('button').click()
    await tick()
    expect(node.textContent).toContain('Your app does not allow this here.')
    expect(node.querySelector('button')).toBeNull()
  })
})

describe('threadFrom: the draft id', () => {
  it('is the saved draft\'s id when it is a UUID, and null otherwise', () => {
    const saved = threadFrom({ structuredContent: { draft: { id: DRAFT, title: 't', posts: [] } } })
    expect(saved.id).toBe(DRAFT)
    const bare = threadFrom({ structuredContent: { posts: [{ text: 'x' }] } })
    expect(bare.id).toBeNull()
    const odd = threadFrom({ structuredContent: { draft: { id: 'not-a-uuid', posts: [] } } })
    expect(odd.id).toBeNull()
  })
})
