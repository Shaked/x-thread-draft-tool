#!/usr/bin/env node
// Telegram notices (epic #241, tasks N1, N2, N4). Node 20, no dependencies.
//
// buildMessage(kind, data) returns { html, plain }. The shapes are the forms in
// .claude/skills/reply-style/templates/telegram-message.md (plan #369, step 7):
//   live             production is live and the smoke test passed
//   failed           production smoke test failed (the only urgent one)
//   preview          a PR got the label try-preview: try it on the preview URL
//   owner            the repository owner added the label owner: needs you
//   cleanup          a PR got the label cleanup-pr (epic #255, task C3): review the cleanup PR
//   cleanup-started  the daily workflow opened a cleanup review issue
//   weekly-started   the weekly workflow opened a weekly review issue (epic #273, task #295)
//   speed            a stage's p90 is over its limit (speed-metrics.mjs, task #310 of epic #273); not in the template yet
//
// CLI (the workflows pass every value through environment variables, never inside the shell text):
//   NOTIFY_KIND, NOTIFY_SHA, NOTIFY_TITLE, NOTIFY_URL, NOTIFY_RUN_URL, NOTIFY_PREVIEW_URL,
//   TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID
// Without both secrets it prints a skip line and exits 0. A network or API error prints the HTTP
// status only and also exits 0, so a notice can never fail a workflow. The token and the request
// URL are never printed.

import { pathToFileURL } from 'node:url'

export const PROD_URL = 'https://x-thread-draft-tool.vercel.app'
export const PREVIEW_URL = 'https://x-thread-draft-tool-preview.vercel.app'
// Titles are cut before escaping, so a tag is never cut in half. Escaping can grow a title up to
// six times, so the longest message stays far under Telegram's 4096-character limit.
export const MAX_TITLE = 120

const SPEED_HEADLINE = 'Speed budget over limit'

