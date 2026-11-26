// UI audit (plan docs/plans/ui-design-system.md, section 6, item 3). Runs in the required e2e job; no person needed.
// For every page in MIGRATED: 390 px with touch (phone), 1280 px, light and dark, and a right-to-left pass at 390 px.
// Each case checks: no horizontal scroll; 44 x 44 targets on phones; computed styles of ui- elements on the
// type, radius and space scales and in the current theme's colours; axe (WCAG 2.2 AA) with no serious or critical issue.
// Screenshots go to test-results/ui-audit/ and are uploaded as a CI artifact.

import AxeBuilder from '@axe-core/playwright'
import { expect, test, type APIRequestContext, type Browser, type BrowserContext, type Page } from '@playwright/test'
import { mkdirSync, readFileSync } from 'node:fs'
import path from 'node:path'

const BASE = process.env.XT_BASE_URL ?? 'http://localhost:4173'
const ORIGIN = new URL(BASE).origin
const OUT = path.join('test-results', 'ui-audit')

// Pages under audit. A page joins when its migration PR lands (plan section 5, rules for every migration PR).
// `drafts` are seeded for that page's user (the draft list with rows, one Hebrew title for the RTL pass).
const MIGRATED: { name: string; path: string; drafts?: Seed[]; menu?: boolean; skin?: 'rare'; kit?: 'rare' }[] = [
  { name: 'about', path: '/about' },
  { name: 'flags', path: '/admin/flags' },
  { name: 'changelog', path: '/admin/changelog' },
  { name: 'admin-stats', path: '/admin' },
  { name: 'admin-metrics', path: '/admin/metrics' },
  { name: 'tokens', path: '/settings/tokens' },
  { name: 'apps', path: '/settings/apps' },
  { name: 'drafts-empty', path: '/' },
  {
    name: 'drafts',
    path: '/',
    drafts: [
      { title: 'שרשור לדוגמה', posts: [{ id: 'h1', text: 'טקסט בעברית', images: [], embeddedTweet: null }] },
      { title: 'Second thread', posts: [{ id: 'e1', text: 'Some text', images: [], embeddedTweet: null }] }
    ]
  },
  // The editor page (plan T9): one draft with an English post and a Hebrew post, so the RTL pass shows Hebrew text.
  {
    name: 'editor',
    path: '/draft/:first',
    drafts: [
      {
        title: 'Editor audit',
        posts: [
          { id: 'a1', text: 'First post, in English.', images: [], embeddedTweet: null },
          { id: 'a2', text: 'פוסט שני בעברית', images: [], embeddedTweet: null }
        ]
      }
    ]
  },
  // The optional Rare UI look (feature flag, #406): the same checks with xt-skin=rare on the new page and two main pages.
  { name: 'flags-rare', path: '/admin/flags', skin: 'rare' },
  {
    name: 'drafts-rare',
    path: '/',
    skin: 'rare',
    drafts: [
      { title: 'שרשור לדוגמה', posts: [{ id: 'h1', text: 'טקסט בעברית', images: [], embeddedTweet: null }] },
      { title: 'Second thread', posts: [{ id: 'e1', text: 'Some text', images: [], embeddedTweet: null }] }
    ]
  },
  {
    name: 'editor-rare',
    path: '/draft/:first',
    skin: 'rare',
    drafts: [
      {
        title: 'Editor audit',
        posts: [
          { id: 'a1', text: 'First post, in English.', images: [], embeddedTweet: null },
          { id: 'a2', text: 'פוסט שני בעברית', images: [], embeddedTweet: null }
        ]
      }
    ]
  },
  // The real Rare UI components (feature flag "Components", #406): the theme selector in the open menu, with the
  // purple look and with the Rare UI look; Delete draft in the list, with both looks.
  { name: 'drafts-menu-kit', path: '/', menu: true, kit: 'rare', drafts: [{ title: 'Second thread', posts: [{ id: 'e1', text: 'Some text', images: [], embeddedTweet: null }] }] },
  { name: 'drafts-menu-kit-rare', path: '/', menu: true, kit: 'rare', skin: 'rare', drafts: [{ title: 'Second thread', posts: [{ id: 'e1', text: 'Some text', images: [], embeddedTweet: null }] }] },
  {
    name: 'drafts-kit',
    path: '/',
    kit: 'rare',
    drafts: [
      { title: 'שרשור לדוגמה', posts: [{ id: 'h1', text: 'טקסט בעברית', images: [], embeddedTweet: null }] },
      { title: 'Second thread', posts: [{ id: 'e1', text: 'Some text', images: [], embeddedTweet: null }] }
    ]
  },
  {
    name: 'drafts-kit-rare',
    path: '/',
    kit: 'rare',
    skin: 'rare',
    drafts: [{ title: 'Second thread', posts: [{ id: 'e1', text: 'Some text', images: [], embeddedTweet: null }] }]
  },
  // The same page with the menu drawer open.
  {
    name: 'drafts-menu',
    path: '/',
    menu: true,
    drafts: [{ title: 'Second thread', posts: [{ id: 'e1', text: 'Some text', images: [], embeddedTweet: null }] }]
  }
]

