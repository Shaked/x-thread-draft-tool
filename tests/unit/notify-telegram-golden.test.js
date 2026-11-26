// @vitest-environment node
// Golden tests for every Telegram message kind (issue #463). No network, no Telegram.
// Each kind has one fixture input and the exact message it must produce. The asserts below the
// table hold for every kind: the heading starts with its emoji, no section says "nothing", the
// message fits Telegram's limit, and special characters are escaped for parse mode HTML.
import { readFileSync } from 'node:fs'
import { describe, it, expect, vi } from 'vitest'
import { buildMessage, notify, EMOJI, KINDS as SENDER_KINDS, PROD_URL, PREVIEW_URL, REPO_URL } from '../../scripts/notify-telegram.mjs'
import { lint, EMPTY_SECTION } from '../../scripts/reply-lint.mjs'

const P = REPO_URL
const SHA40 = 'a11392e1234567890abcdef1234567890abcdef1'
const SHA7 = 'a11392e'
const RUN = `${P}/actions/runs/1`
const PR = `${P}/pull/12`
const ISSUE = `${P}/issues/34`

const GOLDEN = {
  live: {
    data: { sha: SHA40, title: 'Thread view: one action row', runUrl: RUN },
    html: [
      `✅ <b><a href="${PROD_URL}">Production is live and tested</a></b>`,
      `<code>${SHA7}</code> Thread view: one action row`,
      `<a href="${PROD_URL}">Open production</a> · <a href="${P}/commit/${SHA40}">Commit ${SHA7}</a> · <a href="${RUN}">See the run</a>`,
    ],
    plain: [
      `✅ Production is live and tested: ${PROD_URL}`,
      `${SHA7} Thread view: one action row`,
      `Open production: ${PROD_URL} · Commit ${SHA7}: ${P}/commit/${SHA40} · See the run: ${RUN}`,
    ],
  },
  failed: {
    data: { sha: SHA40, title: 'Thread view: one action row', runUrl: RUN },
    html: [
      `🚨 <b><a href="${RUN}">Production smoke test failed</a></b>`,
      `<code>${SHA7}</code> Thread view: one action row`,
      'Production runs this commit, and its smoke test failed or did not run.',
      'Needs you: open the run and read the first failed step.',
      `<a href="${PROD_URL}">Open production</a>`,
    ],
    plain: [
      `🚨 Production smoke test failed: ${RUN}`,
      `${SHA7} Thread view: one action row`,
      'Production runs this commit, and its smoke test failed or did not run.',
      'Needs you: open the run and read the first failed step.',
      `Open production: ${PROD_URL}`,
    ],
  },
  preview: {
    data: { title: 'Thread view: one action row', url: PR },
    html: [
      `👀 <b><a href="${PREVIEW_URL}">Try it on preview</a></b>`,
      'Thread view: one action row',
      'Needs you: try the change on preview.',
      `<a href="${PR}">PR #12 on GitHub</a>`,
    ],
    plain: [
      `👀 Try it on preview: ${PREVIEW_URL}`,
      'Thread view: one action row',
      'Needs you: try the change on preview.',
      `PR #12 on GitHub: ${PR}`,
    ],
  },
  owner: {
    data: { title: 'Pick a colour', url: ISSUE },
    html: [
      `🙋 <b><a href="${ISSUE}">An issue needs you</a></b>`,
      'Pick a colour',
      'Needs you: open it and answer or do what it asks.',
    ],
    plain: [`🙋 An issue needs you: ${ISSUE}`, 'Pick a colour', 'Needs you: open it and answer or do what it asks.'],
  },
  cleanup: {
    data: { title: 'Remove duplicate tests', url: PR, body: 'Summary: two parser tests that check the same thing.' },
    html: [
      `🧹 <b><a href="${PR}">Cleanup review ready</a></b>`,
      'Remove duplicate tests',
      'What it removes: two parser tests that check the same thing.',
      'Needs you: review the PR, then merge or close it. Agents never merge a cleanup PR.',
    ],
    plain: [
      `🧹 Cleanup review ready: ${PR}`,
      'Remove duplicate tests',
      'What it removes: two parser tests that check the same thing.',
      'Needs you: review the PR, then merge or close it. Agents never merge a cleanup PR.',
    ],
  },
  'cleanup-started': {
    data: { title: 'Cleanup review 2026-11-25', url: ISSUE },
    html: [
      `🧹 <b><a href="${ISSUE}">Cleanup review started</a></b>`,
      'Cleanup review 2026-11-25',
      'An agent reviews the commits since the last review and opens up to three PRs.',
    ],
    plain: [
      `🧹 Cleanup review started: ${ISSUE}`,
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
      `🐢 <b><a href="${RUN}">Delivery is slower than its limit: CI checks</a></b>`,
      'This merge took 2 min 49 s in CI checks. The limit is 1 min 30 s (88 % over), since 2026-11-24 14:10 UTC (7 in a row).',
      'Likely cause: Fonts took 1 min 10 s against a usual 40 s.',
      `<a href="${RUN}">Speed table</a>`,
    ],
    plain: [
      `🐢 Delivery is slower than its limit: CI checks: ${RUN}`,
      'This merge took 2 min 49 s in CI checks. The limit is 1 min 30 s (88 % over), since 2026-11-24 14:10 UTC (7 in a row).',
      'Likely cause: Fonts took 1 min 10 s against a usual 40 s.',
      `Speed table: ${RUN}`,
    ],
  },
}

