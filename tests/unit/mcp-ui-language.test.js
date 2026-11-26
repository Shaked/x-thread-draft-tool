// #371 (Task C2 of #273): the three MCP views in Hebrew, in jsdom. How the view picks the language (setLang), the Hebrew
// labels in the thread view, the drafts list and the share card, and that every label the code uses is in the table with
// both languages. The Playwright check in the fixture host is tests/e2e/mcp-ui-hebrew.spec.ts.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { draftRow, renderList } from '../../server/mcp/ui/drafts.js'
import { headerNode, labels, renderChanges, renderThread, setLang, threadFrom, tr } from '../../server/mcp/ui/client.js'
import { renderShare } from '../../server/mcp/ui/share.js'
import { createShareNode } from '../../server/mcp/ui/thread.js'
import { compact, minifyCss } from '../../server/mcp/ui/script.js'
import { readUiResource, uiResourceUri } from '../../server/mcp/ui/index.js'

const NOW = Date.parse('2026-11-19T12:00:00Z')
const DRAFT = '11111111-2222-4333-8444-555555555555'
const TOKEN = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'
const EDITOR = 'https://app.example/draft/'

beforeEach(() => {
  setLang('he', '')
})
afterEach(() => {
  setLang('en-US', '')
  vi.useRealTimers()
  vi.restoreAllMocks()
})

const thread = (overrides = {}) => ({
  title: 'כותרת',
  posts: [{ text: 'שלום עולם' }, { text: 'Second post' }],
  saved: true,
  is_published: true,
  url: `${EDITOR}${DRAFT}`,
  editorBase: EDITOR,
  counts: [{ chars: 300, over_limit: true }, { chars: 11, over_limit: false }],
  expand: () => {},
  ...overrides
})
const texts = (root) => [...root.querySelectorAll('button')].map((b) => b.textContent)

describe('how the view picks the language (one signal, in order)', () => {
  it('uses the host locale when the host sends one: he, iw and he-IL are Hebrew, any other locale is English', () => {
    for (const locale of ['he', 'he-IL', 'HE', 'iw']) expect(setLang(locale, 'Only English text')).toBe('he')
    for (const locale of ['en-US', 'fr', 'hebrew', 'ar']) expect(setLang(locale, 'שלום עולם')).toBe('en')
  })

  it('without a locale it uses the main script of the draft text, and English when there is none', () => {
    expect(setLang(undefined, 'שלום עולם, a post')).toBe('he')
    expect(setLang(undefined, 'Mostly English with one מילה')).toBe('en')
    expect(setLang('', 'שלום')).toBe('he')
    expect(setLang(undefined, '')).toBe('en')
    expect(setLang(null, undefined)).toBe('en')
  })

  it('Hebrew gives lang="he" and dir="rtl" on the page; English gives lang="en" and no dir', () => {
    setLang('he', '')
    expect(document.documentElement.getAttribute('lang')).toBe('he')
    expect(document.documentElement.getAttribute('dir')).toBe('rtl')
    setLang('en-US', '')
    expect(document.documentElement.getAttribute('lang')).toBe('en')
    expect(document.documentElement.hasAttribute('dir')).toBe(false)
  })
})