// Targets allowed under 44 x 44, each with its reason. The "Show toolbar" tab is 44 wide and at most 36 high on purpose.
const EXEMPT_TARGETS = [
  { selector: '.app-bar-toggle', reason: 'the "Show toolbar" tab is at most 36 px high; tests/e2e/app-bar.spec.ts pins it' }
]

// No axe rule is disabled: index.html allows pinch zoom (plan task U5 removed maximum-scale and user-scalable=no).
const AXE_DISABLED: string[] = []
const AXE_TAGS = ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']

// The scales from src/styles/tokens.css, in px (rem values in the file are 16 px).
const FONT_PX = [12, 14, 16, 18, 20, 24, 28]
const SPACE_PX = [0, 4, 8, 12, 16, 20, 24, 32, 40, 48, 64]
const RADIUS_PX = [0, 6, 10, 14, 20, 999]
// The Rare UI look (feature flag) has one extra radius: --radius-sm is 4 px there (6, 10 and 14 are on the default scale too).
const RADIUS_PX_RARE = [...RADIUS_PX, 4]

// Every colour token name in tokens.css (read once; the colour values come from the page through a probe element).
const TOKEN_COLOURS = [...new Set([...readFileSync(path.join('src', 'styles', 'tokens.css'), 'utf8').matchAll(/--color-[\w-]+(?=:)/g)].map((m) => m[0]))]

const CASES = [
  { name: '390-light', width: 390, theme: 'light', rtl: false },
  { name: '390-dark', width: 390, theme: 'dark', rtl: false },
  { name: '1280-light', width: 1280, theme: 'light', rtl: false },
  { name: '1280-dark', width: 1280, theme: 'dark', rtl: false },
  { name: '390-rtl', width: 390, theme: 'light', rtl: true }
]

// Hebrew text for the right-to-left pass (the changelog is the only page with user text to show).
const HEBREW_CHANGELOG = {
  entries: [
    {
      id: '20261121-120000-hebrew',
      date: '2026-11-21T12:00:00Z',
      title: 'שינויים חדשים בעברית',
      summary: 'הדף הזה מציג את השינויים האחרונים באפליקציה, מהחדש לישן.'
    },
    {
      id: '20261120-090000-hebrew-older',
      date: '2026-11-20T09:00:00Z',
      title: 'תיקון קטן בטיוטות',
      summary: 'טיוטה עם מילה באנגלית, Thread, וכמה שורות בעברית.'
    }
  ],
  next: null
}

async function devToken(request: APIRequestContext, login: string, admin = false): Promise<string> {
  const res = await request.post(`${BASE}/api/dev/token`, { data: { login, admin } })
  expect(res.ok()).toBeTruthy()
  return (await res.json()).token as string
}

type Seed = { title: string; posts: unknown[] }
const ADMIN_STATS = {
  stats: {
    users: 12, users_suspended: 1, drafts: 40, published_drafts: 9, posts: 130, images: 7, api_tokens_active: 3, connected_apps: 2,
    share_links_active: 4, mcp_calls_24h: 210, mcp_calls_7d: 1500, active_users_24h: 5, active_users_7d: 9,
    signups_by_day: Array.from({ length: 30 }, (_, i) => ({ day: `2026-11-${String(i + 1).padStart(2, '0')}`, signups: i % 3 }))
  }
}

