// @vitest-environment node
import { describe, it, expect, vi } from 'vitest'
import { labelText, run, PREVIEW_URL, MAX_TITLE } from '../../scripts/notify-label.mjs'
import { MAX_TEXT } from '../../scripts/notify-telegram.mjs'

const TOKEN = '123456:FAKE-TEST-TOKEN'
const OWNER = 'Owner-Login'
const PR_URL = 'https://github.com/Owner-Login/repo/pull/12'
const ISSUE_URL = 'https://github.com/Owner-Login/repo/issues/34'

const base = { sender: OWNER, owner: OWNER, title: 'Add the thing', url: PR_URL }

describe('labelText', () => {
  it('builds the try-preview text for a PR', () => {
    expect(labelText({ ...base, label: 'try-preview', isPr: true })).toBe(
      `Try it on preview: Add the thing. Preview: ${PREVIEW_URL} . PR: ${PR_URL}`,
    )
  })

  it('builds the owner text for an issue and for a PR', () => {
    expect(labelText({ ...base, label: 'owner', isPr: false, url: ISSUE_URL })).toBe(
      `Needs you: Add the thing. ${ISSUE_URL}`,
    )
    expect(labelText({ ...base, label: 'owner', isPr: true })).toBe(`Needs you: Add the thing. ${PR_URL}`)
  })

  it('sends nothing for try-preview on an issue', () => {
    expect(labelText({ ...base, label: 'try-preview', isPr: false, url: ISSUE_URL })).toBeNull()
  })

  it('sends nothing for any other label', () => {
    for (const label of ['bug', 'task', 'stop', '']) {
      expect(labelText({ ...base, label, isPr: true })).toBeNull()
    }
  })

  it('sends nothing when the sender is not the repository owner', () => {
    expect(labelText({ ...base, sender: 'someone-else', label: 'owner' })).toBeNull()
    expect(labelText({ ...base, sender: '', label: 'owner' })).toBeNull()
    expect(labelText({ ...base, owner: '', label: 'owner' })).toBeNull()
  })

  it('matches the owner login without regard to case', () => {
    expect(labelText({ ...base, sender: 'owner-login', label: 'owner' })).toBe(`Needs you: Add the thing. ${PR_URL}`)
  })

  it('uses a placeholder for an empty title', () => {
    expect(labelText({ ...base, title: '', label: 'owner' })).toBe(`Needs you: (no title). ${PR_URL}`)
  })

  it('keeps the URL and the 400-character limit for a 5000-character title', () => {
    const long = 'é😀'.repeat(2500)
    for (const [label, isPr] of [['owner', false], ['try-preview', true]]) {
      const text = labelText({ ...base, title: long, label, isPr })
      expect(Array.from(text).length).toBeLessThanOrEqual(MAX_TEXT)
      expect(text).toContain(PR_URL)
      expect(text).toContain('é😀'.repeat(MAX_TITLE / 2))
      expect(text).not.toContain('é😀'.repeat(MAX_TITLE / 2 + 1))
    }
  })

  it('keeps a title with the markup characters as plain text', () => {
    const title = '*bold* <b>x</b> [link](http://e.x) `code`'
    expect(labelText({ ...base, title, label: 'owner' })).toBe(`Needs you: ${title}. ${PR_URL}`)
  })
})

function fakeFetch(status = 200) {
  return vi.fn(async () => ({ ok: status >= 200 && status < 300, status }))
}

function logger() {
  const lines = []
  return { lines, log: (line) => lines.push(String(line)) }
}

describe('run', () => {
  const env = { LABEL_NAME: 'owner', SENDER_LOGIN: OWNER, OWNER_LOGIN: OWNER, TARGET_IS_PR: 'true', TARGET_TITLE: 'T', TARGET_URL: PR_URL }

  it('skips with no call when the Telegram secrets are missing', async () => {
    for (const secrets of [{}, { TELEGRAM_BOT_TOKEN: TOKEN }, { TELEGRAM_CHAT_ID: '1' }]) {
      const fetchImpl = fakeFetch()
      const { lines, log } = logger()
      expect(await run({ ...env, ...secrets }, { fetchImpl, log })).toBe('skipped')
      expect(fetchImpl).not.toHaveBeenCalled()
      expect(lines).toEqual(['notify skipped: no Telegram secrets'])
    }
  })

  it('skips with no call for an event that sends nothing', async () => {
    const fetchImpl = fakeFetch()
    const { lines, log } = logger()
    const secrets = { TELEGRAM_BOT_TOKEN: TOKEN, TELEGRAM_CHAT_ID: '42' }
    expect(await run({ ...env, ...secrets, SENDER_LOGIN: 'outsider' }, { fetchImpl, log })).toBe('skipped')
    expect(await run({ ...env, ...secrets, LABEL_NAME: 'try-preview', TARGET_IS_PR: 'false' }, { fetchImpl, log })).toBe('skipped')
    expect(fetchImpl).not.toHaveBeenCalled()
    expect(lines).toEqual(['notify skipped: this label event sends nothing', 'notify skipped: this label event sends nothing'])
  })

  it('sends one plain-text message for an owner label event', async () => {
    const fetchImpl = fakeFetch(200)
    const { lines, log } = logger()
    const result = await run({ ...env, TELEGRAM_BOT_TOKEN: TOKEN, TELEGRAM_CHAT_ID: '42' }, { fetchImpl, log })
    expect(result).toBe('sent')
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    const [url, init] = fetchImpl.mock.calls[0]
    expect(url).toBe(`https://api.telegram.org/bot${TOKEN}/sendMessage`)
    const body = JSON.parse(init.body)
    expect(body.chat_id).toBe('42')
    expect(body.text).toBe(`Needs you: T. ${PR_URL}`)
    expect(body).not.toHaveProperty('parse_mode')
    expect(lines).toEqual(['notify sent'])
  })

  it('a failed send still resolves and prints no token', async () => {
    const fetchImpl = vi.fn(async () => {
      throw Object.assign(new Error(`failed https://api.telegram.org/bot${TOKEN}/sendMessage`), { name: 'TypeError' })
    })
    const { lines, log } = logger()
    expect(await run({ ...env, TELEGRAM_BOT_TOKEN: TOKEN, TELEGRAM_CHAT_ID: '42' }, { fetchImpl, log })).toBe('failed')
    expect(lines).toEqual(['notify failed: TypeError'])
    expect(lines.join('\n')).not.toContain(TOKEN)
  })
})
