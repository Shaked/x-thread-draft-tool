// @vitest-environment node
import { describe, it, expect, vi } from 'vitest'
import {
  buildMessage,
  messageFromEnv,
  escapeHtml,
  safeUrl,
  clip,
  summaryLine,
  notify,
  MAX_TITLE,
  PROD_URL,
  PREVIEW_URL,
} from '../../scripts/notify-telegram.mjs'

const TOKEN = '123456:FAKE-TEST-TOKEN'
const SHA = 'a11392e1234567890abcdef'
const RUN_URL = 'https://github.com/Shaked/x-thread-draft-tool/actions/runs/1'
const PR_URL = 'https://github.com/Shaked/x-thread-draft-tool/pull/12'
const ISSUE_URL = 'https://github.com/Shaked/x-thread-draft-tool/issues/34'

// Fake Telegram answers: status plus an optional JSON body (Telegram's own error text).
function fakeFetch(...answers) {
  const list = answers.length ? answers : [{ status: 200 }]
  return vi.fn(async () => {
    const a = list.shift() || list[list.length - 1]
    return {
      ok: a.status >= 200 && a.status < 300,
      status: a.status,
      json: async () => {
        if (a.body === undefined) throw new Error('no body')
        return a.body
      },
    }
  })
}

function logger() {
  const lines = []
  return { lines, log: (line) => lines.push(String(line)) }
}

describe('buildMessage: the four kinds', () => {
  it('live: production is live, with the sha, the title and the production link first', () => {
    const msg = buildMessage('live', { sha: SHA, title: 'Fix the thing' })
    expect(msg.html).toBe(
      [`<b><a href="${PROD_URL}">Production is live and tested</a></b>`, '<code>a11392e</code> Fix the thing', 'Nothing needed.'].join(
        '\n',
      ),
    )
    expect(msg.plain).toBe([`Production is live and tested: ${PROD_URL}`, 'a11392e Fix the thing', 'Nothing needed.'].join('\n'))
    const withRun = buildMessage('live', { sha: SHA, title: 'Fix the thing', runUrl: RUN_URL })
    expect(withRun.html.split('\n').pop()).toBe(`<a href="${RUN_URL}">See the run</a>`)
  })

  it('failed: the urgent kind links the failed run', () => {
    const msg = buildMessage('failed', { sha: SHA, title: 'Fix the thing', runUrl: RUN_URL })
    expect(msg.html).toBe(
      [
        `<b><a href="${RUN_URL}">Production smoke test failed</a></b>`,
        '<code>a11392e</code> Fix the thing',
        'Production runs this commit, and its smoke test failed or did not run.',
        'Needs you: open the run and read the first failed step.',
        `<a href="${PROD_URL}">Open production</a>`,
      ].join('\n'),
    )
  })

  it('preview: the preview link comes first, then the PR', () => {
    const msg = buildMessage('preview', { title: 'Try the drafts', url: PR_URL })
    expect(msg.html).toBe(
      [
        `<b><a href="${PREVIEW_URL}">Try it on preview</a></b>`,
        'Try the drafts',
        'Needs you: try the change on preview.',
        `<a href="${PR_URL}">PR #12 on GitHub</a>`,
      ].join('\n'),
    )
    expect(msg.html.indexOf(PREVIEW_URL)).toBeLessThan(msg.html.indexOf(PR_URL))
  })

  it('preview: the PR link shows its number, and falls back to PR when the URL has none', () => {
    expect(buildMessage('preview', { title: 'T', url: PR_URL }).plain).toContain('PR #12')
    expect(buildMessage('preview', { title: 'T', url: 'https://github.com/o/r/pulls' }).plain).toContain(
      'PR on GitHub: https://github.com/o/r/pulls',
    )
  })

  it('owner: needs you, with the issue link', () => {
    const msg = buildMessage('owner', { title: 'Pick a colour', url: ISSUE_URL })
    expect(msg.html).toBe(
      [`<b><a href="${ISSUE_URL}">An issue needs you</a></b>`, 'Pick a colour', 'Needs you: open it and answer or do what it asks.'].join('\n'),
    )
    expect(msg.plain).toBe(
      [`An issue needs you: ${ISSUE_URL}`, 'Pick a colour', 'Needs you: open it and answer or do what it asks.'].join('\n'),
    )
    expect(buildMessage('owner', { title: 'T', url: PR_URL }).html.split('\n')[0]).toBe(`<b><a href="${PR_URL}">A PR needs you</a></b>`)
  })

  it('returns null for an unknown kind', () => {
    expect(buildMessage('nope', { title: 'x' })).toBeNull()
  })

  it('uses a placeholder for an empty title', () => {
    expect(buildMessage('owner', { title: '', url: ISSUE_URL }).html).toContain('(no title)')
  })
})

