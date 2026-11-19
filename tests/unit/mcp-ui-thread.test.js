// Plan Task 3 (#173): the X-style thread view in jsdom. Counter text, the image rule (D4), the embedded tweet card
// (D5), long drafts, the banner for an unsaved text, and draft text as plain text in every place it can appear
// (rule 9). The Playwright check of the same view is in tests/e2e/mcp-thread-view.spec.ts.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { bridge, linksIn, renderThread, safeImage, threadFrom, tweetFrom } from '../../server/mcp/ui/client.js'
import { readUiResource, uiResourceUri } from '../../server/mcp/ui/index.js'

const BLOB = 'https://store1.public.blob.vercel-storage.com'
// The exact XSS sentence of plan Task 1 step 7 (git show 6d3f919:docs/plans/mcp-apps.md, line 98).
const XSS = '<img src=x onerror=alert(1)>'

function render(thread, open = vi.fn()) {
  const root = document.createElement('main')
  renderThread(root, thread, open)
  return root
}

afterEach(() => {
  vi.restoreAllMocks()
  document.body.textContent = ''
})

describe('threadFrom', () => {
  it('reads a saved draft with its counts, editor base and image origin from _meta', () => {
    const thread = threadFrom({
      structuredContent: { draft: { title: 'T', posts: [{ text: 'a' }], url: 'https://app.example/draft/1', is_published: true } },
      _meta: {
        'x-thread/outline': { posts: [{ chars: 3, over_limit: false }] },
        'x-thread/editorBase': 'https://app.example/draft/',
        'x-thread/imageOrigin': BLOB
      }
    })
    expect(thread).toMatchObject({ saved: true, is_published: true, editorBase: 'https://app.example/draft/', imageOrigin: BLOB })
    expect(thread.counts).toHaveLength(1)
  })

  it('reads a bare posts list as not saved, with no counts when the outline is missing', () => {
    expect(threadFrom({ structuredContent: { posts: [{ text: 'a' }] } })).toMatchObject({ saved: false, counts: null })
  })

  it('returns null for anything without posts', () => {
    expect(threadFrom({ structuredContent: { draft: { title: 'x' } } })).toBeNull()
    expect(threadFrom({})).toBeNull()
  })
})

describe('the counter (chars/280)', () => {
  it('shows chars/280 per post from the outline', () => {
    const root = render({ title: 'T', saved: true, posts: [{ text: 'a' }], counts: [{ chars: 120, over_limit: false }] })
    expect(root.querySelector('footer small').textContent).toBe('120/280')
  })

  it('turns red with "over by n" when over_limit', () => {
    const root = render({ title: 'T', saved: true, posts: [{ text: 'a' }], counts: [{ chars: 285, over_limit: true }] })
    expect(root.querySelector('footer strong').textContent).toBe('285/280 · over by 5')
  })

  it('is hidden when the outline is missing (split_text)', () => {
    const root = render({ title: 'T', saved: false, posts: [{ text: 'a' }], counts: null })
    expect(root.querySelector('footer')).toBeNull()
  })
})

describe('images (D4)', () => {
  it('loads an image only from the image origin the result names, with alt and lazy loading', () => {
    const root = render({
      title: 'T',
      saved: true,
      imageOrigin: BLOB,
      posts: [{ text: 'a', images: [{ url: `${BLOB}/drafts/u/1.png` }, { url: 'https://other.example/x.png' }] }]
    })
    const imgs = root.querySelectorAll('img')
    expect(imgs).toHaveLength(1)
    expect(imgs[0].getAttribute('src')).toBe(`${BLOB}/drafts/u/1.png`)
    expect(imgs[0].getAttribute('alt')).toBe('Image 1 of 2')
    expect(imgs[0].loading).toBe('lazy')
    // The other host becomes a link button, not an image.
    expect(root.querySelector('ol').textContent).toContain('https://other.example/x.png')
  })

  it('loads no image when the result names no image origin', () => {
    const root = render({ title: 'T', saved: true, imageOrigin: null, posts: [{ text: 'a', images: [`${BLOB}/a.png`] }] })
    expect(root.querySelector('img')).toBeNull()
  })

  it('refuses hostile image URLs, a wildcard origin and a non-https origin', () => {
    expect(safeImage('javascript:alert(1)', BLOB)).toBeNull()
    expect(safeImage(`"><img src=x onerror=alert(1)>`, BLOB)).toBeNull()
    expect(safeImage(`${BLOB}/a.png`, '*.public.blob.vercel-storage.com')).toBeNull()
    expect(safeImage(`${BLOB}/a.png`, 'http://store1.public.blob.vercel-storage.com')).toBeNull()
    expect(safeImage(`${BLOB}/a.png`, BLOB)).toBe(`${BLOB}/a.png`)
  })

  it('shows a hostile image URL as text in a button, never as an image', () => {
    const hostile = `https://evil.example/${XSS}`
    const root = render({ title: 'T', saved: true, imageOrigin: BLOB, posts: [{ text: 'a', images: [hostile] }] })
    expect(root.querySelector('img')).toBeNull()
    // The button shows the normalized https URL; the markup in it stays inside the URL, never an element.
    expect(root.querySelector('ol button').textContent).toBe(new URL(hostile).href)
  })
})

