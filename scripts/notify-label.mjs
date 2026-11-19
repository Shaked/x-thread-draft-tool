#!/usr/bin/env node
// Telegram notice for the labels `try-preview` (on a PR) and `owner` (on an issue or PR).
// Epic #241, task N2. Node 20, no dependencies. Run by .github/workflows/notify-labels.yml from
// the default branch; the event values come in through environment variables:
//
//   LABEL_NAME, SENDER_LOGIN, OWNER_LOGIN, TARGET_IS_PR ('true'|'false'), TARGET_TITLE, TARGET_URL
//
// Only a label added by the repository owner sends. Without the two Telegram secrets it prints a
// skip line and exits 0 (see notify-telegram.mjs). It never throws and never prints a secret.

import { pathToFileURL } from 'node:url'
import { notify } from './notify-telegram.mjs'

export const PREVIEW_URL = 'https://x-thread-draft-tool-preview.vercel.app'
// The title is cut first so the URL at the end of each message always survives the 400-character cut.
export const MAX_TITLE = 200

// Returns the text to send, or null when this event sends nothing.
export function labelText({ label = '', sender = '', owner = '', isPr = false, title = '', url = '' }) {
  if (!owner || String(sender).toLowerCase() !== String(owner).toLowerCase()) return null
  const shortTitle = Array.from(String(title)).slice(0, MAX_TITLE).join('') || '(no title)'
  if (label === 'try-preview') {
    if (!isPr) return null
    return `Try it on preview: ${shortTitle}. Preview: ${PREVIEW_URL} . PR: ${url}`
  }
  if (label === 'owner') return `Needs you: ${shortTitle}. ${url}`
  return null
}

// Builds the message from the environment and sends it. `fetchImpl` and `log` are parameters for tests.
export async function run(env = {}, { fetchImpl = fetch, log = console.log } = {}) {
  const text = labelText({
    label: env.LABEL_NAME || '',
    sender: env.SENDER_LOGIN || '',
    owner: env.OWNER_LOGIN || '',
    isPr: env.TARGET_IS_PR === 'true',
    title: env.TARGET_TITLE || '',
    url: env.TARGET_URL || '',
  })
  if (text === null) {
    log('notify skipped: this label event sends nothing')
    return 'skipped'
  }
  return notify({ token: env.TELEGRAM_BOT_TOKEN || '', chatId: env.TELEGRAM_CHAT_ID || '', text, fetchImpl, log })
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run(process.env)
    .catch((err) => console.log(`notify failed: ${err?.name || 'error'}`))
    .finally(() => process.exit(0))
}
