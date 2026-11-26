// @vitest-environment node
// Golden tests for every Telegram message kind (issue #463). No network, no Telegram.
// Each kind has one fixture input and the exact message it must produce. The asserts below the
// table hold for every kind: the heading starts with its emoji, no section says "nothing", the
// message fits Telegram's limit, and special characters are escaped for parse mode HTML.
import { readFileSync } from 'node:fs'
import { describe, it, expect, vi } from 'vitest'
import { buildMessage, notify, appFromEnv, escapeHtml as escapeForHtml, EMOJI, KINDS as SENDER_KINDS, DEFAULT_APP } from '../../scripts/notify-telegram.mjs'
import { lint, EMPTY_SECTION } from '../../scripts/reply-lint.mjs'

// Two apps (issue #504): the real one, and a fixture with a different name and different addresses, to prove
// that nothing is typed into a template. The same fixtures and the same checks run for both.
const APPS = [
  DEFAULT_APP,
  {
    name: 'Recipe Box',
    repoUrl: 'https://github.com/acme/recipe-box',
    siteUrl: 'https://recipe-box.example.com',
    previewUrl: 'https://recipe-box-preview.example.com',
  },
]
const SHA40 = 'a11392e1234567890abcdef1234567890abcdef1'
const SHA7 = 'a11392e'

