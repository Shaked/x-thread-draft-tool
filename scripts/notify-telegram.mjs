#!/usr/bin/env node
// Telegram notices (epic #241, tasks N1, N2, N4). Node 20, no dependencies.
//
// One template for all four kinds: buildMessage(kind, data) returns { html, plain }.
//   live    production is live and the smoke test passed
//   failed  production smoke test failed (the only urgent one)
//   preview a PR got the label try-preview: try it on the preview URL
//   owner   the repository owner added the label owner: needs you
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

const KINDS = {
  live: { emoji: '✅', headline: 'Production is live and tested', extra: 'Smoke tests passed.' },
  failed: { emoji: '🚨', headline: 'Production smoke FAILED', extra: 'The smoke test did not pass.' },
  preview: { emoji: '👀', headline: 'Try it on preview' },
  owner: { emoji: '🙋', headline: 'Needs you' },
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

function linkHtml(label, url) {
  const href = safeUrl(url)
  return href ? `<a href="${escapeHtml(href)}">${escapeHtml(label)}</a>` : escapeHtml(label)
}

function linkPlain(label, url) {
  const href = safeUrl(url)
  return href ? `${label}: ${href}` : label
}

// Returns { html, plain } for a kind, or null for an unknown kind. The first link is the main
// one, so Telegram's link preview is drawn from it.
export function buildMessage(kind, data = {}) {
  const spec = KINDS[kind]
  if (!spec) return null
  const title = clip(data.title || '(no title)')
  const sha = String(data.sha || '').slice(0, 7)

  let links
  if (kind === 'live') links = [['Open production', data.url || PROD_URL]]
  else if (kind === 'failed') links = [['See the failed run', data.runUrl]]
  else if (kind === 'preview') {
    const number = String(data.url || '').match(/\/pull\/(\d+)$/)?.[1]
    links = [['Open preview', data.previewUrl || PREVIEW_URL], [number ? `PR #${number}` : 'PR', data.url]]
  }
  else links = [['Open', data.url]]

  const html = [`${spec.emoji} <b>${escapeHtml(spec.headline)}</b>`]
  const plain = [`${spec.emoji} ${spec.headline}`]
  if (sha) {
    html.push(`<code>${escapeHtml(sha)}</code> ${escapeHtml(title)}`)
    plain.push(`${sha} ${title}`)
  } else {
    html.push(escapeHtml(title))
    plain.push(title)
  }
  if (spec.extra) {
    html.push(escapeHtml(spec.extra))
    plain.push(spec.extra)
  }
  html.push(links.map(([label, url]) => linkHtml(label, url)).join(' · '))
  plain.push(links.map(([label, url]) => linkPlain(label, url)).join(' · '))
  return { html: html.join('\n'), plain: plain.join('\n') }
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
