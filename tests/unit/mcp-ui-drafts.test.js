// Plan Task 5 (#182): the drafts list view in jsdom. Rows, the Hebrew and Untitled titles, the counts and the
// over-limit chip, the date text in the host locale, the editor link only under the editor base, the empty list,
// and "View thread" through the host. The Playwright check is in tests/e2e/mcp-drafts-view.spec.ts.
import './helpers/page-globals.js'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { draftRow, listFrom, relativeTime, renderList, errorText } from '../../server/mcp/ui/drafts.js'
import { listUiResources, readUiResource, uiResourceUri } from '../../server/mcp/ui/index.js'

const EDITOR = 'https://app.example/draft/'
const NOW = Date.parse('2026-11-19T12:00:00Z')
const ID = '11111111-1111-4111-8111-111111111111'

function summary(overrides = {}) {
  return {
    id: ID,
    title: 'Hello',
    is_published: false,
    updated_at: '2026-11-19T10:00:00Z',
    published_at: null,
    version: 1,
    post_count: 2,
    total_chars: 30,
    over_limit_count: 0,
    image_count: 0,
    ...overrides
  }
}

function render(drafts, open = vi.fn(), view = vi.fn()) {
  const root = document.createElement('main')
  renderList(root, { drafts, editorBase: EDITOR }, { open, view, locale: 'en-US', now: NOW })
  return root
}

afterEach(() => {
  vi.restoreAllMocks()
  document.body.textContent = ''
})

describe('the list', () => {
  it('shows one row per draft, and "No drafts yet" for none', () => {
    expect(render([]).textContent).toContain('No drafts yet')
    expect(render([summary(), summary({ id: '22222222-2222-4222-8222-222222222222' })]).querySelectorAll('li')).toHaveLength(2)
  })

  it('shows the title as text with dir auto, and Untitled when the title is empty', () => {
    const root = render([summary({ title: '  ' }), summary({ title: 'שלום עולם' })])
    const titles = [...root.querySelectorAll('h2')]
    expect(titles[0].textContent).toBe('Untitled')
    expect(titles[1].textContent).toBe('שלום עולם')
    for (const title of titles) expect(title.getAttribute('dir')).toBe('auto')
  })

  it('shows the posts, characters and images counts, singular and plural', () => {
    const row = draftRow(summary({ post_count: 1, total_chars: 1, image_count: 1 }), { editorBase: EDITOR, open: vi.fn(), view: vi.fn(), locale: 'en-US', now: NOW })
    expect(row.textContent).toContain('1 post · 1 character · 1 image')
    const many = draftRow(summary({ post_count: 3, total_chars: 90, image_count: 0 }), { editorBase: EDITOR, open: vi.fn(), view: vi.fn(), locale: 'en-US', now: NOW })
    expect(many.textContent).toContain('3 posts · 90 characters')
    expect(many.textContent).not.toContain('image')
  })

  it('shows the over-limit chip only when a post is over 280 characters', () => {
    const over = render([summary({ over_limit_count: 2 })])
    expect(over.querySelector('strong').textContent).toBe('2 over 280')
    expect(render([summary()]).querySelector('strong')).toBeNull()
  })

  it('hides the counts for a detail-full row (it has no counts)', () => {
    const full = { id: ID, title: 'Full', is_published: false, updated_at: '2026-11-19T10:00:00Z', posts: [{ text: 'x' }] }
    const row = draftRow(full, { editorBase: EDITOR, open: vi.fn(), view: vi.fn(), locale: 'en-US', now: NOW })
    expect(row.textContent).not.toContain('post')
    expect(row.textContent).toContain('Full')
  })
})

