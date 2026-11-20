// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { htmlResponse, httpsUrl, renderHtml, SHARE_HTML_CSP } from '../../server/share/render.js'

const BAD = ['javascript:alert(1)', 'data:text/html,<script>1</script>', 'http://example.com/a.png', 'vbscript:msgbox(1)', 'not a url']

function render(post, avatar = null) {
  return renderHtml({ title: 't', posts: [post], author_name: 'A', author_handle: 'a', author_avatar: avatar, created_at: null })
}

describe('share HTML isolation', () => {
  it('httpsUrl accepts only https', () => {
    expect(httpsUrl('https://example.com/a.png')).toBe('https://example.com/a.png')
    for (const u of BAD) expect(httpsUrl(u)).toBeNull()
    expect(httpsUrl(undefined)).toBeNull()
  })

  it.each(BAD)('drops %s from image, embed and avatar', (bad) => {
    const html = render({ text: 'x', images: [bad], embeddedTweet: bad }, bad)
    expect(html).not.toContain('class="x-media')
    expect(html).not.toContain('class="x-embed')
    expect(html).not.toContain('<img class="x-avatar"')
    expect(html).not.toMatch(/(?:href|src)="(?:javascript|vbscript|data|http):/i)
    expect(html).not.toContain('javascript:')
  })

  it('still renders https image, embed and avatar', () => {
    const html = render(
      { text: 'x', images: ['https://example.com/a.png'], embeddedTweet: 'https://x.com/u/status/123' },
      'https://example.com/me.png'
    )
    expect(html).toContain('<img src="https://example.com/a.png"')
    expect(html).toContain('href="https://x.com/u/status/123" target="_blank" rel="noopener noreferrer">https://x.com/u/status/123</a>')
    expect(html).toContain('src="https://example.com/me.png"')
  })

  it('has no javascript: back link', () => {
    expect(render({ text: 'x' })).not.toContain('javascript:')
  })

  it('html responses carry the sandbox CSP', () => {
    const res = htmlResponse('<p>x</p>')
    expect(res.headers.get('content-security-policy')).toBe(SHARE_HTML_CSP)
    expect(SHARE_HTML_CSP).toContain('sandbox allow-popups allow-popups-to-escape-sandbox')
    expect(SHARE_HTML_CSP).not.toContain('allow-same-origin')
    expect(SHARE_HTML_CSP).not.toContain('allow-scripts')
  })
})
