import { describe, expect, it } from 'vitest'
import {
  extractTokenAndFormat,
  htmlEscape,
  htmlResponse,
  imageUrl,
  isRTL,
  linkify,
  renderEmbed,
  renderHtml,
  renderImages,
  renderMarkdown,
  renderText,
  textResponse,
  tweetIdFrom,
  type Payload,
  type Post
} from '../../supabase/functions/share/render.ts'

const VALID_TOKEN = '11111111-2222-3333-4444-555555555555'

describe('extractTokenAndFormat', () => {
  it('parses .md extension', () => {
    const u = new URL(`https://x.test/functions/v1/share/${VALID_TOKEN}.md`)
    expect(extractTokenAndFormat(u)).toEqual({ token: VALID_TOKEN, format: 'md' })
  })

  it('parses .html extension', () => {
    const u = new URL(`https://x.test/functions/v1/share/${VALID_TOKEN}.html`)
    expect(extractTokenAndFormat(u)).toEqual({ token: VALID_TOKEN, format: 'html' })
  })

  it('treats ?format=html as html even on extensionless paths', () => {
    const u = new URL(`https://x.test/functions/v1/share/${VALID_TOKEN}?format=html`)
    expect(extractTokenAndFormat(u)).toEqual({ token: VALID_TOKEN, format: 'html' })
  })

  it('lets ?format=html override a .md extension', () => {
    const u = new URL(`https://x.test/functions/v1/share/${VALID_TOKEN}.md?format=html`)
    expect(extractTokenAndFormat(u)).toEqual({ token: VALID_TOKEN, format: 'html' })
  })

  it('lets ?format=md override a .html extension', () => {
    const u = new URL(`https://x.test/functions/v1/share/${VALID_TOKEN}.html?format=md`)
    expect(extractTokenAndFormat(u)).toEqual({ token: VALID_TOKEN, format: 'md' })
  })

  it('defaults to md when no extension and no query param is given', () => {
    const u = new URL(`https://x.test/functions/v1/share/${VALID_TOKEN}`)
    expect(extractTokenAndFormat(u)).toEqual({ token: VALID_TOKEN, format: 'md' })
  })

  it('returns null token for non-UUID input', () => {
    const u = new URL('https://x.test/functions/v1/share/not-a-uuid.html')
    expect(extractTokenAndFormat(u)).toEqual({ token: null, format: 'html' })
  })

  it('returns null token for empty path', () => {
    const u = new URL('https://x.test/functions/v1/share/')
    expect(extractTokenAndFormat(u).token).toBeNull()
  })
})

describe('response builders', () => {
  it('htmlResponse sets Content-Type, Content-Disposition: inline and noindex', () => {
    const res = htmlResponse('<html></html>')
    expect(res.headers.get('Content-Type')).toBe('text/html; charset=utf-8')
    expect(res.headers.get('Content-Disposition')).toBe('inline')
    expect(res.headers.get('Cache-Control')).toBe('no-store')
    expect(res.headers.get('X-Robots-Tag')).toBe('noindex')
  })

  it('textResponse sets text/markdown content type', () => {
    const res = textResponse('# md')
    expect(res.headers.get('Content-Type')).toBe('text/markdown; charset=utf-8')
    expect(res.headers.get('Content-Disposition')).toBe('inline')
  })
})

describe('imageUrl', () => {
  it('handles string entries', () => {
    expect(imageUrl('https://example.com/a.png')).toBe('https://example.com/a.png')
  })

  it('handles object entries', () => {
    expect(imageUrl({ url: 'https://example.com/b.png' })).toBe('https://example.com/b.png')
  })

  it('returns null for missing/empty entries', () => {
    expect(imageUrl({} as never)).toBeNull()
    expect(imageUrl('' as never)).toBeNull()
  })
})

describe('htmlEscape', () => {
  it('escapes the five HTML-significant characters', () => {
    expect(htmlEscape(`<script>"&'</script>`)).toBe(
      '&lt;script&gt;&quot;&amp;&#39;&lt;/script&gt;'
    )
  })
})

describe('linkify', () => {
  it('wraps URLs in anchor tags with safe rel attributes', () => {
    const out = linkify('see https://example.com here')
    expect(out).toContain(
      '<a class="x-link" href="https://example.com" target="_blank" rel="noopener noreferrer">https://example.com</a>'
    )
  })

  it('preserves trailing punctuation outside the anchor', () => {
    const out = linkify('check https://example.com.')
    expect(out).toContain('href="https://example.com"')
    expect(out).toContain('</a>.')
  })
})

describe('renderText', () => {
  it('escapes HTML before linkifying so injected tags do not survive', () => {
    const out = renderText('<img src=x>')
    expect(out).toBe('&lt;img src=x&gt;')
    expect(out).not.toContain('<img')
  })

  it('renders newlines as <br>', () => {
    expect(renderText('a\nb')).toBe('a<br>b')
  })

  it('returns empty string for falsy input', () => {
    expect(renderText('')).toBe('')
  })
})

describe('isRTL', () => {
  it('detects Hebrew text', () => {
    expect(isRTL('שלום עולם')).toBe(true)
  })

  it('detects Arabic text', () => {
    expect(isRTL('مرحبا بالعالم')).toBe(true)
  })

  it('returns false for plain Latin text', () => {
    expect(isRTL('hello world')).toBe(false)
  })
})

describe('tweetIdFrom', () => {
  it('extracts the numeric status id', () => {
    expect(tweetIdFrom('https://x.com/jack/status/20')).toBe('20')
    expect(tweetIdFrom('https://twitter.com/jack/status/1234567890')).toBe('1234567890')
  })

  it('returns null when no status id is present', () => {
    expect(tweetIdFrom('https://example.com/foo')).toBeNull()
  })
})