// A fixed answer for the metrics page (#337): one group for the whole window, two routes, two tools, and the same points for each series.
const metricGroup = (route: string, op: string, count: number) => ({
  group: { route, op, caller: 'all' }, count, errors: { '4xx': 3, '429': 1, '5xx': 2, tool_error: 0 },
  p50: 8.4, p90: 15.9, p95: count > 50 ? 22.4 : null, p99: null, p99_9: null
})
const metricsAnswer = (by: string) => ({
  metrics:
    by === 'total' ? [metricGroup('all', '-', 100)]
    : by === 'route' ? [metricGroup('GET /drafts', '-', 60), metricGroup('GET /me', '-', 40)]
    : [metricGroup('all', 'tool:list_drafts', 7), metricGroup('all', 'tools/list', 2)]
})
const metricsSeries = (name: string) => ({
  name, grain: 'hour',
  points: Array.from({ length: 24 }, (_, i) => ({ at: `2026-11-25T${String(i).padStart(2, '0')}:00:00Z`, value: (i * 7) % 11, p95: i % 5 === 0 ? null : 10 + (i % 7) }))
})

async function openPage(browser: Browser, request: APIRequestContext, pagePath: string, c: (typeof CASES)[number], extra: { heading?: string; drafts?: Seed[]; menu?: boolean; skin?: 'rare'; kit?: 'rare' } = {}) {
  const phone = c.width < 800
  const context: BrowserContext = await browser.newContext({
    viewport: { width: c.width, height: phone ? 844 : 800 },
    isMobile: phone,
    hasTouch: phone,
    reducedMotion: 'reduce',
    serviceWorkers: 'block'
  })
  // The changelog is admin only (#368): its check signs in as the admin.
  const token = await devToken(request, `ui-audit-${c.name}-${Date.now()}`, pagePath === '/admin/changelog')
  const hebrew = c.rtl && pagePath === '/admin/changelog'
  const asAdmin = pagePath.startsWith('/admin') || Boolean(extra.skin || extra.kit)
  // Signed-in pages: the dev token goes out as a bearer header. The Hebrew pass answers the changelog itself.
  await context.route(`${ORIGIN}/api/**`, (route) => {
    if (hebrew && new URL(route.request().url()).pathname === '/api/changelog') {
      return route.fulfill({ json: HEBREW_CHANGELOG })
    }
    // The admin pages and the Rare UI flags (admin only, #483) need the admin's browser session (a bearer token never passes):
    // answer the calls they make. The flags answer from the seeded skin and kit, as the account would.
    if (asAdmin) {
      const url = new URL(route.request().url())
      if (url.pathname === '/api/auth/me') {
        return route.fetch({ headers: { ...route.request().headers(), authorization: `Bearer ${token}` } }).then(async (res) => {
          const body = await res.json()
          return route.fulfill({ response: res, json: { ...body, user: { ...body.user, role: 'admin' } } })
        })
      }
      if (url.pathname === '/api/admin/stats') return route.fulfill({ json: ADMIN_STATS })
      if (url.pathname === '/api/admin/metrics') return route.fulfill({ json: metricsAnswer(url.searchParams.get('by') ?? 'route') })
      if (url.pathname === '/api/admin/metrics/series') return route.fulfill({ json: metricsSeries(url.searchParams.get('name') ?? 'requests') })
      if (url.pathname === '/api/admin/flags') {
        const flag = (name: string, value?: string) => ({ name, value: value ?? 'default', values: ['default', 'rare'], default: 'default', meaning: '' })
        return route.fulfill({ json: { flags: [flag('look', extra.skin), flag('components', extra.kit)] } })
      }
    }
    return route.continue({ headers: { ...route.request().headers(), authorization: `Bearer ${token}` } })
  })
  // A path with ':first' names the first seeded draft (the editor page).
  let firstDraftId = ''
  for (const draft of extra.drafts ?? []) {
    const res = await request.post(`${BASE}/api/drafts`, { data: draft, headers: { authorization: `Bearer ${token}` } })
    expect(res.ok()).toBeTruthy()
    firstDraftId ||= ((await res.json()) as { draft: { id: string } }).draft.id
  }
  const page = await context.newPage()
  await page.addInitScript((value) => localStorage.setItem('xt-theme', value), c.theme)
  if (extra.skin) await page.addInitScript((value) => localStorage.setItem('xt-skin', value), extra.skin)
  if (extra.kit) await page.addInitScript((value) => localStorage.setItem('xt-kit', value), extra.kit)
  await page.goto(`${BASE}${pagePath.replace(':first', firstDraftId)}`, { waitUntil: 'networkidle' })
  await expect(extra.heading ? page.getByRole('heading', { name: extra.heading, level: 1 }) : page.getByRole('heading', { level: 1 })).toBeVisible()
  await expect(page.getByText('Loading…')).toHaveCount(0)
  // The metrics page loads its numbers after the shell: audit the tables and the chart, not the error banner.
  if (pagePath === '/admin/metrics') await expect(page.getByRole('heading', { name: 'All routes' })).toBeVisible()
  if (c.rtl) await page.evaluate(() => document.documentElement.setAttribute('dir', 'rtl'))
  // The menu drawer (a Dialog on the start edge) is audited open, so its targets, type and colours are checked too.
  if (extra.menu) {
    await page.getByRole('button', { name: 'Menu', exact: true }).click()
    await expect(page.locator('#app-menu')).toBeVisible()
    await page.waitForTimeout(300)
  }
  // A Rare UI component loads in its own chunk: wait until it has replaced the current one.
  if (extra.kit) await expect(page.locator('[class*="ui-rare-"]').first()).toBeVisible()
  return { context, page }
}

