// T18 (#292): the host table and the thread view on three fixture hosts, run with jsdom: an MCP Apps host with
// hostContext, a ChatGPT-like stub with window.openai, and a bare host with neither. For each: the theme, the link
// method, the full-screen button and the insets.
import { JSDOM } from 'jsdom'
import { describe, expect, it, vi } from 'vitest'
import { hostInsets, hostMethod, hostRow, hostTable, hostTheme } from '../../server/mcp/ui/hosts.js'
import { THREAD_VIEW } from '../../server/mcp/ui/thread.js'

const CONTEXT = { theme: 'dark', safeAreaInsets: { top: 10, right: 20, bottom: 30, left: 40 } }
const RESULT = {
  structuredContent: { draft: { title: 'T', posts: [{ text: 'see https://x.com/a/status/1' }] } },
  _meta: {}
}

describe('hostTable and its functions', () => {
  it('has one row per host with a theme, link method, CSP key and insets, and full screen for ChatGPT', () => {
    for (const row of Object.values(hostTable())) {
      expect(['csp', 'insets', 'openLink', 'theme'].every((key) => key in row)).toBe(true)
    }
    expect(hostTable().openai.displayModes).toBe('requestDisplayMode')
    expect(hostTable().mcp.displayModes).toBeUndefined()
  })

  it('picks the row by window.openai', () => {
    expect(hostRow({}).openLink).toBe('ui/open-link')
    expect(hostRow({ openai: {} }).openLink).toBe('openExternal')
  })

  it('reads the theme from the host context or window.openai, and ignores other values', () => {
    expect(hostTheme({}, { theme: 'dark' })).toBe('dark')
    expect(hostTheme({ openai: { theme: 'light' } }, null)).toBe('light')
    expect(hostTheme({ openai: { theme: 'light' } }, { theme: 'dark' })).toBe('dark')
    expect(hostTheme({}, { theme: 'purple' })).toBeNull()
    expect(hostTheme({}, null)).toBeNull()
  })

  it('opens links with openExternal only when window.openai has it', () => {
    expect(hostMethod({}, 'openLink')).toBeNull()
    expect(hostMethod({ openai: {} }, 'openLink')).toBeNull()
    expect(hostMethod({ openai: { openExternal: () => {} } }, 'openLink')).toBe('openExternal')
  })

  it('offers full screen only when window.openai has requestDisplayMode', () => {
    expect(hostMethod({}, 'displayModes')).toBeNull()
    expect(hostMethod({ openai: {} }, 'displayModes')).toBeNull()
    expect(hostMethod({ openai: { requestDisplayMode: () => {} } }, 'displayModes')).toBe('requestDisplayMode')
  })

  it('clamps the insets and leaves out a side that is missing or out of range', () => {
    expect(hostInsets({}, CONTEXT)).toEqual({ top: 10, right: 20, bottom: 30, left: 40 })
    expect(hostInsets({}, { safeAreaInsets: { top: 5, left: 500, right: 'x' } })).toEqual({ top: 5 })
    expect(hostInsets({}, null)).toEqual({})
  })
})

// Runs the thread view's own script in a page of the given kind and sends the host's answers.
async function openView(kind) {
  const openExternal = vi.fn(() => Promise.resolve())
  const requestDisplayMode = vi.fn(() => Promise.resolve())
  const posted = []
  const dom = new JSDOM(THREAD_VIEW.html(null), {
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    beforeParse(win) {
      win.postMessage = (message) => posted.push(message)
      if (kind === 'chatgpt') win.openai = { theme: 'light', openExternal, requestDisplayMode }
    }
  })
  const win = dom.window
  const send = (data) => win.dispatchEvent(new win.MessageEvent('message', { data: { jsonrpc: '2.0', ...data }, source: win }))
  const init = posted.find((m) => m.method === 'ui/initialize')
  if (kind === 'mcp-apps' || kind === 'chatgpt') send({ id: init.id, result: { hostContext: kind === 'mcp-apps' ? CONTEXT : { safeAreaInsets: CONTEXT.safeAreaInsets }, hostCapabilities: {} } })
  send({ method: 'ui/notifications/tool-result', params: RESULT })
  await new Promise((resolve) => setTimeout(resolve, 0))
  return { win, posted, openExternal, requestDisplayMode }
}

const buttonNamed = (win, text) => [...win.document.querySelectorAll('button')].find((b) => b.textContent === text)

describe('the thread view on three fixture hosts', () => {
  it('an MCP Apps host: theme and insets from hostContext, links through ui/open-link, no full screen', async () => {
    const { win, posted } = await openView('mcp-apps')
    expect(win.document.documentElement.dataset.theme).toBe('dark')
    expect(win.document.documentElement.style.getPropertyValue('--safe-top')).toBe('10px')
    expect(win.document.documentElement.style.getPropertyValue('--safe-left')).toBe('40px')
    expect(buttonNamed(win, 'Full screen')).toBeUndefined()
    buttonNamed(win, 'https://x.com/a/status/1').click()
    expect(posted.some((m) => m.method === 'ui/open-link' && m.params.url === 'https://x.com/a/status/1')).toBe(true)
  })

  it('a ChatGPT-like host: theme from window.openai, links through openExternal, a full-screen button', async () => {
    const { win, posted, openExternal, requestDisplayMode } = await openView('chatgpt')
    expect(win.document.documentElement.dataset.theme).toBe('light')
    expect(win.document.documentElement.style.getPropertyValue('--safe-bottom')).toBe('30px')
    buttonNamed(win, 'https://x.com/a/status/1').click()
    expect(openExternal).toHaveBeenCalledWith({ href: 'https://x.com/a/status/1' })
    expect(posted.some((m) => m.method === 'ui/open-link')).toBe(false)
    buttonNamed(win, 'Full screen').click()
    expect(requestDisplayMode).toHaveBeenCalledWith({ mode: 'fullscreen' })
  })

  it('a bare host: no theme, no insets, no full screen, links through the bridge', async () => {
    const { win, posted } = await openView('bare')
    expect(win.document.documentElement.dataset.theme).toBeUndefined()
    expect(win.document.documentElement.style.getPropertyValue('--safe-top')).toBe('')
    expect(buttonNamed(win, 'Full screen')).toBeUndefined()
    buttonNamed(win, 'https://x.com/a/status/1').click()
    expect(posted.some((m) => m.method === 'ui/open-link')).toBe(true)
  })
})