describe('renderImages', () => {
  it('returns empty string for no images', () => {
    expect(renderImages([])).toBe('')
  })

  it('uses the one-image layout class for a single image', () => {
    const html = renderImages(['https://example.com/a.png'])
    expect(html).toContain('x-media-one')
    expect(html).toContain('href="https://example.com/a.png"')
  })

  it('uses two/three/four layout classes for multiple images', () => {
    const urls = ['1', '2', '3', '4'].map((n) => `https://example.com/${n}.png`)
    expect(renderImages(urls.slice(0, 2))).toContain('x-media-two')
    expect(renderImages(urls.slice(0, 3))).toContain('x-media-three')
    expect(renderImages(urls.slice(0, 4))).toContain('x-media-four')
  })

  it('skips empty entries', () => {
    const html = renderImages(['https://example.com/a.png', '' as never, { url: '' }])
    const matches = html.match(/<img /g) || []
    expect(matches.length).toBe(1)
  })
})

describe('renderEmbed', () => {
  it('renders a twitter blockquote when the URL has a status id', () => {
    const html = renderEmbed('https://twitter.com/jack/status/20')
    expect(html).toContain('class="twitter-tweet"')
    expect(html).toContain('href="https://twitter.com/jack/status/20"')
  })

  it('falls back to a plain link when the URL has no status id', () => {
    const html = renderEmbed('https://example.com/some-post')
    expect(html).toContain('x-embed-fallback')
    expect(html).not.toContain('twitter-tweet')
  })
})

describe('renderMarkdown', () => {
  it('formats a single post with title, numbering and trailing newline', () => {
    const md = renderMarkdown('My Thread', [{ text: 'Hello world' }])
    expect(md).toContain('# My Thread')
    expect(md).toContain('## 1/1')
    expect(md).toContain('Hello world')
  })

  it('emits image links and embed quotes', () => {
    const posts: Post[] = [
      {
        text: 'Look at this',
        images: ['https://example.com/a.png', { url: 'https://example.com/b.png' }],
        embeddedTweet: 'https://twitter.com/jack/status/20'
      }
    ]
    const md = renderMarkdown('T', posts)
    expect(md).toContain('![Image 1](https://example.com/a.png)')
    expect(md).toContain('![Image 2](https://example.com/b.png)')
    expect(md).toContain('> Embedded tweet: https://twitter.com/jack/status/20')
  })
})

function fullPayload(overrides: Partial<Payload> = {}): Payload {
  return {
    title: 'My thread',
    posts: [{ text: 'first post' }, { text: 'second post' }],
    author_name: 'Jane Doe',
    author_handle: 'janedoe',
    author_avatar: 'https://example.com/avatar.png',
    created_at: '2026-04-26T06:34:00Z',
    ...overrides
  }
}

describe('renderHtml', () => {
  it('produces a complete HTML document', () => {
    const html = renderHtml(fullPayload())
    expect(html.startsWith('<!doctype html>')).toBe(true)
    expect(html).toContain('</html>')
    expect(html).toContain('<title>My thread</title>')
    expect(html).toContain('noindex,nofollow')
  })

  it('renders one <article class="x-post"> per post', () => {
    const html = renderHtml(fullPayload())
    const articles = html.match(/<article class="x-post/g) || []
    expect(articles.length).toBe(2)
  })

  it('includes author name, handle and avatar', () => {
    const html = renderHtml(fullPayload())
    expect(html).toContain('Jane Doe')
    expect(html).toContain('@janedoe')
    expect(html).toContain('src="https://example.com/avatar.png"')
  })

  it('falls back to an initial avatar when no avatar URL is present', () => {
    const html = renderHtml(fullPayload({ author_avatar: null }))
    expect(html).toContain('x-avatar-fallback')
    expect(html).toContain('>J<')
  })

  it('marks RTL posts with dir="rtl"', () => {
    const html = renderHtml(
      fullPayload({ posts: [{ text: 'שלום עולם' }, { text: 'hello' }] })
    )
    expect(html).toMatch(/<article class="x-post[^"]*" dir="rtl"/)
    expect(html).toMatch(/<article class="x-post[^"]*" dir="ltr"/)
  })

  it('omits the embed widget script when no post embeds a tweet', () => {
    const html = renderHtml(fullPayload())
    expect(html).not.toContain('platform.twitter.com/widgets.js')
  })

  it('includes the embed widget script when at least one post embeds a tweet', () => {
    const html = renderHtml(
      fullPayload({
        posts: [{ text: 'see this', embeddedTweet: 'https://twitter.com/jack/status/20' }]
      })
    )
    expect(html).toContain('platform.twitter.com/widgets.js')
  })

  it('includes the verified badge SVG and action bar', () => {
    const html = renderHtml(fullPayload())
    expect(html).toContain('class="x-verified"')
    expect(html).toContain('class="x-actions"')
  })

  it('escapes author name and title to prevent injection', () => {
    const html = renderHtml(
      fullPayload({ title: '<script>alert(1)</script>', author_name: '"><img src=x>' })
    )
    expect(html).not.toContain('<script>alert(1)</script>')
    expect(html).not.toContain('<img src=x>')
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;')
  })

  it('marks the last post and not earlier ones with x-post-last', () => {
    const html = renderHtml(fullPayload())
    const lasts = html.match(/<article class="x-post x-post-last"/g) || []
    expect(lasts.length).toBe(1)
  })

  it('draws a thread connector line between posts but not after the final post', () => {
    const html = renderHtml(fullPayload())
    const lines = html.match(/<div class="x-thread-line"/g) || []
    expect(lines.length).toBe(1)
  })
})