// Phones only: every visible control is at least 44 x 44 (inline links inside text and EXEMPT_TARGETS excepted).
async function smallTargets(page: Page): Promise<string[]> {
  return page.evaluate((exempt: string[]) => {
    const found: string[] = []
    const controls = 'button, a, input, select, textarea, [role=tab], [role=menuitem], [role=switch]'
    for (const el of document.querySelectorAll(controls)) {
      if (exempt.some((selector) => el.matches(selector))) continue
      if (el.tagName === 'A' && !el.classList.contains('ui-button') && el.closest('p, li')) continue
      const box = el.getBoundingClientRect()
      if (box.width === 0 || box.height === 0 || getComputedStyle(el).visibility === 'hidden') continue
      if (box.width < 44 || box.height < 44) {
        const label = (el.textContent || el.getAttribute('aria-label') || '').trim().slice(0, 40)
        found.push(`${el.tagName.toLowerCase()} "${label}" ${Math.round(box.width)}x${Math.round(box.height)}`)
      }
    }
    return found
  }, EXEMPT_TARGETS.map((entry) => entry.selector))
}

// Every ui- element: type, radius and space on their scales; colours equal a --color token of this theme, or transparent.
async function scaleAndColourProblems(page: Page, scope = '[class*="ui-"]', radii = RADIUS_PX): Promise<string[]> {
  return page.evaluate(
    ({ names, font, space, radius, scope }: { names: string[]; font: number[]; space: number[]; radius: number[]; scope: string }) => {
      // Resolves each colour token through the page's current theme (light-dark() depends on color-scheme).
      const probe = document.createElement('span')
      document.body.appendChild(probe)
      const allowed = new Set<string>(['rgba(0, 0, 0, 0)'])
      for (const name of names) {
        probe.style.color = `var(${name})`
        allowed.add(getComputedStyle(probe).color)
      }
      probe.remove()

      const problems: string[] = []
      const px = (value: string) => parseFloat(value)
      const sides = ['Top', 'Right', 'Bottom', 'Left']
      for (const el of document.querySelectorAll(scope)) {
        const style = getComputedStyle(el)
        const who = [...el.classList].filter((c) => c.startsWith('ui-')).join('.')
        const report = (what: string) => problems.push(`${who}: ${what}`)
        if (!font.includes(px(style.fontSize))) report(`font-size ${style.fontSize}`)
        for (const corner of ['borderTopLeftRadius', 'borderTopRightRadius', 'borderBottomLeftRadius', 'borderBottomRightRadius']) {
          if (!radius.includes(px(style[corner as 'borderTopLeftRadius']))) report(`${corner} ${style[corner as 'borderTopLeftRadius']}`)
        }
        for (const side of sides) {
          const value = style[`padding${side}` as 'paddingTop']
          if (!space.includes(px(value))) report(`padding-${side.toLowerCase()} ${value}`)
        }
        for (const gap of ['rowGap', 'columnGap'] as const) {
          if (style[gap] !== 'normal' && !space.includes(px(style[gap]))) report(`${gap} ${style[gap]}`)
        }
        for (const prop of ['color', 'backgroundColor'] as const) {
          if (!allowed.has(style[prop])) report(`${prop} ${style[prop]}`)
        }
        for (const side of sides) {
          const width = style[`border${side}Width` as 'borderTopWidth']
          const colour = style[`border${side}Color` as 'borderTopColor']
          if (px(width) > 0 && !allowed.has(colour)) report(`border-${side.toLowerCase()} colour ${colour}`)
        }
      }
      return problems
    },
    { names: TOKEN_COLOURS, font: FONT_PX, space: SPACE_PX, radius: radii, scope }
  )
}