describe('the thread view in Hebrew', () => {
  it('shows the heading, the actions, the markers and the counter in Hebrew, and post text unchanged with dir auto', () => {
    const root = document.createElement('main')
    renderThread(root, thread(), vi.fn())
    const text = root.textContent
    for (const word of ['פוסטים', 'פורסם', 'תחילת השרשור', 'סוף השרשור', 'טיוטה', 'חריגה של 20']) expect(text).toContain(word)
    expect(texts(root)).toEqual(['פתח בעורך', 'מסך מלא'])
    expect(text).not.toMatch(/Open in editor|Full screen|Start of thread|End of thread|Published|posts/)
    const posts = [...root.querySelectorAll('article p[dir="auto"]')].map((p) => p.textContent)
    expect(posts).toEqual(['שלום עולם', 'Second post'])
  })

  it('says one post and the untitled and not-saved lines in Hebrew', () => {
    const root = document.createElement('main')
    renderThread(root, thread({ title: '', saved: false, is_published: false, posts: [{ text: 'a' }] }), vi.fn())
    expect(root.textContent).toContain('פוסט אחד')
    expect(root.textContent).toContain('טיוטה ללא כותרת')
    expect(root.textContent).toContain('עדיין לא נשמר.')
    renderThread(root, thread({ posts: [] }), vi.fn())
    expect(root.textContent).toContain('בטיוטה הזו אין פוסטים.')
  })

  it('the header of a long thread has the Hebrew "show all" button', () => {
    const posts = Array.from({ length: 30 }, (_, i) => ({ text: `p${i}` }))
    const root = document.createElement('main')
    renderThread(root, thread({ posts, counts: null }), vi.fn())
    expect(texts(root)).toContain('הצג את כל 30 הפוסטים')
  })

  it('the changes of an edit read in Hebrew, with the old text as text', () => {
    const changes = { version: 3, full: false, posts: [{ status: 'edited', index: 2, before: 'old', after: 'new' }, { status: 'removed', index: 4, before: 'gone' }] }
    const result = { structuredContent: { draft: { title: 'T', posts: [{ text: 'one' }, { text: 'new' }] } }, _meta: { 'x-thread/changes': changes } }
    const root = document.createElement('main')
    renderChanges(root, threadFrom(result), changes, vi.fn())
    for (const word of ['נשמר · גרסה 3 · 2 שונו', 'נערך: פוסט 2', 'לפני', 'הוסר: היה פוסט 4', 'טקסט']) expect(root.textContent).toContain(word)
  })

  it('English stays English when the page language is English', () => {
    setLang('en-US', '')
    const header = headerNode(thread(), vi.fn())
    expect(header.textContent).toContain('2 posts')
    expect(header.textContent).toContain('Published')
    expect(tr('thread', 'start')).toBe('Start of thread')
  })
})

describe('the drafts list in Hebrew', () => {
  const summary = (overrides = {}) => ({ id: DRAFT, title: 'שרשור', post_count: 1, total_chars: 1, over_limit_count: 2, image_count: 3, is_published: false, updated_at: '2026-11-19T10:00:00Z', ...overrides })

  it('shows the heading, the counts, the over-limit chip, the date and both buttons in Hebrew', () => {
    const root = document.createElement('main')
    renderList(root, { drafts: [summary()], editorBase: EDITOR }, { open: vi.fn(), view: vi.fn(), locale: 'he', now: NOW })
    expect(root.querySelector('h1').textContent).toBe('טיוטות')
    expect(root.textContent).toContain('פוסט אחד · תו אחד · 3 תמונות')
    expect(root.textContent).toContain('2 מעל 280')
    expect(root.textContent).toMatch(/עודכן .*(שעתיים|לפני)/)
    expect(texts(root)).toEqual(['פתח בעורך', 'הצג שרשור'])
    expect(root.querySelector('h2').getAttribute('dir')).toBe('auto')
  })

  it('says there are no drafts, an untitled draft and a published date in Hebrew', () => {
    const root = document.createElement('main')
    renderList(root, { drafts: [], editorBase: null }, { open: vi.fn(), view: vi.fn(), locale: 'he', now: NOW })
    expect(root.textContent).toContain('עדיין אין טיוטות')
    const row = draftRow(summary({ title: ' ', is_published: true, published_at: '2026-11-01T08:00:00Z' }), { editorBase: EDITOR, open: vi.fn(), view: vi.fn(), locale: 'he', now: NOW })
    expect(row.querySelector('h2').textContent).toBe('ללא כותרת')
    expect(row.textContent).toContain('פורסם ב')
  })
})