// Escapes the three characters Telegram HTML needs, plus the double quote for attribute values.
export function escapeHtml(value) {
  return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

// Cut to n code points (Array.from keeps surrogate pairs whole).
export function clip(text, n = MAX_TITLE) {
  return Array.from(String(text)).slice(0, n).join('')
}

// A link is used only when it starts with https:// and holds no quote, angle bracket or whitespace.
// Anything else is dropped: the label stays as plain text.
export function safeUrl(url) {
  const s = String(url || '')
  return /^https:\/\/[^\s"<>]+$/.test(s) ? s : ''
}

function linkHtml(label, url) {
  const href = safeUrl(url)
  return href ? `<a href="${escapeHtml(href)}">${escapeHtml(label)}</a>` : escapeHtml(label)
}

function linkPlain(label, url) {
  const href = safeUrl(url)
  return href ? `${label}: ${href}` : label
}

// The first line of a PR body, when it starts with "Summary:": the text after that label, cut to
// MAX_TITLE. Any other first line gives ''. The body is written by the PR author, so it is only read here.
export function summaryLine(body) {
  const first = String(body || '').split(/\r?\n/, 1)[0].trim()
  return first.startsWith('Summary:') ? clip(first.slice('Summary:'.length).trim()) : ''
}

// A line of plain text: escaped for HTML, the same text for the plain version.
const text = (line) => ({ html: escapeHtml(line), plain: line })

// The commit line of production messages: the short id in code font, then the title.
const commitLine = (sha, title) =>
  sha ? { html: `<code>${escapeHtml(sha)}</code> ${escapeHtml(title)}`, plain: `${sha} ${title}` } : text(title)

// The shape of the template: a bold headline that links to the main page, the body lines, then the
// other links on one line, separated by " · ". The headline's link is the first link of the message.
function message([label, url], body, links = []) {
  const html = [`<b>${linkHtml(label, url)}</b>`, ...body.map((line) => line.html)]
  const plain = [linkPlain(label, url), ...body.map((line) => line.plain)]
  if (links.length) {
    html.push(links.map(([name, href]) => linkHtml(name, href)).join(' · '))
    plain.push(links.map(([name, href]) => linkPlain(name, href)).join(' · '))
  }
  return { html: html.join('\n'), plain: plain.join('\n') }
}

// Speed budget: the headline links to the run page (its summary holds the stage table), then the
// window, one line per stage over its p90 limit, and a line saying nothing is needed.
function speedMessage(data) {
  const headline = clip(data.title || SPEED_HEADLINE)
  const body = [data.window, ...(data.lines || []), 'Nothing needed: this check only warns.'].filter(Boolean)
  const html = [`<b>${linkHtml(headline, data.url)}</b>`, ...body.map(escapeHtml)]
  const plain = [linkPlain(headline, data.url), ...body]
  return { html: html.join('\n'), plain: plain.join('\n') }
}

// The "started" kinds: a headline that links to the issue, the title, and one line of what happens next.
const STARTED = {
  'cleanup-started': ['Cleanup review started', 'Nothing needed. An agent reviews the commits since the last review and opens up to three PRs.'],
  'weekly-started': ['Weekly review started', 'Nothing needed. An agent checks the signals and opens up to three PRs; owner items get the label owner.'],
}

// Returns { html, plain } for a kind, or null for an unknown kind. The first link is the headline's,
// so Telegram's link preview is drawn from it.
export function buildMessage(kind, data = {}) {
  const title = clip(data.title || '(no title)')
  if (STARTED[kind]) return message([STARTED[kind][0], data.url], [text(title), text(STARTED[kind][1])])
  const sha = String(data.sha || '').slice(0, 7)
  const pr = String(data.url || '').match(/\/pull\/(\d+)$/)?.[1]
  const summary = summaryLine(data.body)
  switch (kind) {
    case 'live':
      return message(['Production is live and tested', data.url || PROD_URL], [commitLine(sha, title), text('Nothing needed.')], data.runUrl ? [['See the run', data.runUrl]] : [])
    case 'failed':
      return message(
        ['Production smoke test failed', data.runUrl],
        [
          commitLine(sha, title),
          text('Production runs this commit, and its smoke test failed or did not run.'),
          text('Needs you: open the run and read the first failed step.'),
        ],
        [['Open production', PROD_URL]],
      )
    case 'preview':
      return message(
        ['Try it on preview', data.previewUrl || PREVIEW_URL],
        [text(title), ...(summary ? [text(`What changed: ${summary}`)] : []), text('Needs you: try the change on preview.')],
        [[pr ? `PR #${pr} on GitHub` : 'PR on GitHub', data.url]],
      )
    case 'owner':
      return message(
        [pr ? 'A PR needs you' : 'An issue needs you', data.url],
        [text(title), text('Needs you: open it and answer or do what it asks.')],
      )
    case 'cleanup':
      return message(
        ['Cleanup review ready', data.url],
        [
          text(title),
          ...(summary ? [text(`What it removes: ${summary}`)] : []),
          text('Needs you: review the PR, then merge or close it. Agents never merge a cleanup PR.'),
        ],
      )
    case 'speed':
      return speedMessage(data)
    default:
      return null
  }
}

// Reads the CLI values from the environment. Returns the message or null.
export function messageFromEnv(env = {}) {
  return buildMessage(env.NOTIFY_KIND || '', {
    sha: env.NOTIFY_SHA,
    title: env.NOTIFY_TITLE,
    url: env.NOTIFY_URL,
    runUrl: env.NOTIFY_RUN_URL,
    previewUrl: env.NOTIFY_PREVIEW_URL,
  })
}

// True when a 400 answer says Telegram could not parse the HTML. Reads the body once; never throws.
async function isParseError(res) {
  try {
    const body = await res.json()
    return /parse/i.test(String(body?.description || ''))
  } catch {
    return false
  }
}

// Sends one message: HTML first. If Telegram rejects the HTML (a parse error), sends the plain text
// once more, and never a third time. Returns 'skipped', 'sent' or 'failed'; never throws.
// `fetchImpl` and `log` are parameters so the tests can use fakes.
export async function notify({ token = '', chatId = '', html = '', plain = '', fetchImpl = fetch, log = console.log }) {
  if (!token || !chatId) {
    log('notify skipped: no Telegram secrets')
    return 'skipped'
  }
  if (!html && !plain) {
    log('notify skipped: no text')
    return 'skipped'
  }
  const send = (fields) =>
    fetchImpl(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, disable_web_page_preview: false, ...fields }),
    })
  try {
    let res = await send(html ? { text: html, parse_mode: 'HTML' } : { text: plain })
    if (res.status === 400 && html && plain && (await isParseError(res))) {
      log('notify: HTML rejected, sending plain text')
      res = await send({ text: plain })
    }
    if (!res.ok) {
      log(`notify failed: HTTP ${res.status}`)
      return 'failed'
    }
    log('notify sent')
    return 'sent'
  } catch (err) {
    // Print the error name only: a fetch error message can contain the request URL, which holds the token.
    log(`notify failed: ${err?.name || 'error'}`)
    return 'failed'
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const message = messageFromEnv(process.env)
  const sending = message
    ? notify({
        token: process.env.TELEGRAM_BOT_TOKEN || '',
        chatId: process.env.TELEGRAM_CHAT_ID || '',
        ...message,
      })
    : Promise.resolve(console.log('notify skipped: unknown kind'))
  sending
    .catch((err) => console.log(`notify failed: ${err?.name || 'error'}`))
    .finally(() => process.exit(0))
}
