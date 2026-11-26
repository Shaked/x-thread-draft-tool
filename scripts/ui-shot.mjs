#!/usr/bin/env node
// Screenshots of a list of routes, with a JSON report of everything that went wrong on the way.
// The skill `.claude/skills/ui-debug/SKILL.md` says when and how to use it.
//
//   node scripts/ui-shot.mjs --user admin --routes /,/admin,/admin/users --out test-results/ui-shot
//
// Needs the built app and the local API running (see the skill). Uses the pre-installed Chromium through Playwright.
// Writes <out>/<route>-<width>-<theme>-<lang>.png and <out>/report.json. Exit code 1 when a case has a failure.
/* global document, history, innerWidth, getComputedStyle, dispatchEvent, PopStateEvent -- the page functions run in the browser */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'

export const USERS = ['admin', 'user', 'out']
export const THEMES = ['light', 'dark']
export const LANGS = ['en', 'he']

const HELP = `Usage: node scripts/ui-shot.mjs --routes <a,b,c> [options]
  --routes   comma list of paths, e.g. /,/admin (required)
  --user     admin | user | out (default user). Signs in through the dev API; "out" stays signed out
  --widths   comma list of px widths (default 390,1280)
  --themes   light,dark (default light)
  --langs    en,he (default en); he sets dir=rtl and lang=he on the page root
  --base     app address (default XT_BASE_URL or http://127.0.0.1:4173)
  --out      folder for the shots and report.json (default test-results/ui-shot)
  --scale    device scale factor (default 1; use 2 for a shot a person will see)
  --inspect  CSS selector: its box and computed styles go in the report
  --allow    comma list of "<status> <path>" pairs that are not failures, e.g. "401 /api/auth/me"
  --stale-chunk  after the first route, answer every script file with the page, as a host does after a deploy
  --trace    on | off (default off): Playwright trace into <out>/trace-<case>.zip
  --no-fail  exit 0 even when a case has a failure`

const list = (value) => String(value ?? '').split(',').map((v) => v.trim()).filter(Boolean)
const oneOf = (name, values, allowed) => {
  const bad = values.filter((v) => !allowed.includes(v))
  if (values.length === 0 || bad.length) throw new Error(`--${name} takes ${allowed.join(', ')}; got "${values.join(',')}"`)
  return values
}
const parseWidths = (value) => {
  const widths = list(value).map(Number)
  if (widths.length === 0 || widths.some((w) => !Number.isInteger(w) || w < 200 || w > 4000)) throw new Error('--widths takes whole numbers from 200 to 4000')
  return widths
}
const parseScale = (value) => {
  if (![1, 2, 3].includes(Number(value))) throw new Error('--scale takes 1, 2 or 3')
  return Number(value)
}
const parseTrace = (value) => {
  if (!['on', 'off'].includes(value)) throw new Error('--trace takes on or off')
  return value === 'on'
}

// Options with a value: [key, parser]. Flags without a value are in FLAGS.
const VALUE_OPTIONS = {
  '--routes': ['routes', list],
  '--user': ['user', (v) => oneOf('user', [v], USERS)[0]],
  '--widths': ['widths', parseWidths],
  '--themes': ['themes', (v) => oneOf('themes', list(v), THEMES)],
  '--langs': ['langs', (v) => oneOf('langs', list(v), LANGS)],
  '--base': ['base', (v) => v.replace(/\/$/, '')],
  '--out': ['out', (v) => v],
  '--scale': ['scale', parseScale],
  '--inspect': ['inspect', (v) => v],
  '--allow': ['allow', list],
  '--trace': ['trace', parseTrace]
}
const FLAGS = { '--help': ['help', true], '-h': ['help', true], '--stale-chunk': ['staleChunk', true], '--no-fail': ['fail', false] }