describe('buildMessage: cleanup review (epic #255, task C3)', () => {
  const PR_BODY = 'Summary: Drop two duplicate parser tests\n\nLong details here'

  it('cleanup: the headline links to the PR, then the title, the summary as "What it removes", and what is needed', () => {
    const msg = buildMessage('cleanup', { title: 'Remove duplicate tests', url: PR_URL, body: PR_BODY })
    const needs = 'Needs you: review the PR, then merge or close it. Agents never merge a cleanup PR.'
    expect(msg.html).toBe(
      [`<b><a href="${PR_URL}">Cleanup review ready</a></b>`, 'Remove duplicate tests', 'What it removes: Drop two duplicate parser tests', needs].join('\n'),
    )
    expect(msg.plain).toBe(
      [`Cleanup review ready: ${PR_URL}`, 'Remove duplicate tests', 'What it removes: Drop two duplicate parser tests', needs].join('\n'),
    )
  })

  it('cleanup: no summary line when the first body line does not start with "Summary:", or is empty', () => {
    expect(buildMessage('cleanup', { title: 'T', url: PR_URL, body: 'Some text\nSummary: later' }).html.split('\n')).toHaveLength(3)
    expect(buildMessage('cleanup', { title: 'T', url: PR_URL }).html.split('\n')).toHaveLength(3)
    expect(buildMessage('cleanup', { title: 'T', url: PR_URL, body: 'Summary:   \nx' }).html.split('\n')).toHaveLength(3)
  })

  it('cleanup: the summary is cut to 120 characters and escaped', () => {
    const msg = buildMessage('cleanup', { title: 'T', url: PR_URL, body: `Summary: <b>${'x'.repeat(300)}</b>` })
    const line = msg.html.split('\n').find((l) => l.startsWith('What it removes: '))
    expect(line.startsWith('What it removes: &lt;b&gt;')).toBe(true)
    expect(line).not.toContain('<b>')
    const plainLine = msg.plain.split('\n').find((l) => l.startsWith('What it removes: '))
    expect(Array.from(plainLine).length - 'What it removes: '.length).toBe(MAX_TITLE)
  })

  it('cleanup: a title with markup cannot add tags', () => {
    const msg = buildMessage('cleanup', { title: '</blockquote><script>x</script>', url: PR_URL })
    expect(msg.html).not.toContain('<script')
    expect(msg.html).toContain('&lt;/blockquote&gt;&lt;script&gt;')
  })

  it('cleanup: a link that is not https is dropped and the label stays as text', () => {
    const msg = buildMessage('cleanup', { title: 'T', url: 'http://evil.example/pull/3' })
    expect(msg.html).not.toContain('<a ')
    expect(msg.html).toContain('Cleanup review ready')
  })

  it('cleanup-started: the headline links to the issue, then the title, and nothing is needed', () => {
    const msg = buildMessage('cleanup-started', { title: 'Cleanup review 2026-11-20', url: ISSUE_URL, body: 'Summary: ignored' })
    const nothing = 'Nothing needed. An agent reviews the commits since the last review and opens up to three PRs.'
    expect(msg.html).toBe([`<b><a href="${ISSUE_URL}">Cleanup review started</a></b>`, 'Cleanup review 2026-11-20', nothing].join('\n'))
    expect(msg.plain).toBe([`Cleanup review started: ${ISSUE_URL}`, 'Cleanup review 2026-11-20', nothing].join('\n'))
  })

  it('summaryLine reads only the first line, after "Summary:"', () => {
    expect(summaryLine('Summary: a\nb')).toBe('a')
    expect(summaryLine('\r\nSummary: a')).toBe('')
    expect(summaryLine('x\nSummary: a')).toBe('')
    expect(summaryLine('')).toBe('')
    expect(summaryLine(undefined)).toBe('')
  })
})

