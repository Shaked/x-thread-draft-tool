#!/usr/bin/env node
// Telegram notice for CI (epic #241, task N1). Node 20, no dependencies.
//
//   TELEGRAM_BOT_TOKEN=... TELEGRAM_CHAT_ID=... NOTIFY_TEXT="..." node scripts/notify-telegram.mjs
//
// The text comes from NOTIFY_TEXT or the first argument. Without both secrets it prints a skip
// line and exits 0. A network or API error prints the HTTP status only and also exits 0, so a
// notice can never fail a workflow. The token and the request URL are never printed.

import { pathToFileURL } from 'node:url'

export const MAX_TEXT = 400

// Cut to MAX_TEXT code points (Array.from keeps surrogate pairs whole).
export function clip(text) {
  return Array.from(String(text)).slice(0, MAX_TEXT).join('')
}

// Sends one plain-text message. `fetchImpl` and `log` are parameters so the tests can use fakes.
// Returns 'skipped', 'sent' or 'failed'; never throws.
export async function notify({ token = '', chatId = '', text = '', fetchImpl = fetch, log = console.log }) {
  if (!token || !chatId) {
    log('notify skipped: no Telegram secrets')
    return 'skipped'
  }
  if (!text) {
    log('notify skipped: no text')
    return 'skipped'
  }
  try {
    const res = await fetchImpl(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: clip(text), disable_web_page_preview: false }),
    })
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
  notify({
    token: process.env.TELEGRAM_BOT_TOKEN || '',
    chatId: process.env.TELEGRAM_CHAT_ID || '',
    text: process.env.NOTIFY_TEXT || process.argv[2] || '',
  })
    .catch((err) => console.log(`notify failed: ${err?.name || 'error'}`))
    .finally(() => process.exit(0))
}
