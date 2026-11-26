#!/usr/bin/env node
// Telegram notices (epic #241, tasks N1, N2, N4). Node 20, no dependencies.
//
// buildMessage(kind, data) returns { html, plain }. The shapes are the forms in
// .claude/reply-style-templates/telegram-message.md (plan #369, step 7):
//   Every kind starts with its emoji, the app name in bold and the headline.
//   live             production is live and the smoke test passed
//   failed           production smoke test failed (the only urgent one)
//   preview          a PR got the label try-preview: try it on the preview URL
//   owner            the repository owner added the label owner: needs you
//   cleanup          a PR got the label cleanup-pr (epic #255, task C3): review the cleanup PR
//   cleanup-started  the daily workflow opened a cleanup review issue
//   weekly-started   the weekly workflow opened a weekly review issue (epic #273, task #295)
//   speed            a stage is over its limit: the Alert shape (speed-metrics.mjs, tasks #310 and #446)
//   metrics          a metrics alert (errors, slow, capacity): the Alert shape, linked to /admin/metrics (task #338)
//
// CLI (the workflows pass every value through environment variables, never inside the shell text):
//   NOTIFY_KIND, NOTIFY_SHA, NOTIFY_TITLE, NOTIFY_URL, NOTIFY_RUN_URL, NOTIFY_PREVIEW_URL,
//   NOTIFY_HEADLINE, NOTIFY_NUMBER_LINE, NOTIFY_CAUSE_LINE, NOTIFY_ACTION_LINE (kind metrics),
//   TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID
// The app identity (issue #504) is read from the environment too, with defaults from DEFAULT_APP:
//   TELEGRAM_APP_NAME, TELEGRAM_APP_REPO_URL, TELEGRAM_APP_SITE_URL, TELEGRAM_APP_PREVIEW_URL
// Without both secrets it prints a skip line and exits 0. A network or API error prints the HTTP
// status only and also exits 0, so a notice can never fail a workflow. The token and the request
// URL are never printed.

import { pathToFileURL } from 'node:url'

// The one place that names the app (issue #504). The channel is shared with other apps, so every
// message starts with the app name. Another repo sets TELEGRAM_APP_NAME and the three URLs; no template
// or message builder below types a name or an address.
export const DEFAULT_APP = {
  name: 'Thread Draft',
  repoUrl: 'https://github.com/Shaked/x-thread-draft-tool',
  siteUrl: 'https://x-thread-draft-tool.vercel.app',
  previewUrl: 'https://x-thread-draft-tool-preview.vercel.app',
}
export const PROD_URL = DEFAULT_APP.siteUrl
export const PREVIEW_URL = DEFAULT_APP.previewUrl
// Titles are cut before escaping, so a tag is never cut in half. Escaping can grow a title up to
// six times, so the longest message stays far under Telegram's 4096-character limit.
export const MAX_TITLE = 120

export const REPO_URL = DEFAULT_APP.repoUrl
export const MAX_APP_NAME = 40

// One emoji per kind, at the start of the headline (owner decision, issue #463). It sits outside the
// bold link so the link text stays clean. A section with nothing to say is never written: no
// "Nothing needed" line exists in any kind.
export const EMOJI = {
  live: '✅',
  failed: '🚨',
  preview: '👀',
  owner: '🙋',
  cleanup: '🧹',
  'cleanup-started': '🧹',
  'weekly-started': '🗓',
  speed: '🐢',
  metrics: '🚨',
}

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