describe('the date text', () => {
  it('says Published with the date for a published draft', () => {
    const row = draftRow(summary({ is_published: true, published_at: '2026-11-01T08:00:00Z' }), { editorBase: EDITOR, open: vi.fn(), view: vi.fn(), locale: 'en-US', now: NOW })
    expect(row.textContent).toContain('Published Nov 1, 2026')
  })

  it('says Updated with a relative time for an unpublished draft, in the host locale', () => {
    expect(relativeTime('2026-11-19T10:00:00Z', 'en-US', NOW)).toBe('2 hours ago')
    expect(relativeTime('2026-11-19T11:55:00Z', 'en-US', NOW)).toBe('5 minutes ago')
    expect(relativeTime('2026-11-18T12:00:00Z', 'en-US', NOW)).toBe('yesterday')
    expect(relativeTime('2026-11-19T10:00:00Z', 'he-IL', NOW)).toMatch(/לפני/)
    const row = draftRow(summary(), { editorBase: EDITOR, open: vi.fn(), view: vi.fn(), locale: 'en-US', now: NOW })
    expect(row.textContent).toContain('Updated 2 hours ago')
  })

  it('a bad locale or a bad date does not throw', () => {
    expect(relativeTime('2026-11-19T10:00:00Z', 'not a locale !!', NOW)).toMatch(/ago/)
    expect(relativeTime('not a date', 'en-US', NOW)).toBeNull()
  })
})

describe('the actions', () => {
  it('Open in editor sends the editor link through the host, only under the editor base', () => {
    const open = vi.fn()
    const root = render([summary()], open)
    const button = [...root.querySelectorAll('button')].find((b) => b.textContent === 'Open in editor')
    expect(button).toBeDefined()
    button.click()
    expect(open).toHaveBeenCalledWith(EDITOR + ID)
  })

  it('no editor button when the result names no editor base, or the base is not https', () => {
    const row = draftRow(summary(), { editorBase: null, open: vi.fn(), view: vi.fn(), locale: 'en-US', now: NOW })
    expect([...row.querySelectorAll('button')].map((b) => b.textContent)).toEqual(['View thread'])
    const plain = draftRow(summary(), { editorBase: 'http://app.example/draft/', open: vi.fn(), view: vi.fn(), locale: 'en-US', now: NOW })
    expect(plain.textContent).not.toContain('Open in editor')
  })

  it('View thread calls the view with the row id', () => {
    const view = vi.fn()
    const root = render([summary()], vi.fn(), view)
    ;[...root.querySelectorAll('button')].find((b) => b.textContent === 'View thread').click()
    expect(view).toHaveBeenCalledWith(ID)
  })

  it('an id with path characters never makes an editor link outside the base', () => {
    const row = draftRow(summary({ id: '../../admin' }), { editorBase: EDITOR, open: vi.fn(), view: vi.fn(), locale: 'en-US', now: NOW })
    const url = EDITOR + encodeURIComponent('../../admin')
    expect(url.startsWith(EDITOR)).toBe(true)
    expect(row.querySelectorAll('button').length).toBeGreaterThan(0)
  })
})

describe('draft text is plain text (rule 9)', () => {
  it('renders markup in a title exactly as text', () => {
    const xss = '<img src=x onerror=alert(1)>'
    const root = render([summary({ title: xss })])
    expect(root.querySelector('img')).toBeNull()
    expect(root.querySelector('h2').textContent).toBe(xss)
  })
})

describe('the result', () => {
  it('reads the drafts and the editor base from a list_drafts result', () => {
    const list = listFrom({
      structuredContent: { drafts: [summary(), null] },
      _meta: { 'x-thread/editorBase': EDITOR }
    })
    expect(list.drafts).toHaveLength(1)
    expect(list.editorBase).toBe(EDITOR)
  })

  it('returns null for a result without a drafts list', () => {
    expect(listFrom({ structuredContent: { draft: {} } })).toBeNull()
  })

  it('shows the error text of an error result, or a fixed sentence', () => {
    expect(errorText({ content: [{ type: 'text', text: 'Nope' }] })).toBe('Nope')
    expect(errorText({ content: [] })).toBe('The tool returned an error.')
  })
})

describe('the view', () => {
  it('the drafts view is registered, and its HTML is under 64 KB', () => {
    const entry = listUiResources().find((e) => e.name === 'drafts')
    expect(entry.uri).toBe(uiResourceUri('drafts'))
    expect(entry.size).toBeLessThan(64 * 1024)
  })

  it('the drafts view runs the thread render functions it shares (no copy)', () => {
    const [view] = readUiResource(uiResourceUri('drafts'))
    expect(view.text).toContain('function renderThread(')
    expect(view.text).toContain('function draftRow(')
    expect(view.text).toContain('callTool')
  })
})
