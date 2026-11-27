// Plan Task 1 step 7 (#170): the view code in jsdom. The source of every view must avoid the write paths that rule 9
// of docs/plans/mcp-apps.md bans; safeUrl refuses everything but https; draft text renders as plain text; the
// bridge starts the handshake and reports the tool result.
import './helpers/page-globals.js'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { bridge, el, renderThread, safeUrl } from '../../server/mcp/ui/client.js'
import { listUiResources, readUiResource } from '../../server/mcp/ui/index.js'

// Rule 9: no innerHTML, outerHTML, insertAdjacentHTML, document.write, eval, new Function, or on* attributes.
const BANNED = [/innerHTML/, /outerHTML/, /insertAdjacentHTML/, /document\.write/, /\beval\b/, /new Function/, /[\s"'<]on[a-z]+\s*=/i]
// Rule 10: nothing loaded from another host and no network calls from the view.
const NETWORK = [/<script[^>]*\ssrc=/i, /<link/i, /\bfetch\s*\(/, /XMLHttpRequest/, /WebSocket/]

// Every view (the thread view and the drafts list), each with the shared client source.
function viewSources() {
  // client.js, hosts.js and every renderer in render/ (#292): they are copied into the views, so the same rules apply.
  const dir = join(process.cwd(), 'server/mcp/ui')
  const files = ['client.js', 'hosts.js', ...readdirSync(join(dir, 'render')).map((name) => 'render/' + name)]
  const client = files.map((name) => readFileSync(join(dir, name), 'utf8')).join('\n')
  return listUiResources().map((entry) => ({ name: entry.name, html: readUiResource(entry.uri)[0].text, client }))
}

afterEach(() => {
  vi.restoreAllMocks()
  document.body.textContent = ''
})

describe('the view source (rules 9 and 10)', () => {
  it('contains none of the banned write paths', () => {
    for (const { name, html, client } of viewSources()) {
      for (const pattern of BANNED) {
        expect(html, `${name} view HTML matches ${pattern}`).not.toMatch(pattern)
        expect(client, `client.js matches ${pattern}`).not.toMatch(pattern)
      }
    }
  })

  it('loads nothing from another host and makes no network call', () => {
    for (const { name, html, client } of viewSources()) {
      for (const pattern of NETWORK) {
        expect(html, `${name} view HTML matches ${pattern}`).not.toMatch(pattern)
        expect(client, `client.js matches ${pattern}`).not.toMatch(pattern)
      }
    }
  })

  it('the list entry and the read content carry the same csp', () => {
    const [entry] = listUiResources()
    const [content] = readUiResource(entry.uri)
    expect(content._meta.ui.csp).toEqual(entry._meta.ui.csp)
  })
})

describe('safeUrl', () => {
  it('accepts https links', () => {
    expect(safeUrl('https://x.com/status/1', null)).toBe('https://x.com/status/1')
  })

  it('refuses javascript:, data:, http: and other schemes', () => {
    for (const url of ['javascript:alert(1)', 'data:text/html,hi', 'http://x.com/', 'ftp://x.com/', 'not a url']) {
      expect(safeUrl(url, null), url).toBeNull()
    }
  })

  it('refuses a host that is not on the list when a list is given', () => {
    expect(safeUrl('https://evil.example/', ['x.com'])).toBeNull()
    expect(safeUrl('https://x.com/', ['x.com'])).toBe('https://x.com/')
  })
})

describe('draft text is plain text', () => {
  it('renders markup in a post exactly as text', () => {
    const root = document.createElement('main')
    const text = '<img src=x onerror=alert(1)>'
    renderThread(root, { title: 'T', posts: [{ text }] })
    expect(root.querySelector('img')).toBeNull()
    expect(root.textContent).toContain(text)
  })

  it('el sets only the allowed attributes', () => {
    const node = el('p', { onclick: 'alert(1)', title: 'ok', class: 'x' }, ['hi'])
    expect(node.getAttribute('title')).toBe('ok')
    expect(node.hasAttribute('onclick')).toBe(false)
    expect(node.hasAttribute('class')).toBe(false)
  })

  it('el sets href only for https, and never src', () => {
    expect(el('a', { href: 'javascript:alert(1)' }, ['x']).hasAttribute('href')).toBe(false)
    expect(el('a', { href: 'http://x.com/' }, ['x']).hasAttribute('href')).toBe(false)
    expect(el('a', { href: 'https://x.com/' }, ['x']).getAttribute('href')).toBe('https://x.com/')
    expect(el('img', { src: 'https://x.com/a.png' }, []).hasAttribute('src')).toBe(false)
  })
})

describe('bridge handshake', () => {
  it('sends initialize, then initialized, and hands the tool result to the view', async () => {
    const postSpy = vi.spyOn(window, 'postMessage').mockImplementation(() => {})
    const result = vi.fn()
    const link = bridge({ result })

    expect(postSpy).toHaveBeenCalled()
    const init = postSpy.mock.calls[0][0]
    expect(init).toMatchObject({ jsonrpc: '2.0', id: 1, method: 'ui/initialize' })
    expect(init.params).toMatchObject({ protocolVersion: '2026-01-26', appCapabilities: {} })

    // The host answers; window is its own parent in jsdom, so the event source matches.
    window.dispatchEvent(new MessageEvent('message', { data: { jsonrpc: '2.0', id: 1, result: { hostContext: {} } }, source: window }))
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(postSpy.mock.calls.map((c) => c[0].method)).toContain('ui/notifications/initialized')

    const params = { structuredContent: { draft: { title: 'T', posts: [{ text: 'a' }] } } }
    window.dispatchEvent(new MessageEvent('message', { data: { jsonrpc: '2.0', method: 'ui/notifications/tool-result', params }, source: window }))
    expect(result).toHaveBeenCalledWith(params)
    expect(link.delivered()).toBe(true)
  })

  it('ignores a message whose source is not the parent frame', () => {
    const result = vi.fn()
    bridge({ result })
    window.dispatchEvent(
      new MessageEvent('message', { data: { jsonrpc: '2.0', method: 'ui/notifications/tool-result', params: {} }, source: null })
    )
    expect(result).not.toHaveBeenCalled()
  })
})