test.describe('UI audit', () => {
  test.setTimeout(180_000)
  mkdirSync(OUT, { recursive: true })

  for (const pageInfo of MIGRATED) {
    for (const c of CASES) {
      test(`${pageInfo.name} at ${c.name}`, async ({ browser, request }) => {
        const { context, page } = await openPage(browser, request, pageInfo.path, c, { drafts: pageInfo.drafts, menu: pageInfo.menu, skin: pageInfo.skin, kit: pageInfo.kit })
        try {
          // No horizontal scroll (plan: scrollWidth <= innerWidth).
          const widths = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, inner: window.innerWidth }))
          expect(widths.scroll, 'horizontal scroll').toBeLessThanOrEqual(widths.inner)

          // Guards: the checks below must see something, or a green run would prove nothing.
          expect(await page.locator('[class*="ui-"]').count(), 'ui- elements on the page').toBeGreaterThan(0)

          if (c.width < 800) {
            expect(await page.locator('button, a').count(), 'controls on the page').toBeGreaterThan(0)
            expect(await smallTargets(page), 'targets under 44 x 44').toEqual([])
          }

          expect(await scaleAndColourProblems(page, undefined, pageInfo.skin ? RADIUS_PX_RARE : RADIUS_PX), 'ui- elements off the scale or the theme colours').toEqual([])

          const axe = await new AxeBuilder({ page }).withTags(AXE_TAGS).disableRules(AXE_DISABLED).analyze()
          const serious = axe.violations
            .filter((v) => v.impact === 'serious' || v.impact === 'critical')
            .map((v) => `${v.id} (${v.impact}): ${v.nodes.map((n) => n.target.join(' ')).slice(0, 3).join(' | ')}`)
          expect(axe.passes.length, 'axe rules that passed').toBeGreaterThan(0)
          expect(serious, 'axe serious or critical').toEqual([])

          await page.screenshot({ path: path.join(OUT, `${pageInfo.name}-${c.name}.png`), fullPage: true })
        } finally {
          await context.close()
        }
      })
    }
  }

  // The confirm dialog (plan task U5): delete asks on the draft list. Checks the dialog on its own (the list behind it is
  // not migrated yet): scale and colours, axe, 44 px buttons on phones, then the keyboard (focus on Cancel, Tab stays inside,
  // Escape closes, focus returns to the opener). The draft title is Hebrew, so the RTL pass shows real Hebrew text.
  for (const c of CASES) {
    test(`delete dialog at ${c.name}`, async ({ browser, request }) => {
      const { context, page } = await openPage(browser, request, '/', c, { heading: 'Your Threads', drafts: [{ title: 'שרשור לדוגמה', posts: [{ id: 'h1', text: 'טקסט בעברית', images: [], embeddedTweet: null }] }] })
      try {
        const opener = page.getByRole('button', { name: 'Delete draft' }).first()
        await opener.click()
        const dialog = page.getByRole('dialog', { name: 'Delete this draft?' })
        await expect(dialog).toBeVisible()
        await expect(dialog).toContainText('Are you sure you want to delete this draft?')
        await expect(page.locator('#root')).toHaveAttribute('inert', '')
        await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeFocused()

        const box = await dialog.boundingBox()
        expect(box!.width, 'dialog fits the screen').toBeLessThanOrEqual(c.width)
        if (c.width < 800) {
          const small = await page.evaluate(() => [...document.querySelectorAll('.ui-dialog button')].map((el) => el.getBoundingClientRect()).filter((r) => r.width < 44 || r.height < 44).length)
          expect(small, 'dialog buttons under 44 x 44').toBe(0)
        }
        expect(await scaleAndColourProblems(page, '.ui-dialog, .ui-dialog [class*="ui-"]'), 'dialog off the scale or the theme colours').toEqual([])
        const axe = await new AxeBuilder({ page }).include('.ui-dialog').withTags(AXE_TAGS).disableRules(AXE_DISABLED).analyze()
        const serious = axe.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`)
        expect(serious, 'axe serious or critical in the dialog').toEqual([])
        await page.screenshot({ path: path.join(OUT, `dialog-delete-${c.name}.png`) })

        // Tab stays inside the dialog, both ways.
        for (let i = 0; i < 3; i++) {
          await page.keyboard.press('Tab')
          expect(await page.evaluate(() => !!document.activeElement?.closest('.ui-dialog')), 'focus inside the dialog').toBe(true)
        }
        await page.keyboard.press('Shift+Tab')
        expect(await page.evaluate(() => !!document.activeElement?.closest('.ui-dialog')), 'focus inside after Shift+Tab').toBe(true)

        // Escape closes it, deletes nothing and gives focus back to the button that opened it.
        await page.keyboard.press('Escape')
        await expect(dialog).toHaveCount(0)
        await expect(page.locator('#root')).not.toHaveAttribute('inert', '')
        await expect(opener).toBeFocused()
        await expect(page.getByText('שרשור לדוגמה')).toBeVisible()
      } finally {
        await context.close()
      }
    })
  }

  // Rare UI's delete button (feature flag "Components", #406): the open panel on its own. Cancel has focus, both
  // choices are 44 px on phones, scale and colours, axe, then Escape keeps the draft and gives focus back.
  for (const c of CASES) {
    test(`rare delete button at ${c.name}`, async ({ browser, request }) => {
      const { context, page } = await openPage(browser, request, '/', c, { kit: 'rare', drafts: [{ title: 'שרשור לדוגמה', posts: [{ id: 'h1', text: 'טקסט בעברית', images: [], embeddedTweet: null }] }] })
      try {
        const opener = page.getByRole('button', { name: 'Delete draft', expanded: false }).first()
        await opener.click()
        const panel = page.getByRole('group', { name: 'Delete this draft?' })
        await expect(panel).toBeVisible()
        await expect(panel.getByRole('button', { name: 'Cancel' })).toBeFocused()
        const widths = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, inner: window.innerWidth }))
        expect(widths.scroll, 'horizontal scroll with the panel open').toBeLessThanOrEqual(widths.inner)
        if (c.width < 800) expect(await smallTargets(page), 'targets under 44 x 44').toEqual([])
        expect(await scaleAndColourProblems(page, '.ui-rare-delete, .ui-rare-delete [class*="ui-"]'), 'delete button off the scale or the theme colours').toEqual([])
        const axe = await new AxeBuilder({ page }).include('.ui-rare-delete').withTags(AXE_TAGS).disableRules(AXE_DISABLED).analyze()
        const serious = axe.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`)
        expect(serious, 'axe serious or critical in the delete button').toEqual([])
        await page.screenshot({ path: path.join(OUT, `rare-delete-${c.name}.png`) })

        await page.keyboard.press('Escape')
        await expect(panel).toHaveCount(0)
        await expect(opener).toBeFocused()
        await expect(page.getByText('שרשור לדוגמה')).toBeVisible()
      } finally {
        await context.close()
      }
    })
  }

  // Rare UI's animated counter (feature flag "Components", #406): the 280-character count of a 290-character Hebrew
  // post. The number is read once (sr-only); the rolling digits are hidden; nothing is a live region; the digits stay
  // left to right; scale and colours, axe, no horizontal scroll.
  for (const c of CASES) {
    test(`rare counter at ${c.name}`, async ({ browser, request }) => {
      const { context, page } = await openPage(browser, request, '/draft/:first', c, { kit: 'rare', drafts: [{ title: 'מונה לדוגמה', posts: [{ id: 'k1', text: 'א'.repeat(290), images: [], embeddedTweet: null }] }] })
      try {
        const counter = page.locator('.ui-rare-counter').first()
        await expect(counter).toBeVisible()
        await expect(counter.locator('.sr-only')).toHaveText('290')
        await expect(page.locator('.char-counter').first()).toContainText('(10 over)')
        await expect(page.locator('.ui-rare-counter [aria-live], .ui-rare-counter [role="status"], .ui-rare-counter [role="alert"]')).toHaveCount(0)
        const widths = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, inner: window.innerWidth }))
        expect(widths.scroll, 'horizontal scroll with the counter').toBeLessThanOrEqual(widths.inner)
        expect(await scaleAndColourProblems(page, '.ui-rare-counter, .ui-rare-counter [class*="ui-"]'), 'counter off the scale or the theme colours').toEqual([])
        const axe = await new AxeBuilder({ page }).include('.char-counter').withTags(AXE_TAGS).disableRules(AXE_DISABLED).analyze()
        const serious = axe.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`)
        expect(serious, 'axe serious or critical in the counter').toEqual([])
        await page.screenshot({ path: path.join(OUT, `rare-counter-${c.name}.png`) })
      } finally {
        await context.close()
      }
    })
  }
})