describe('draft text is plain text (rule 9)', () => {
  it('keeps the XSS sentence in the title, the text and an embedded tweet label as text', () => {
    const root = render({
      title: XSS,
      saved: true,
      posts: [{ text: XSS, embeddedTweet: `https://x.com/a/status/1?q=${XSS}` }]
    })
    expect(root.querySelector('img')).toBeNull()
    expect(root.textContent).toContain(XSS)
  })

  it('a tweet URL with markup in it is not a card: no element is made from it', () => {
    const card = tweetFrom('https://x.com/a"><img src=x onerror=alert(1)>/status/1')
    expect(card.label.includes('<img')).toBe(false)
    expect(tweetFrom('javascript:alert(1)')).toBeNull()
  })

  it('embedded tweets show a card with an Open on X button only for https', () => {
    const open = vi.fn(() => Promise.resolve())
    const root = render({ title: 'T', saved: true, posts: [{ text: 'a', embeddedTweet: 'https://x.com/jack/status/20' }] }, open)
    expect(root.querySelector('section p').textContent).toBe('@jack / status 20')
    root.querySelector('section button').click()
    expect(open).toHaveBeenCalledWith('https://x.com/jack/status/20')
  })
})

describe('links and direction', () => {
  it('finds https links in text, trims trailing punctuation and refuses other schemes', () => {
    expect(linksIn('see https://example.com/a. and http://x.example and javascript:alert(1)')).toEqual(['https://example.com/a'])
  })

  it('every post text has dir="auto" (Hebrew, English and mixed text)', () => {
    const root = render({ title: 'T', saved: true, posts: [{ text: 'שלום' }, { text: 'Hello' }, { text: 'שלום https://example.com' }] })
    const texts = [...root.querySelectorAll('article p[dir]')]
    expect(texts.map((p) => p.getAttribute('dir'))).toEqual(['auto', 'auto', 'auto'])
    expect(root.querySelector('article ul button').textContent).toBe('https://example.com/')
  })
})

describe('the header and long drafts', () => {
  it('shows Published only when the draft is published', () => {
    expect(render({ title: 'T', saved: true, is_published: true, posts: [{ text: 'a' }] }).textContent).toContain('Published')
    expect(render({ title: 'T', saved: true, is_published: false, posts: [{ text: 'a' }] }).textContent).not.toContain('Published')
  })

  it('offers Open in editor only for a draft URL under the editor base', () => {
    const base = 'https://app.example/draft/'
    const open = vi.fn(() => Promise.resolve())
    const ok = render({ title: 'T', saved: true, url: `${base}1`, editorBase: base, posts: [{ text: 'a' }] }, open)
    const bad = render({ title: 'T', saved: true, url: 'https://evil.example/1', editorBase: base, posts: [{ text: 'a' }] }, open)
    expect([...ok.querySelectorAll('button')].map((b) => b.textContent)).toContain('Open in editor')
    expect([...bad.querySelectorAll('button')].map((b) => b.textContent)).not.toContain('Open in editor')
  })

  it('says a text is not saved yet when it has no draft', () => {
    expect(render({ title: 'T', saved: false, posts: [{ text: 'a' }] }).textContent).toContain('Not saved yet.')
  })

  it('shows the first 25 posts, then all of them on "Show all"', () => {
    const posts = Array.from({ length: 30 }, (_, i) => ({ text: 'post ' + (i + 1) }))
    const root = render({ title: 'T', saved: true, posts })
    expect(root.querySelectorAll('article')).toHaveLength(25)
    const more = [...root.querySelectorAll('button')].find((b) => b.textContent === 'Show all 30 posts')
    more.click()
    expect(root.querySelectorAll('article')).toHaveLength(30)
  })
})

describe('the view size and host context', () => {
  it('the view HTML is under 48 KB', () => {
    const [view] = readUiResource(uiResourceUri('thread'))
    expect(Buffer.byteLength(view.text, 'utf8')).toBeLessThan(48 * 1024)
  })

  it('answers a request it does not handle with -32601, so the host does not wait', () => {
    const postSpy = vi.spyOn(window, 'postMessage').mockImplementation(() => {})
    bridge({})
    window.dispatchEvent(new MessageEvent('message', { data: { jsonrpc: '2.0', id: 42, method: 'sampling/createMessage' }, source: window }))
    expect(postSpy.mock.calls.map((c) => c[0])).toContainEqual({
      jsonrpc: '2.0',
      id: 42,
      error: { code: -32601, message: 'Method not found: sampling/createMessage' }
    })
  })

  it('the bridge hands host context to the view when it changes', () => {
    const context = vi.fn()
    bridge({ context })
    window.dispatchEvent(
      new MessageEvent('message', { data: { jsonrpc: '2.0', method: 'ui/notifications/host-context-changed', params: { theme: 'dark' } }, source: window })
    )
    expect(context).toHaveBeenLastCalledWith(expect.objectContaining({ theme: 'dark' }))
  })
})