const KINDS = Object.keys(GOLDEN)
// The emoji check does not read EMOJI: a blank or wrong entry must still fail.
const STARTS_WITH_EMOJI = /^\p{Extended_Pictographic}\uFE0F? \S/u
const NOTHING_NEEDED = /nothing needed|waiting for: nothing|what you need to do: nothing/i
const URL_IN_HTML = /href="(https:\/\/[^"]+)"/g

describe('Telegram golden messages (#463)', () => {
  it('has a golden fixture for every kind the sender builds, and no fixture for a kind it lacks', () => {
    expect(KINDS.slice().sort()).toEqual(SENDER_KINDS.slice().sort())
    for (const kind of SENDER_KINDS) expect(buildMessage(kind, { title: 'T', url: PR }), kind).not.toBeNull()
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

  for (const kind of KINDS) {
    describe(kind, () => {
      const { data, html, plain } = GOLDEN[kind]
      const msg = buildMessage(kind, data)

      it('matches the golden message, HTML and plain text', () => {
        expect(msg.html.split('\n')).toEqual(html)
        expect(msg.plain.split('\n')).toEqual(plain)
      })

      it('starts with its emoji, in both versions', () => {
        expect(msg.html).toMatch(STARTS_WITH_EMOJI)
        expect(msg.plain).toMatch(STARTS_WITH_EMOJI)
        expect(msg.html.startsWith(`${EMOJI[kind]} <b>`)).toBe(true)
      })

      it('passes the Telegram lint of the reply-style skill when written as Markdown', () => {
        const markdown = msg.html
          .replace(/<b><a href="([^"]+)">([^<]+)<\/a><\/b>/g, '**[$2]($1)**')
          .replace(/<a href="([^"]+)">([^<]+)<\/a>/g, '[$2]($1)')
          .replace(/<code>([^<]+)<\/code>/g, '`$1`')
          .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&')
        expect(lint(markdown, { kind: 'telegram' }), markdown).toEqual([])
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

      it('fits in one Telegram message even with a 5000-character title, summary and markup', () => {
        const nasty = '<b>&"é😀שלום'.repeat(500)
        const big = buildMessage(kind, { ...data, title: nasty, body: `Summary: ${nasty}`, sha: 'a'.repeat(5000) })
        expect(Array.from(big.html).length).toBeLessThan(4096)
        expect(Array.from(big.plain).length).toBeLessThan(4096)
      })

      it('escapes <, > & and quotes in user text so Telegram HTML cannot be broken', () => {
        const msg2 = buildMessage(kind, { ...data, title: '<i>x</i> & "y"', body: 'Summary: <u>z</u>' })
        // Remove the tags the sender writes itself; no raw < or > may remain.
        const stripped = msg2.html.replace(/<\/?(?:b|code)>|<a href="[^"<>]*">|<\/a>/g, '')
        expect(stripped).not.toMatch(/[<>]/)
        expect(stripped).not.toMatch(/&(?!amp;|lt;|gt;|quot;)/)
      })
    })
  }

  it('the production message always has the deployment link and the commit link, even without a run link', () => {
    const msg = buildMessage('live', { sha: SHA40, title: 'T' })
    const urls = [...msg.html.matchAll(URL_IN_HTML)].map((m) => m[1])
    expect(urls).toContain(PROD_URL)
    expect(urls).toContain(`${P}/commit/${SHA40}`)
    expect(msg.plain).toContain(PROD_URL)
    expect(buildMessage('live', { title: 'T' }).html).toContain(`<a href="${PROD_URL}">Open production</a>`)
  })

  it('a bad commit id gives no commit link and no commit line, never a broken link', () => {
    for (const sha of ['abc def', '../../../../evil/x', 'abc"onmouseover', 'zzzzzzz', '12345']) {
      const msg = buildMessage('live', { sha, title: 'T' })
      expect(msg.html, sha).not.toContain('/commit/')
      expect(msg.html, sha).not.toContain('<code>')
      expect(msg.html, sha).toContain(`<a href="${PROD_URL}">Open production</a>`)
    }
  })

  it('Hebrew user text stays exactly as written', () => {
    const title = 'שרשור חדש: שלום עולם'
    for (const kind of ['live', 'preview', 'owner', 'cleanup']) {
      const msg = buildMessage(kind, { ...GOLDEN[kind].data, title })
      expect(msg.html).toContain(title)
      expect(msg.plain).toContain(title)
    }
  })

  it('sends HTML, and the emoji and every link reach the Telegram request unchanged', async () => {
    for (const kind of KINDS) {
      const bodies = []
      const fetchImpl = vi.fn(async (_url, init) => {
        bodies.push(JSON.parse(init.body))
        return { ok: true, status: 200, json: async () => ({}) }
      })
      const msg = buildMessage(kind, GOLDEN[kind].data)
      await notify({ token: '1:FAKE', chatId: '2', ...msg, fetchImpl, log: () => {} })
      expect(bodies).toHaveLength(1)
      expect(bodies[0].parse_mode).toBe('HTML')
      expect(bodies[0].text).toBe(msg.html)
      expect(bodies[0].text).toMatch(STARTS_WITH_EMOJI)
      for (const m of msg.html.matchAll(URL_IN_HTML)) expect(bodies[0].text).toContain(m[1])
    }
  })
})