export function parseArgs(argv) {
  const opts = {
    user: 'user', widths: [390, 1280], themes: ['light'], langs: ['en'], routes: [],
    base: process.env.XT_BASE_URL || 'http://127.0.0.1:4173', out: path.join('test-results', 'ui-shot'),
    scale: 1, inspect: null, allow: [], staleChunk: false, trace: false, fail: true, help: false
  }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (FLAGS[arg]) opts[FLAGS[arg][0]] = FLAGS[arg][1]
    else if (VALUE_OPTIONS[arg]) {
      if (argv[i + 1] === undefined) throw new Error(`${arg} needs a value`)
      opts[VALUE_OPTIONS[arg][0]] = VALUE_OPTIONS[arg][1](argv[++i])
    } else throw new Error(`Unknown option ${arg}`)
  }
  if (!opts.help && opts.routes.length === 0) throw new Error('--routes is required')
  for (const route of opts.routes) if (!route.startsWith('/')) throw new Error(`Route "${route}" must start with /`)
  return opts
}

// "/admin/users/42" -> "admin-users-42"; "/" -> "home"; a query stays in the name: "/?a=1" -> "a-1".
export function slug(route) {
  const clean = route.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
  return clean || 'home'
}

export function shotName(route, width, theme, lang) {
  return `${slug(route)}-${width}-${theme}-${lang}.png`
}

// Every combination, in a stable order: route, width, theme, language.
export function buildCases(opts) {
  const cases = []
  const used = new Set()
  const unique = (file) => {
    let name = file
    for (let n = 2; used.has(name); n++) name = file.replace(/\.png$/, `-${n}.png`)
    used.add(name)
    return name
  }
  for (const route of opts.routes)
    for (const width of opts.widths)
      for (const theme of opts.themes)
        for (const lang of opts.langs) cases.push({ route, width, theme, lang, file: unique(shotName(route, width, theme, lang)) })
  return cases
}

// "401 /api/auth/me" allows a 401 on that path; "failed /x.png" allows a request that never completed.
export function isAllowed(failure, allow) {
  return allow.some((entry) => {
    const [status, ...rest] = entry.trim().split(/\s+/)
    return status === String(failure.status) && rest.join(' ') === failure.path
  })
}

// A case fails on a page error, a console error, a request that failed or answered 4xx or 5xx (unless allowed),
// sideways scroll, or an empty page. Small targets are warnings: the strict check lives in the UI audit test.
// The browser's own messages when a script file is gone: expected in a stale tab run, where the page must instead show a message.
export const STALE_MESSAGES = /Failed to load module script|dynamically imported module|Unable to preload|Importing a module script failed|error loading dynamically imported/i

export function judge(entry, allow = []) {
  const problems = []
  const expected = (text) => entry.stale && STALE_MESSAGES.test(text)
  for (const e of entry.pageErrors) if (!expected(e)) problems.push(`page error: ${e}`)
  for (const e of entry.consoleErrors) if (!expected(e)) problems.push(`console error: ${e}`)
  if (entry.stale && !entry.recovery) problems.push('stale tab: no visible message or reload button after the script file failed')
  for (const f of entry.failedRequests) if (!isAllowed(f, allow)) problems.push(`request ${f.status} ${f.method} ${f.path}`)
  if (entry.overflowX > 0) problems.push(`sideways scroll: ${entry.overflowX}px wider than the screen`)
  if (entry.blank) problems.push('page is blank (no text and no controls)')
  const warnings = (entry.smallTargets ?? []).length ? [`${entry.smallTargets.length} touch targets under 44 px`] : []
  return { ...entry, problems, warnings, ok: problems.length === 0 }
}

export function summarize(entries, allow = []) {
  const cases = entries.map((e) => judge(e, allow))
  return {
    total: cases.length,
    failed: cases.filter((c) => !c.ok).length,
    warned: cases.filter((c) => c.warnings.length).length,
    ok: cases.every((c) => c.ok),
    cases
  }
}

export function formatReport(report) {
  const lines = [`${report.total - report.failed} of ${report.total} cases clean, ${report.failed} with problems, ${report.warned} with warnings`]
  for (const c of report.cases) {
    if (c.ok && c.warnings.length === 0) continue
    lines.push(`${c.ok ? 'WARN' : 'FAIL'} ${c.route} ${c.width}px ${c.theme} ${c.lang} (${c.file})`)
    for (const p of c.problems) lines.push(`  - ${p}`)
    for (const w of c.warnings) lines.push(`  - ${w}`)
  }
  return lines.join('\n')
}