const goldenFor = (app) => {
const P = app.repoUrl
const PROD_URL = app.siteUrl
const PREVIEW_URL = app.previewUrl
const NAME = escapeForHtml(app.name)
const RUN = `${P}/actions/runs/1`
const PR = `${P}/pull/12`
const ISSUE = `${P}/issues/34`

return {
  live: {
    data: { sha: SHA40, title: 'Thread view: one action row', runUrl: RUN },
    html: [
      `✅ <b>${NAME}</b> · <a href="${PROD_URL}">Production is live and tested</a>`,
      `<code>${SHA7}</code> Thread view: one action row`,
      `<a href="${PROD_URL}">Open production</a> · <a href="${P}/commit/${SHA40}">Commit ${SHA7}</a> · <a href="${RUN}">See the run</a>`,
    ],
    plain: [
      `✅ ${app.name} · Production is live and tested: ${PROD_URL}`,
      `${SHA7} Thread view: one action row`,
      `Open production: ${PROD_URL} · Commit ${SHA7}: ${P}/commit/${SHA40} · See the run: ${RUN}`,
    ],
  },
  failed: {
    data: { sha: SHA40, title: 'Thread view: one action row', runUrl: RUN },
    html: [
      `🚨 <b>${NAME}</b> · <a href="${RUN}">Production smoke test failed</a>`,
      `<code>${SHA7}</code> Thread view: one action row`,
      'Production runs this commit, and its smoke test failed or did not run.',
      'Needs you: open the run and read the first failed step.',
      `<a href="${PROD_URL}">Open production</a>`,
    ],
    plain: [
      `🚨 ${app.name} · Production smoke test failed: ${RUN}`,
      `${SHA7} Thread view: one action row`,
      'Production runs this commit, and its smoke test failed or did not run.',
      'Needs you: open the run and read the first failed step.',
      `Open production: ${PROD_URL}`,
    ],
  },
  preview: {
    data: { title: 'Thread view: one action row', url: PR },
    html: [
      `👀 <b>${NAME}</b> · <a href="${PREVIEW_URL}">Try it on preview</a>`,
      'Thread view: one action row',
      'Needs you: try the change on preview.',
      `<a href="${PR}">PR #12 on GitHub</a>`,
    ],
    plain: [
      `👀 ${app.name} · Try it on preview: ${PREVIEW_URL}`,
      'Thread view: one action row',
      'Needs you: try the change on preview.',
      `PR #12 on GitHub: ${PR}`,
    ],
  },
  owner: {
    data: { title: 'Pick a colour', url: ISSUE },
    html: [
      `🙋 <b>${NAME}</b> · <a href="${ISSUE}">An issue needs you</a>`,
      'Pick a colour',
      'Needs you: open it and answer or do what it asks.',
    ],
    plain: [`🙋 ${app.name} · An issue needs you: ${ISSUE}`, 'Pick a colour', 'Needs you: open it and answer or do what it asks.'],
  },
  cleanup: {
    data: { title: 'Remove duplicate tests', url: PR, body: 'Summary: two parser tests that check the same thing.' },
    html: [
      `🧹 <b>${NAME}</b> · <a href="${PR}">Cleanup review ready</a>`,
      'Remove duplicate tests',
      'What it removes: two parser tests that check the same thing.',
      'Needs you: review the PR, then merge or close it. Agents never merge a cleanup PR.',
    ],
    plain: [
      `🧹 ${app.name} · Cleanup review ready: ${PR}`,
      'Remove duplicate tests',
      'What it removes: two parser tests that check the same thing.',
      'Needs you: review the PR, then merge or close it. Agents never merge a cleanup PR.',
    ],
  },
  'weekly-started': {
    data: { title: 'Weekly review 2026-11-30', url: ISSUE },
    html: [
      `🗓 <b>${NAME}</b> · <a href="${ISSUE}">Weekly review started</a>`,
      'Weekly review 2026-11-30',
      'An agent checks the signals and opens up to three PRs; owner items get the label owner.',
    ],
    plain: [
      `🗓 ${app.name} · Weekly review started: ${ISSUE}`,
      'Weekly review 2026-11-30',
      'An agent checks the signals and opens up to three PRs; owner items get the label owner.',
    ],
  },
  'cleanup-started': {
    data: { title: 'Cleanup review 2026-11-25', url: ISSUE },
    html: [
      `🧹 <b>${NAME}</b> · <a href="${ISSUE}">Cleanup review started</a>`,
      'Cleanup review 2026-11-25',
      'An agent reviews the commits since the last review and opens up to three PRs.',
    ],
    plain: [
      `🧹 ${app.name} · Cleanup review started: ${ISSUE}`,
      'Cleanup review 2026-11-25',
      'An agent reviews the commits since the last review and opens up to three PRs.',
    ],
  },
  speed: {
    data: {
      headline: 'Delivery is slower than its limit: CI checks',
      url: RUN,
      numberLine: 'This merge took 2 min 49 s in CI checks. The limit is 1 min 30 s (88 % over), since 2026-11-24 14:10 UTC (7 in a row).',
      causeLine: 'Likely cause: Fonts took 1 min 10 s against a usual 40 s.',
      links: [['Speed table', RUN]],
    },
    html: [
      `🐢 <b>${NAME}</b> · <a href="${RUN}">Delivery is slower than its limit: CI checks</a>`,
      'This merge took 2 min 49 s in CI checks. The limit is 1 min 30 s (88 % over), since 2026-11-24 14:10 UTC (7 in a row).',
      'Likely cause: Fonts took 1 min 10 s against a usual 40 s.',
      `<a href="${RUN}">Speed table</a>`,
    ],
    plain: [
      `🐢 ${app.name} · Delivery is slower than its limit: CI checks: ${RUN}`,
      'This merge took 2 min 49 s in CI checks. The limit is 1 min 30 s (88 % over), since 2026-11-24 14:10 UTC (7 in a row).',
      'Likely cause: Fonts took 1 min 10 s against a usual 40 s.',
      `Speed table: ${RUN}`,
    ],
  },
}
}

const KINDS = Object.keys(goldenFor(DEFAULT_APP))
// The emoji check does not read EMOJI: a blank or wrong entry must still fail.
const STARTS_WITH_EMOJI = /^\p{Extended_Pictographic}\uFE0F? \S/u
const NOTHING_NEEDED = /nothing needed|waiting for: nothing|what you need to do: nothing/i
const URL_IN_HTML = /href="(https:\/\/[^"]+)"/g

