// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { STALE_MESSAGES, buildCases, formatReport, isAllowed, judge, parseArgs, shotName, slug, summarize } from '../../scripts/ui-shot.mjs'

const clean = { route: '/', width: 390, theme: 'light', lang: 'en', file: 'home-390-light-en.png', consoleErrors: [], pageErrors: [], failedRequests: [], overflowX: 0, blank: false, smallTargets: [] }

describe('ui-shot arguments', () => {
  it('has defaults and needs routes', () => {
    expect(() => parseArgs([])).toThrow('--routes is required')
    const o = parseArgs(['--routes', '/,/admin'])
    expect(o).toMatchObject({ user: 'user', widths: [390, 1280], themes: ['light'], langs: ['en'], routes: ['/', '/admin'], scale: 1, fail: true, staleChunk: false })
  })
  it('reads every option', () => {
    const o = parseArgs(['--routes', '/a', '--user', 'admin', '--widths', '320,800', '--themes', 'light,dark', '--langs', 'en,he', '--scale', '2', '--inspect', 'nav', '--allow', '401 /api/x', '--stale-chunk', '--trace', 'on', '--no-fail', '--out', 'o', '--base', 'http://h/'])
    expect(o).toMatchObject({ user: 'admin', widths: [320, 800], themes: ['light', 'dark'], langs: ['en', 'he'], scale: 2, inspect: 'nav', allow: ['401 /api/x'], staleChunk: true, trace: true, fail: false, out: 'o', base: 'http://h' })
  })
  it('rejects bad values', () => {
    expect(() => parseArgs(['--routes', 'admin'])).toThrow('must start with /')
    expect(() => parseArgs(['--routes', '/', '--user', 'root'])).toThrow('--user takes')
    expect(() => parseArgs(['--routes', '/', '--widths', 'wide'])).toThrow('--widths')
    expect(() => parseArgs(['--routes', '/', '--themes', 'sepia'])).toThrow('--themes takes')
    expect(() => parseArgs(['--routes', '/', '--scale', '5'])).toThrow('--scale')
    expect(() => parseArgs(['--routes', '/', '--nope'])).toThrow('Unknown option')
    expect(() => parseArgs(['--routes'])).toThrow('needs a value')
  })
})

describe('ui-shot cases', () => {
  it('names files from the route', () => {
    expect(slug('/')).toBe('home')
    expect(slug('/admin/users/42')).toBe('admin-users-42')
    expect(slug('/?suspended=1')).toBe('suspended-1')
    expect(slug('/a?x=1')).not.toBe(slug('/a?x=2'))
    expect(shotName('/admin', 390, 'dark', 'he')).toBe('admin-390-dark-he.png')
  })
  it('builds every combination in a stable order', () => {
    const cases = buildCases(parseArgs(['--routes', '/,/a', '--widths', '390,1280', '--themes', 'light,dark']))
    expect(cases).toHaveLength(8)
    expect(cases[0]).toMatchObject({ route: '/', width: 390, theme: 'light', lang: 'en', file: 'home-390-light-en.png' })
    expect(cases[7]).toMatchObject({ route: '/a', width: 1280, theme: 'dark' })
    expect(new Set(cases.map((c) => c.file)).size).toBe(8)
  })
})

describe('ui-shot file names', () => {
  it('never writes two cases to one file', () => {
    const cases = buildCases(parseArgs(['--routes', '/a-b,/a/b,/a-b', '--widths', '390']))
    expect(new Set(cases.map((c) => c.file)).size).toBe(3)
    expect(cases.map((c) => c.file)).toEqual(['a-b-390-light-en.png', 'a-b-390-light-en-2.png', 'a-b-390-light-en-3.png'])
  })
})

describe('ui-shot stale tab', () => {
  const stale = { ...clean, stale: true, recovery: true, consoleErrors: ['Failed to load module script: Expected a JavaScript module', 'TypeError: Failed to fetch dynamically imported module: /assets/A.js'] }
  it('expects the module errors when a message shows', () => {
    expect(judge(stale)).toMatchObject({ ok: true, problems: [] })
  })
  it('fails when nothing tells the person', () => {
    expect(judge({ ...stale, recovery: false }).problems).toEqual(['stale tab: no visible message or reload button after the script file failed'])
  })
  it('still fails on other errors, and outside stale mode counts the module errors', () => {
    expect(judge({ ...stale, consoleErrors: ['boom'] }).problems).toEqual(['console error: boom'])
    expect(judge({ ...stale, stale: false, recovery: false }).problems).toHaveLength(2)
    expect(STALE_MESSAGES.test('Unable to preload CSS for /assets/x.css')).toBe(true)
  })
})

describe('ui-shot report', () => {
  it('passes a clean case', () => {
    expect(judge(clean)).toMatchObject({ ok: true, problems: [], warnings: [] })
  })
  it('fails on each kind of problem', () => {
    const bad = judge({
      ...clean, consoleErrors: ['boom'], pageErrors: ['TypeError: x'], overflowX: 12, blank: true,
      failedRequests: [{ status: 500, method: 'GET', path: '/api/admin/stats' }, { status: 'failed', method: 'GET', path: '/a.png' }]
    })
    expect(bad.ok).toBe(false)
    expect(bad.problems).toEqual([
      'page error: TypeError: x', 'console error: boom', 'request 500 GET /api/admin/stats', 'request failed GET /a.png',
      'sideways scroll: 12px wider than the screen', 'page is blank (no text and no controls)'
    ])
  })
  it('allows a named request and nothing else', () => {
    const entry = { ...clean, failedRequests: [{ status: 401, method: 'GET', path: '/api/auth/me' }, { status: 401, method: 'GET', path: '/api/drafts' }] }
    expect(isAllowed(entry.failedRequests[0], ['401 /api/auth/me'])).toBe(true)
    expect(isAllowed(entry.failedRequests[0], ['500 /api/auth/me'])).toBe(false)
    expect(judge(entry, ['401 /api/auth/me']).problems).toEqual(['request 401 GET /api/drafts'])
  })
  it('only warns about small targets', () => {
    const r = judge({ ...clean, smallTargets: ['a "x" 20x20'] })
    expect(r.ok).toBe(true)
    expect(r.warnings).toEqual(['1 touch targets under 44 px'])
  })
  it('summarizes and prints', () => {
    const report = summarize([clean, { ...clean, route: '/admin', file: 'admin.png', consoleErrors: ['boom'] }, { ...clean, smallTargets: ['b'] }])
    expect(report).toMatchObject({ total: 3, failed: 1, warned: 1, ok: false })
    const text = formatReport(report)
    expect(text).toContain('2 of 3 cases clean, 1 with problems, 1 with warnings')
    expect(text).toContain('FAIL /admin 390px light en (admin.png)')
    expect(text).toContain('  - console error: boom')
    expect(text).toContain('WARN / 390px light en')
    expect(summarize([clean]).ok).toBe(true)
  })
})