describe('escaping and limits', () => {
  it('escapes markup in the title so it cannot open or close a tag', () => {
    const title = '<script>alert(1)</script> & "quotes" </blockquote> <a href="x">y</a>'
    const { html, plain } = buildMessage('owner', { title, url: ISSUE_URL })
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt; &amp; &quot;quotes&quot; &lt;/blockquote&gt;')
    expect(html).not.toContain('<script')
    expect(html).not.toContain('<a href="x">')
    // The plain fallback carries the title as typed, with no HTML at all.
    expect(plain).toContain(title)
  })

  it('escapeHtml covers the characters Telegram HTML needs', () => {
    expect(escapeHtml(`<&>"`)).toBe('&lt;&amp;&gt;&quot;')
  })

  it('cuts a 5000-character title to MAX_TITLE before escaping, and the message stays far under 4096', () => {
    const huge = '<'.repeat(5000)
    const msg = buildMessage('live', { sha: SHA, title: huge })
    const titleLine = msg.html.split('\n')[1]
    // Each "<" is "&lt;" after escaping, so exactly MAX_TITLE of them survive.
    expect(titleLine.split('&lt;').length - 1).toBe(MAX_TITLE)
    expect(msg.html.length).toBeLessThan(4096)
  })

  it('a title cut in the middle of an emoji keeps the pair whole', () => {
    expect(clip('😀'.repeat(MAX_TITLE + 1))).toBe('😀'.repeat(MAX_TITLE))
  })

  it('keeps the link at the end of every message even for a 5000-character title', () => {
    const long = 'é😀'.repeat(2500)
    for (const kind of ['preview', 'owner']) {
      const msg = buildMessage(kind, { title: long, url: PR_URL, previewUrl: PREVIEW_URL })
      expect(msg.html).toContain(PR_URL)
      expect(msg.html.length).toBeLessThan(4096)
    }
  })
})

describe('safeUrl', () => {
  it('accepts https links', () => {
    expect(safeUrl(PROD_URL)).toBe(PROD_URL)
  })

  it('refuses http, javascript, quotes, angle brackets and whitespace', () => {
    for (const bad of ['http://x.example', 'javascript:alert(1)', 'https://x.example/"onmouseover', 'https://x.example/<b>', 'https://x example', '']) {
      expect(safeUrl(bad)).toBe('')
    }
  })

  it('drops a bad link but keeps the label as text', () => {
    const msg = buildMessage('owner', { title: 'T', url: 'http://evil.example' })
    expect(msg.html).not.toContain('<a ')
    expect(msg.html).toContain('An issue needs you')
    expect(msg.plain).toContain('An issue needs you')
  })

  it('escapes an ampersand in a link so the attribute stays valid', () => {
    const msg = buildMessage('owner', { title: 'T', url: 'https://x.example/?a=1&b=2' })
    expect(msg.html).toContain('href="https://x.example/?a=1&amp;b=2"')
  })
})

describe('messageFromEnv', () => {
  it('builds the message from the environment values', () => {
    const msg = messageFromEnv({ NOTIFY_KIND: 'failed', NOTIFY_SHA: SHA, NOTIFY_TITLE: 'T', NOTIFY_RUN_URL: RUN_URL })
    expect(msg.html).toContain(`href="${RUN_URL}"`)
  })

  it('returns null for an unknown kind', () => {
    expect(messageFromEnv({ NOTIFY_KIND: '' })).toBeNull()
  })
})