describe('the share card in Hebrew', () => {
  const share = { preview: `https://app.example/p/${TOKEN}`, markdown: `https://app.example/m/${TOKEN}.md`, expiresAt: NOW + 3600 * 1000, oneTime: true, token: TOKEN, draftId: DRAFT }

  it('shows the heading, both links, the status line and the buttons in Hebrew, with the URL fields left to right', () => {
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
    const root = document.createElement('main')
    renderShare(root, share, { open: vi.fn(), now: () => Date.now(), locale: 'he', revoke: vi.fn() })
    const text = root.textContent
    for (const word of ['קישור לשיתוף', 'קישור לתצוגה מקדימה', 'קישור ל-Markdown', 'עובד פעם אחת', 'התוקף יפוג בעוד 1:00:00']) expect(text).toContain(word)
    expect(texts(root)).toEqual(expect.arrayContaining(['פתח', 'עצור את הקישור הזה', 'כן, עצור את הקישור', 'ביטול']))
    expect(text).toContain('בטוח? הקישור יפסיק לעבוד מיד.')
    for (const field of root.querySelectorAll('input')) expect(field.getAttribute('dir')).toBe('ltr')
  })

  it('says Expired and Stopped in Hebrew', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
    const root = document.createElement('main')
    renderShare(root, { ...share, expiresAt: NOW - 1000 }, { open: vi.fn(), now: () => Date.now(), locale: 'he' })
    expect(root.textContent).toContain('פג תוקף')
    const live = document.createElement('main')
    renderShare(live, share, { open: vi.fn(), now: () => Date.now(), locale: 'he', revoke: vi.fn(() => Promise.resolve({ ok: true })) })
    const yes = [...live.querySelectorAll('button')].find((b) => b.textContent === 'כן, עצור את הקישור')
    yes.click()
    expect(live.textContent).toContain('ממתין לאישור שלך בצ׳אט')
    await vi.advanceTimersByTimeAsync(0)
    expect(live.textContent).toContain('נעצר')
  })

  it('the create button of the thread view is in Hebrew and says it waits for the OK', () => {
    const node = createShareNode({ id: DRAFT, share: { create: vi.fn(() => new Promise(() => {})), revoke: vi.fn(), locale: 'he' } }, vi.fn())
    expect(node.querySelector('button').textContent).toBe('צור קישור לשיתוף')
    node.querySelector('button').click()
    expect(node.textContent).toContain('ממתין לאישור שלך בצ׳אט')
  })
})

describe('the label table', () => {
  const read = (file) => readFileSync(join(process.cwd(), 'server/mcp/ui', file), 'utf8')
  const table = labels()

  it('every label the code asks for is in the table', () => {
    const missing = []
    for (const file of ['client.js', 'drafts.js', 'share-card.js', 'share.js', 'thread.js']) {
      for (const [, view, key] of [...read(file).matchAll(/\btr\('(\w+)', '(\w+)'/g)]) {
        if (!table[view] || !table[view][key]) missing.push(`${file}: ${view}.${key}`)
      }
    }
    expect(missing).toEqual([])
  })

  it('every key in the table is used by the code (no dead label)', () => {
    const source = ['client.js', 'drafts.js', 'share-card.js', 'share.js', 'thread.js'].map(read).join('\n')
    const dead = []
    for (const [view, keys] of Object.entries(table)) {
      for (const key of Object.keys(keys)) {
        const dynamic = /^(post|character|image)_(one|many)$/.test(key) || ['added', 'edited', 'moved'].includes(key)
        if (!dynamic && !source.includes(`'${view}', '${key}'`)) dead.push(`${view}.${key}`)
      }
    }
    expect(dead).toEqual([])
  })
})

describe('the served pages', () => {
  const page = (name) => readUiResource(uiResourceUri(name))[0].text
  const script = (html) => html.slice(html.indexOf('<script>') + 8, html.indexOf('</script>'))

  it('each page script is valid JavaScript with its own label sections, and carries the Hebrew of those sections only', () => {
    for (const name of ['thread', 'drafts', 'share']) {
      expect(() => new Function(script(page(name))), name).not.toThrow()
    }
    expect(page('thread')).toContain('תחילת השרשור')
    expect(page('thread')).toContain('קישור לשיתוף')
    expect(page('thread')).not.toContain('עדיין אין טיוטות')
    expect(page('drafts')).toContain('עדיין אין טיוטות')
    expect(page('drafts')).not.toContain('קישור לשיתוף')
    expect(page('share')).toContain('קישור לשיתוף')
    expect(page('share')).not.toContain('תחילת השרשור')
  })

  it('the pages start in English and nothing is loaded from another host', () => {
    for (const name of ['thread', 'drafts', 'share']) {
      const html = page(name)
      expect(html).toContain('<html lang="en">')
      expect(html).not.toMatch(/<script\s[^>]*src=|<link|http:\/\//i)
    }
  })

  it('the compacting keeps strings as they are and only removes layout', () => {
    expect(compact('a = 1;\n  // note\n\n  b = "x = y";', true)).toBe('a=1;\nb="x = y";')
    expect(compact('f(\n  a,\n  b\n)', true)).toBe('f(a,b)')
    expect(compact('x = a ? b : c // why\ny = 1')).toBe('x = a ? b : c // why\ny = 1')
    expect(() => compact('x = `a = ${b}`')).toThrow(/template literal/)
    expect(minifyCss('a  b { color : red; }\n/* c */ p { margin: 0 }')).toBe('a  b{color:red}p{margin:0}')
  })
})