describe('Telegram golden messages (#463, #504)', () => {
  it('has a golden fixture for every kind the sender builds, and no fixture for a kind it lacks', () => {
    expect(KINDS.slice().sort()).toEqual(SENDER_KINDS.slice().sort())
    for (const kind of SENDER_KINDS) expect(buildMessage(kind, { title: 'T', url: `${DEFAULT_APP.repoUrl}/pull/12` }), kind).not.toBeNull()
    // Every kind a workflow or script sends is one the sender builds.
    const callers = ['.github/workflows/smoke-deployed.yml', '.github/workflows/notify-labels.yml', 'scripts/notify-label.mjs', 'scripts/cleanup-review-check.mjs', 'scripts/speed-metrics.mjs']
    let seen = 0
    for (const file of callers) {
      const text = readFileSync(new URL(`../../${file}`, import.meta.url), 'utf8')
      for (const m of text.matchAll(/(?:NOTIFY_KIND:\s*|\{ kind: '|buildMessage\(')([a-z][a-z-]*)/g)) {
        seen += 1
        expect(SENDER_KINDS, `${file}: ${m[1]}`).toContain(m[1])
      }
    }
    expect(seen).toBeGreaterThanOrEqual(6)
  })

  it('types the app name and its addresses in one place only: DEFAULT_APP', () => {
    const source = readFileSync(new URL('../../scripts/notify-telegram.mjs', import.meta.url), 'utf8')
    const code = source.split('\n').filter((line) => !line.trim().startsWith('//'))
    const start = code.findIndex((line) => line.startsWith('export const DEFAULT_APP'))
    const end = code.findIndex((line, i) => i > start && line === '}')
    const outside = code.filter((_, i) => i < start || i > end).join('\n')
    expect(start).toBeGreaterThan(-1)
    expect(outside).not.toMatch(/Thread Draft|x-thread-draft-tool|Shaked/i)
  })

  it('reads the app from the environment, with the defaults for a missing or bad value', () => {
    expect(appFromEnv({})).toEqual(DEFAULT_APP)
    expect(appFromEnv({ TELEGRAM_APP_NAME: '  ' })).toEqual(DEFAULT_APP)
    const env = { TELEGRAM_APP_NAME: ' Recipe Box ', TELEGRAM_APP_REPO_URL: APPS[1].repoUrl, TELEGRAM_APP_SITE_URL: 'http://not-https', TELEGRAM_APP_PREVIEW_URL: APPS[1].previewUrl }
    expect(appFromEnv(env)).toEqual({ ...APPS[1], siteUrl: DEFAULT_APP.siteUrl })
    expect(appFromEnv({ TELEGRAM_APP_NAME: 'x'.repeat(500) }).name).toHaveLength(40)
  })

  for (const app of APPS) {
    describe(`app ${app.name}`, () => {
      const GOLDEN = goldenFor(app)
      const P = app.repoUrl
      const PROD_URL = app.siteUrl
      const first = (text) => text.split('\n')[0]

      for (const kind of KINDS) {
        describe(kind, () => {
          const { data, html, plain } = GOLDEN[kind]
          const msg = buildMessage(kind, data, app)

          it('matches the golden message, HTML and plain text', () => {
            expect(msg.html.split('\n')).toEqual(html)
            expect(msg.plain.split('\n')).toEqual(plain)
          })

          it('line 1 is the emoji, the app name in bold, then the headline, in both versions', () => {
            expect(msg.html).toMatch(STARTS_WITH_EMOJI)
            expect(msg.plain).toMatch(STARTS_WITH_EMOJI)
            expect(first(msg.html).startsWith(`${EMOJI[kind]} <b>${escapeForHtml(app.name)}</b> · `)).toBe(true)
            expect(first(msg.plain).startsWith(`${EMOJI[kind]} ${app.name} · `)).toBe(true)
          })

          it('never names another app', () => {
            if (app === DEFAULT_APP) return
            for (const text of [msg.html, msg.plain]) expect(text).not.toMatch(/Thread Draft|x-thread-draft-tool|Shaked/i)
          })

          it('passes the Telegram lint of the reply-style skill when written as Markdown, with this app name', () => {
            const markdown = msg.html
              .replace(/<b>([^<]+)<\/b>/g, '**$1**')
              .replace(/<a href="([^"]+)">([^<]+)<\/a>/g, '[$2]($1)')
              .replace(/<code>([^<]+)<\/code>/g, '`$1`')
              .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&')
            expect(lint(markdown, { kind: 'telegram', app: app.name }), markdown).toEqual([])
            // The same message without its app name fails the lint.
            const without = markdown.replace(`**${app.name}** · `, '')
            expect(lint(without, { kind: 'telegram' }).map((f) => f.rule), without).toContain('app-name')
          })

          it('has no empty section: no "nothing needed", "none" or empty line', () => {
            for (const text of [msg.html, msg.plain]) {
              expect(text).not.toMatch(NOTHING_NEEDED)
              for (const line of text.split('\n')) {
                expect(line.trim()).not.toBe('')
                expect(line).not.toMatch(EMPTY_SECTION)
              }
            }
          })

          it('has at most 5 lines and fits in one Telegram message even with a 5000-character title, summary and markup', () => {
            expect(msg.html.split('\n').length).toBeLessThanOrEqual(5)
            const nasty = '<b>&"é😀שלום'.repeat(500)
            const big = buildMessage(kind, { ...data, title: nasty, body: `Summary: ${nasty}`, sha: 'a'.repeat(5000) }, app)
            expect(Array.from(big.html).length).toBeLessThan(4096)
            expect(Array.from(big.plain).length).toBeLessThan(4096)
          })

          it('escapes <, > & and quotes in user text so Telegram HTML cannot be broken', () => {
            const msg2 = buildMessage(kind, { ...data, title: '<i>x</i> & "y"', body: 'Summary: <u>z</u>' }, app)
            // Remove the tags the sender writes itself; no raw < or > may remain.
            const stripped = msg2.html.replace(/<\/?(?:b|code)>|<a href="[^"<>]*">|<\/a>/g, '')
            expect(stripped).not.toMatch(/[<>]/)
            expect(stripped).not.toMatch(/&(?!amp;|lt;|gt;|quot;)/)
          })
        })
      }

      it('an app name with special characters is escaped in HTML and left as written in plain text', () => {
        const odd = { ...app, name: 'A&B <Box>' }
        const msg = buildMessage('owner', { title: 'T', url: `${P}/issues/1` }, odd)
        expect(first(msg.html)).toContain('<b>A&amp;B &lt;Box&gt;</b> · ')
        expect(first(msg.plain)).toContain('A&B <Box> · ')
      })

      it('the production message always has the deployment link and the commit link, even without a run link', () => {
        const msg = buildMessage('live', { sha: SHA40, title: 'T' }, app)
        const urls = [...msg.html.matchAll(URL_IN_HTML)].map((m) => m[1])
        expect(urls).toContain(PROD_URL)
        expect(urls).toContain(`${P}/commit/${SHA40}`)
        expect(msg.plain).toContain(PROD_URL)
        expect(buildMessage('live', { title: 'T' }, app).html).toContain(`<a href="${PROD_URL}">Open production</a>`)
      })

      it('a bad commit id gives no commit link and no commit line, never a broken link', () => {
        for (const sha of ['abc def', '../../../../evil/x', 'abc"onmouseover', 'zzzzzzz', '12345']) {
          const msg = buildMessage('live', { sha, title: 'T' }, app)
          expect(msg.html, sha).not.toContain('/commit/')
          expect(msg.html, sha).not.toContain('<code>')
          expect(msg.html, sha).toContain(`<a href="${PROD_URL}">Open production</a>`)
        }
      })

      it('Hebrew user text stays exactly as written', () => {
        const title = 'שרשור חדש: שלום עולם'
        for (const kind of ['live', 'preview', 'owner', 'cleanup']) {
          const msg = buildMessage(kind, { ...GOLDEN[kind].data, title }, app)
          expect(msg.html).toContain(title)
          expect(msg.plain).toContain(title)
        }
      })

      it('sends HTML, and the emoji, the app name and every link reach the Telegram request unchanged', async () => {
        for (const kind of KINDS) {
          const bodies = []
          const fetchImpl = vi.fn(async (_url, init) => {
            bodies.push(JSON.parse(init.body))
            return { ok: true, status: 200, json: async () => ({}) }
          })
          const msg = buildMessage(kind, GOLDEN[kind].data, app)
          await notify({ token: '1:FAKE', chatId: '2', ...msg, fetchImpl, log: () => {} })
          expect(bodies).toHaveLength(1)
          expect(bodies[0].parse_mode).toBe('HTML')
          expect(bodies[0].text).toBe(msg.html)
          expect(bodies[0].text).toMatch(STARTS_WITH_EMOJI)
          expect(first(bodies[0].text)).toContain(`<b>${escapeForHtml(app.name)}</b>`)
          for (const m of msg.html.matchAll(URL_IN_HTML)) expect(bodies[0].text).toContain(m[1])
        }
      })
    })
  }
})