describe('notify', () => {
  const msg = buildMessage('owner', { title: 'T', url: ISSUE_URL })

  it('skips with no call when a secret is missing or empty', async () => {
    for (const secrets of [{ token: '', chatId: '1' }, { token: TOKEN, chatId: '' }, {}]) {
      const fetchImpl = fakeFetch()
      const { lines, log } = logger()
      expect(await notify({ ...secrets, ...msg, fetchImpl, log })).toBe('skipped')
      expect(fetchImpl).not.toHaveBeenCalled()
      expect(lines).toEqual(['notify skipped: no Telegram secrets'])
    }
  })

  it('skips when there is no text', async () => {
    const fetchImpl = fakeFetch()
    const { lines, log } = logger()
    expect(await notify({ token: TOKEN, chatId: '1', fetchImpl, log })).toBe('skipped')
    expect(fetchImpl).not.toHaveBeenCalled()
    expect(lines).toEqual(['notify skipped: no text'])
  })

  it('sends the HTML with parse_mode HTML, one request, and prints "notify sent"', async () => {
    const fetchImpl = fakeFetch({ status: 200 })
    const { lines, log } = logger()
    expect(await notify({ token: TOKEN, chatId: '42', ...msg, fetchImpl, log })).toBe('sent')
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    const [url, init] = fetchImpl.mock.calls[0]
    expect(url).toBe(`https://api.telegram.org/bot${TOKEN}/sendMessage`)
    expect(init.method).toBe('POST')
    const body = JSON.parse(init.body)
    expect(body).toEqual({ chat_id: '42', disable_web_page_preview: false, text: msg.html, parse_mode: 'HTML' })
    expect(lines).toEqual(['notify sent'])
  })

  it('on a 400 parse error, sends the plain text once more and then stops', async () => {
    const fetchImpl = fakeFetch(
      { status: 400, body: { ok: false, description: "Bad Request: can't parse entities: unsupported start tag" } },
      { status: 200 },
    )
    const { lines, log } = logger()
    expect(await notify({ token: TOKEN, chatId: '42', ...msg, fetchImpl, log })).toBe('sent')
    expect(fetchImpl).toHaveBeenCalledTimes(2)
    const second = JSON.parse(fetchImpl.mock.calls[1][1].body)
    expect(second).not.toHaveProperty('parse_mode')
    expect(second.text).toBe(msg.plain)
    expect(lines).toEqual(['notify: HTML rejected, sending plain text', 'notify sent'])
  })

  it('never makes a third request: a second 400 is reported as failed', async () => {
    const parseErr = { status: 400, body: { description: "can't parse entities" } }
    const fetchImpl = fakeFetch(parseErr, parseErr, { status: 200 })
    const { lines, log } = logger()
    expect(await notify({ token: TOKEN, chatId: '42', ...msg, fetchImpl, log })).toBe('failed')
    expect(fetchImpl).toHaveBeenCalledTimes(2)
    expect(lines).toEqual(['notify: HTML rejected, sending plain text', 'notify failed: HTTP 400'])
  })

  it('a 400 that is not a parse error (chat not found) is not retried', async () => {
    const fetchImpl = fakeFetch({ status: 400, body: { description: 'Bad Request: chat not found' } })
    const { lines, log } = logger()
    expect(await notify({ token: TOKEN, chatId: '42', ...msg, fetchImpl, log })).toBe('failed')
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(lines).toEqual(['notify failed: HTTP 400'])
  })

  it('an HTTP 500 still resolves, prints only the status, and never the token', async () => {
    const fetchImpl = fakeFetch({ status: 500 })
    const { lines, log } = logger()
    expect(await notify({ token: TOKEN, chatId: '42', ...msg, fetchImpl, log })).toBe('failed')
    expect(lines).toEqual(['notify failed: HTTP 500'])
    expect(lines.join('\n')).not.toContain(TOKEN)
  })

  it('a thrown network error still resolves and prints no token or URL', async () => {
    const fetchImpl = vi.fn(async () => {
      throw Object.assign(new Error(`connect to https://api.telegram.org/bot${TOKEN}/sendMessage failed`), {
        name: 'TypeError',
      })
    })
    const { lines, log } = logger()
    expect(await notify({ token: TOKEN, chatId: '42', ...msg, fetchImpl, log })).toBe('failed')
    expect(lines).toEqual(['notify failed: TypeError'])
    const output = lines.join('\n')
    expect(output).not.toContain(TOKEN)
    expect(output).not.toContain('api.telegram.org')
  })
})

describe('speed message (#440)', () => {
  // The input is what speed-metrics.mjs passes for a CI p90 of 99 s over its 90 s limit.
  const data = {
    title: 'Speed over the budget: CI, Smoke',
    url: 'https://github.com/owner/repo/actions/runs/42',
    window: 'The last 50 merged pull requests, merged since 2026-11-02.',
    lines: ['Product code CI: p90 99 s, limit 90 s, usual 90 s', 'Product code Smoke: p90 31 s, limit 25 s, usual 18 s'],
  }

  it('says what is over, the numbers, the window, what is needed and one link to the run', () => {
    const msg = buildMessage('speed', data)
    expect(msg.html).toBe([
      '<b><a href="https://github.com/owner/repo/actions/runs/42">Speed over the budget: CI, Smoke</a></b>',
      'The last 50 merged pull requests, merged since 2026-11-02.',
      'Product code CI: p90 99 s, limit 90 s, usual 90 s',
      'Product code Smoke: p90 31 s, limit 25 s, usual 18 s',
      'Nothing needed: this check only warns.',
    ].join('\n'))
    expect(msg.plain).toBe([
      'Speed over the budget: CI, Smoke: https://github.com/owner/repo/actions/runs/42',
      'The last 50 merged pull requests, merged since 2026-11-02.',
      'Product code CI: p90 99 s, limit 90 s, usual 90 s',
      'Product code Smoke: p90 31 s, limit 25 s, usual 18 s',
      'Nothing needed: this check only warns.',
    ].join('\n'))
  })

  it('has no emoji and never puts a raw run link on a second line', () => {
    const msg = buildMessage('speed', data)
    expect(msg.html).not.toMatch(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u)
    expect(msg.html.match(/href=/g)).toHaveLength(1)
  })

  it('drops the link when it is not https, and escapes the text', () => {
    const msg = buildMessage('speed', { ...data, title: 'Smoke <b>', url: 'http://example.com' })
    expect(msg.html.startsWith('<b>Smoke &lt;b&gt;</b>')).toBe(true)
    expect(msg.html).not.toContain('href=')
  })
})