// The app identity for one message: the defaults, then the environment. A name is cut to MAX_APP_NAME;
// an address that is not https:// is ignored.
export function appFromEnv(env = process.env) {
  // One line, no bold markers: a newline or * would break line 1 or the lint.
  const name = clip(String(env.TELEGRAM_APP_NAME || '').replace(/[\p{C}*]/gu, ' ').replace(/\s+/g, ' ').trim(), MAX_APP_NAME)
  return {
    name: name || DEFAULT_APP.name,
    repoUrl: safeUrl(env.TELEGRAM_APP_REPO_URL) || DEFAULT_APP.repoUrl,
    siteUrl: safeUrl(env.TELEGRAM_APP_SITE_URL) || DEFAULT_APP.siteUrl,
    previewUrl: safeUrl(env.TELEGRAM_APP_PREVIEW_URL) || DEFAULT_APP.previewUrl,
  }
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

// The shape of the template: line 1 is the kind's emoji, the app name in bold, " · " and the headline,
// which links to the main page. Then the body lines, then the other links on one line, separated by
// " · ". The headline's link is the first link of the message. Every kind goes through here, so none can
// leave out the app name.
function message(kind, app, [label, url], body, links = []) {
  if (!EMOJI[kind]) throw new Error(`no emoji for the kind ${kind}`)
  const html = [`${EMOJI[kind]} <b>${escapeHtml(app.name)}</b> · ${linkHtml(label, url)}`, ...body.map((line) => line.html)]
  const plain = [`${EMOJI[kind]} ${app.name} · ${linkPlain(label, url)}`, ...body.map((line) => line.plain)]
  if (links.length) {
    html.push(links.map(([name, href]) => linkHtml(name, href)).join(' · '))
    plain.push(links.map(([name, href]) => linkPlain(name, href)).join(' · '))
  }
  return { html: html.join('\n'), plain: plain.join('\n') }
}

// Alert shape (task M7, plan #439 section 6): the headline (what is over, in plain words) links to the gate
// issue or the run, then the number, the likely cause, and what is needed when someone must act. At most two links.
function alertMessage(data, app, kind = 'speed') {
  // The metrics kind links the app's own metrics page; the speed kind links its gate issue or run.
  const headline = clip(data.headline || (kind === 'metrics' ? 'Metrics alert' : 'Delivery is slower than its limit'))
  const url = kind === 'metrics' ? `${app.siteUrl}/admin/metrics` : data.url
  const body = [data.numberLine, data.causeLine, data.actionLine].filter(Boolean).map((line) => text(clip(line, 300)))
  return message(kind, app, [headline, url], body, (data.links || []).slice(0, 2))
}

// Production passed: the headline and "Open production" both link the site; the commit has its own link.
function liveMessage(data, title, sha, fullSha, app) {
  const prod = data.url || app.siteUrl
  const links = [['Open production', prod]]
  if (sha) links.push([`Commit ${sha}`, `${app.repoUrl}/commit/${fullSha}`])
  if (data.runUrl) links.push(['See the run', data.runUrl])
  return message('live', app, ['Production is live and tested', prod], [commitLine(sha, title)], links)
}

// Only a hex commit id is used, for the label, the code line and the commit link.
function commitIds(value) {
  const fullSha = /^[0-9a-f]{7,40}$/i.test(String(value || '').trim()) ? String(value).trim() : ''
  return { fullSha, sha: fullSha.slice(0, 7) }
}

// The kinds buildMessage builds. The golden test needs one fixture for each.
export const KINDS = Object.keys(EMOJI)

// Returns { html, plain } for a kind, or null for an unknown kind. The first link is the headline's,
// so Telegram's link preview is drawn from it.
export function buildMessage(kind, data = {}, app = appFromEnv()) {
  const title = clip(data.title || '(no title)')
  const { fullSha, sha } = commitIds(data.sha)
  const pr = String(data.url || '').match(/\/pull\/(\d+)$/)?.[1]
  const summary = summaryLine(data.body)
  switch (kind) {
    case 'live':
      return liveMessage(data, title, sha, fullSha, app)
    case 'failed':
      return message(
        'failed',
        app,
        ['Production smoke test failed', data.runUrl],
        [
          commitLine(sha, title),
          text('Production runs this commit, and its smoke test failed or did not run.'),
          text('Needs you: open the run and read the first failed step.'),
        ],
        [['Open production', app.siteUrl]],
      )
    case 'preview':
      return message(
        'preview',
        app,
        ['Try it on preview', data.previewUrl || app.previewUrl],
        [text(title), ...(summary ? [text(`What changed: ${summary}`)] : []), text('Needs you: try the change on preview.')],
        [[pr ? `PR #${pr} on GitHub` : 'PR on GitHub', data.url]],
      )
    case 'owner':
      return message(
        'owner',
        app,
        [pr ? 'A PR needs you' : 'An issue needs you', data.url],
        [text(title), text('Needs you: open it and answer or do what it asks.')],
      )
    case 'cleanup':
      return message(
        'cleanup',
        app,
        ['Cleanup review ready', data.url],
        [
          text(title),
          ...(summary ? [text(`What it removes: ${summary}`)] : []),
          text('Needs you: review the PR, then merge or close it. Agents never merge a cleanup PR.'),
        ],
      )
    case 'weekly-started':
      return message(
        'weekly-started',
        app,
        ['Weekly review started', data.url],
        [text(title), text('An agent checks the signals and opens up to three PRs; owner items get the label owner.')],
      )
    case 'cleanup-started':
      return message(
        'cleanup-started',
        app,
        ['Cleanup review started', data.url],
        [text(title), text('An agent reviews the commits since the last review and opens up to three PRs.')],
      )
    case 'speed':
    case 'metrics':
      return alertMessage(data, app, kind)
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
    headline: env.NOTIFY_HEADLINE,
    numberLine: env.NOTIFY_NUMBER_LINE,
    causeLine: env.NOTIFY_CAUSE_LINE,
    actionLine: env.NOTIFY_ACTION_LINE,
  }, appFromEnv(env))
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