// ---- Browser part (not unit tested: it needs a browser; tests/e2e/ui-shot.spec.ts runs it) ----

const STYLE_PROPS = ['display', 'position', 'overflow-x', 'padding-inline', 'margin-inline', 'gap', 'font-size', 'line-height', 'color', 'background-color', 'text-align']

async function signIn(context, opts, origin) {
  if (opts.user === 'out') return
  const res = await context.request.post(`${origin}/api/dev/session`, { data: { login: `ui-shot-${opts.user}`, admin: opts.user === 'admin' } })
  if (!res.ok()) throw new Error(`Dev sign-in answered ${res.status()}: is the local API running (npm run dev:api)?`)
  const cookie = res.headersArray().find((h) => h.name.toLowerCase() === 'set-cookie')?.value.match(/xt_session=([^;]+)/)?.[1]
  if (!cookie) throw new Error('Dev sign-in set no session cookie')
  await context.addCookies([{ name: 'xt_session', value: cookie, url: origin }])
}

async function measure(page, inspect) {
  return page.evaluate(({ inspect, props }) => {
    const root = document.documentElement
    const overflowX = Math.max(0, root.scrollWidth - root.clientWidth)
    const text = (document.body.innerText || '').trim()
    const controls = document.querySelectorAll('a[href], button, input, select, textarea').length
    const small = []
    const phone = innerWidth < 800 // the 44 px rule is for touch screens
    for (const el of document.querySelectorAll('a[href], button, input:not([type=hidden]), select, textarea, [role=button], [role=tab]')) {
      const r = el.getBoundingClientRect()
      const style = getComputedStyle(el)
      if (!phone || r.width === 0 || r.height === 0 || style.visibility === 'hidden') continue
      if (r.width < 44 || r.height < 44) small.push(`${el.tagName.toLowerCase()} "${(el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 30)}" ${Math.round(r.width)}x${Math.round(r.height)}`)
    }
    const inspected = inspect
      ? [...document.querySelectorAll(inspect)].slice(0, 20).map((el) => {
          const r = el.getBoundingClientRect()
          const s = getComputedStyle(el)
          return { box: { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) }, styles: Object.fromEntries(props.map((p) => [p, s.getPropertyValue(p)])) }
        })
      : null
    const recovery = !!document.querySelector('[role=alert]') || [...document.querySelectorAll('button, a')].some((el) => /reload|try again|refresh/i.test(el.textContent || ''))
    return { recovery, overflowX, blank: text === '' && controls === 0, smallTargets: small.slice(0, 50), inspected }
  }, { inspect, props: STYLE_PROPS })
}

