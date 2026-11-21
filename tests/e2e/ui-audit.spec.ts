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
const MIGRATED = [
  { name: 'about', path: '/about' },
  { name: 'changelog', path: '/changelog' },
  { name: 'tokens', path: '/settings/tokens' },
  { name: 'apps', path: '/settings/apps' }
]

// Targets allowed under 44 x 44, each with its reason. The "Show toolbar" tab is 44 wide and at most 36 high on purpose.
const EXEMPT_TARGETS = [
  { selector: '.app-bar-toggle', reason: 'the "Show toolbar" tab is at most 36 px high; tests/e2e/app-bar.spec.ts pins it' }
]

// axe rule disabled on purpose: index.html blocks page zoom (maximum-scale=1.0, user-scalable=no). Owner decision U-O1
// (2026-11-21) allows pinch zoom, so the viewport tag change is its own task; this audit does not wait for it.
const AXE_DISABLED = ['meta-viewport']
const AXE_TAGS = ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']

// The scales from src/styles/tokens.css, in px (rem values in the file are 16 px).
const FONT_PX = [12, 14, 16, 18, 20, 24, 28]
const SPACE_PX = [0, 4, 8, 12, 16, 20, 24, 32, 40, 48, 64]
const RADIUS_PX = [0, 6, 10, 14, 20, 999]

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

async function devToken(request: APIRequestContext, login: string): Promise<string> {
  const res = await request.post(`${BASE}/api/dev/token`, { data: { login } })
  expect(res.ok()).toBeTruthy()
  return (await res.json()).token as string
}

async function openPage(browser: Browser, request: APIRequestContext, pagePath: string, c: (typeof CASES)[number]) {
  const phone = c.width < 800
  const context: BrowserContext = await browser.newContext({
    viewport: { width: c.width, height: phone ? 844 : 800 },
    isMobile: phone,
    hasTouch: phone,
    reducedMotion: 'reduce',
    serviceWorkers: 'block'
  })
  const token = await devToken(request, `ui-audit-${c.name}-${Date.now()}`)
  const hebrew = c.rtl && pagePath === '/changelog'
  // Signed-in pages: the dev token goes out as a bearer header. The Hebrew pass answers the changelog itself.
  await context.route(`${ORIGIN}/api/**`, (route) => {
    if (hebrew && new URL(route.request().url()).pathname === '/api/changelog') {
      return route.fulfill({ json: HEBREW_CHANGELOG })
    }
    return route.continue({ headers: { ...route.request().headers(), authorization: `Bearer ${token}` } })
  })
  const page = await context.newPage()
  await page.addInitScript((value) => localStorage.setItem('xt-theme', value), c.theme)
  await page.goto(`${BASE}${pagePath}`, { waitUntil: 'networkidle' })
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  await expect(page.getByText('Loading…')).toHaveCount(0)
  if (c.rtl) await page.evaluate(() => document.documentElement.setAttribute('dir', 'rtl'))
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
async function scaleAndColourProblems(page: Page): Promise<string[]> {
  return page.evaluate(
    ({ names, font, space, radius }: { names: string[]; font: number[]; space: number[]; radius: number[] }) => {
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
      for (const el of document.querySelectorAll('[class*="ui-"]')) {
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
    { names: TOKEN_COLOURS, font: FONT_PX, space: SPACE_PX, radius: RADIUS_PX }
  )
}

test.describe('UI audit', () => {
  test.setTimeout(180_000)
  mkdirSync(OUT, { recursive: true })

  for (const pageInfo of MIGRATED) {
    for (const c of CASES) {
      test(`${pageInfo.name} at ${c.name}`, async ({ browser, request }) => {
        const { context, page } = await openPage(browser, request, pageInfo.path, c)
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

          expect(await scaleAndColourProblems(page), 'ui- elements off the scale or the theme colours').toEqual([])

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
})