// Playwright's own browser when it is installed; else the pre-installed Chromium (never run `playwright install`).
const PREINSTALLED_CHROMIUM = '/opt/pw-browsers/chromium'
async function launchBrowser(chromium) {
  const explicit = process.env.UI_SHOT_CHROMIUM
  if (explicit) return chromium.launch({ executablePath: explicit, args: ['--no-sandbox'] })
  try {
    return await chromium.launch()
  } catch (error) {
    if (!/Executable doesn't exist/.test(String(error.message)) || !existsSync(PREINSTALLED_CHROMIUM)) throw error
    return chromium.launch({ executablePath: PREINSTALLED_CHROMIUM, args: ['--no-sandbox'] })
  }
}

async function runCase(browser, c, opts, origin, apiOrigin) {
  const context = await browser.newContext({
    viewport: { width: c.width, height: c.width < 800 ? 844 : 800 }, deviceScaleFactor: opts.scale,
    hasTouch: c.width < 800, serviceWorkers: 'block', colorScheme: c.theme
  })
  try {
    if (opts.trace) await context.tracing.start({ screenshots: true, snapshots: true })
    await signIn(context, opts, opts.base)
    await context.route(`${origin}/api/**`, async (route) => {
      if (route.request().method() === 'GET') return route.continue()
      const response = await route.fetch({ headers: { ...route.request().headers(), origin: apiOrigin }, maxRedirects: 0 })
      return route.fulfill({ response })
    })
    const entry = { route: c.route, width: c.width, theme: c.theme, lang: c.lang, user: opts.user, stale: opts.staleChunk, file: c.file, consoleErrors: [], pageErrors: [], failedRequests: [] }
    const page = await context.newPage()
    page.on('console', (m) => { if (m.type() === 'error' && !/^Failed to load resource/.test(m.text())) entry.consoleErrors.push(m.text().slice(0, 300)) })
    page.on('pageerror', (e) => entry.pageErrors.push(String(e.message || e).slice(0, 300)))
    page.on('requestfailed', (r) => entry.failedRequests.push({ status: 'failed', method: r.method(), path: new URL(r.url()).pathname }))
    page.on('response', (r) => { if (r.status() >= 400) entry.failedRequests.push({ status: r.status(), method: r.request().method(), path: new URL(r.url()).pathname }) })
    await page.addInitScript(([theme, lang]) => {
      try { localStorage.setItem('xt-theme', theme) } catch { /* storage can be blocked */ }
      if (lang === 'he') document.addEventListener('DOMContentLoaded', () => { document.documentElement.setAttribute('dir', 'rtl'); document.documentElement.setAttribute('lang', 'he') })
    }, [c.theme, c.lang])
    if (opts.staleChunk) {
      // An old tab after a deploy: the entry loaded from "/", then the script files it asks for are gone and the host answers with the page.
      await page.goto(`${opts.base}/`, { waitUntil: 'networkidle' })
      await page.route(`${origin}/assets/**/*.js`, (route) => route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><html></html>' }))
      await page.evaluate((target) => { history.pushState({}, '', target); dispatchEvent(new PopStateEvent('popstate')) }, c.route)
      await page.waitForLoadState('networkidle').catch(() => {})
      // The notice renders after the failed import settles; a page with no alert is judged after the wait.
      await page.waitForFunction(() => document.querySelector('[role=alert]'), null, { timeout: 3000 }).catch(() => {})
    } else {
      await page.goto(`${opts.base}${c.route}`, { waitUntil: 'networkidle' })
    }
    Object.assign(entry, await measure(page, opts.inspect))
    await page.screenshot({ path: path.join(opts.out, c.file), fullPage: true })
    if (opts.trace) await context.tracing.stop({ path: path.join(opts.out, `trace-${c.file.replace(/\.png$/, '')}.zip`) })
    return entry
  } finally {
    await context.close()
  }
}

async function main() {
  const opts = parseArgs(process.argv.slice(2))
  if (opts.help) return console.log(HELP)
  const { chromium } = await import('@playwright/test')
  const origin = new URL(opts.base).origin
  // The dev API checks the Origin of writes against its own address; the preview is proxied to it.
  const apiOrigin = ['http://127.0.0.1:4173', 'http://localhost:4173'].includes(origin) ? 'http://127.0.0.1:8787' : origin
  mkdirSync(opts.out, { recursive: true })
  const browser = await launchBrowser(chromium)
  const entries = []
  try {
    for (const c of buildCases(opts)) {
      try {
        entries.push(await runCase(browser, c, opts, origin, apiOrigin))
      } catch (error) {
        // One case failing keeps the others: it becomes a problem in the report.
        entries.push({ route: c.route, width: c.width, theme: c.theme, lang: c.lang, user: opts.user, stale: false, file: c.file, consoleErrors: [], pageErrors: [`case did not finish: ${String(error.message).split('\n')[0]}`], failedRequests: [], overflowX: 0, blank: false, smallTargets: [] })
      }
    }
  } finally {
    await browser.close()
  }
  const report = summarize(entries, opts.allow)
  writeFileSync(path.join(opts.out, 'report.json'), `${JSON.stringify(report, null, 2)}\n`)
  console.log(formatReport(report))
  console.log(`Shots and report.json are in ${opts.out}`)
  if (!report.ok && opts.fail) process.exitCode = 1
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(`ui-shot: ${error.message}`)
    process.exitCode = 2
  })
}
