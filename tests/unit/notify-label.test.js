// @vitest-environment node
import { describe, it, expect, vi } from 'vitest'
import { labelMessage, run } from '../../scripts/notify-label.mjs'
import { buildMessage, PREVIEW_URL, MAX_TITLE } from '../../scripts/notify-telegram.mjs'

const TOKEN = '123456:FAKE-TEST-TOKEN'
const OWNER = 'Owner-Login'
const PR_URL = 'https://github.com/Owner-Login/repo/pull/12'
const ISSUE_URL = 'https://github.com/Owner-Login/repo/issues/34'

const base = { sender: OWNER, owner: OWNER, title: 'Add the thing', url: PR_URL }

describe('labelMessage', () => {
  it('picks the preview kind for try-preview on a PR', () => {
    expect(labelMessage({ ...base, label: 'try-preview', isPr: true })).toEqual({
      kind: 'preview',
      data: { title: 'Add the thing', url: PR_URL },
    })
  })

  it('picks the owner kind for an issue and for a PR', () => {
    expect(labelMessage({ ...base, label: 'owner', isPr: false, url: ISSUE_URL })).toEqual({
      kind: 'owner',
      data: { title: 'Add the thing', url: ISSUE_URL },
    })
    expect(labelMessage({ ...base, label: 'owner', isPr: true })).toEqual({
      kind: 'owner',
      data: { title: 'Add the thing', url: PR_URL },
    })
  })

  it('sends nothing for try-preview on an issue', () => {
    expect(labelMessage({ ...base, label: 'try-preview', isPr: false, url: ISSUE_URL })).toBeNull()
  })

  it('picks the cleanup kind for cleanup-pr on a PR, with the body for the summary line', () => {
    expect(labelMessage({ ...base, label: 'cleanup-pr', isPr: true, body: 'Summary: x' })).toEqual({
      kind: 'cleanup',
      data: { title: 'Add the thing', url: PR_URL, body: 'Summary: x' },
    })
  })

  it('sends nothing for cleanup-pr on an issue, or when someone other than the owner adds it', () => {
    expect(labelMessage({ ...base, label: 'cleanup-pr', isPr: false, url: ISSUE_URL })).toBeNull()
    expect(labelMessage({ ...base, label: 'cleanup-pr', isPr: true, sender: 'someone-else' })).toBeNull()
  })

  it('sends nothing for any other label', () => {
    for (const label of ['bug', 'task', 'stop', '']) {
      expect(labelMessage({ ...base, label, isPr: true })).toBeNull()
    }
  })

  it('sends nothing when the sender is not the repository owner', () => {
    expect(labelMessage({ ...base, sender: 'someone-else', label: 'owner' })).toBeNull()
    expect(labelMessage({ ...base, sender: '', label: 'owner' })).toBeNull()
    expect(labelMessage({ ...base, owner: '', label: 'owner' })).toBeNull()
  })

  it('matches the owner login without regard to case', () => {
    expect(labelMessage({ ...base, sender: 'owner-login', label: 'owner' })).toEqual({
      kind: 'owner',
      data: { title: 'Add the thing', url: PR_URL },
    })
  })

  it('passes a markup-like title through unchanged (the template escapes it later)', () => {
    const title = '*bold* <b>x</b> [link](http://e.x) `code`'
    expect(labelMessage({ ...base, title, label: 'owner' }).data.title).toBe(title)
  })

  it('a 5000-character title is cut to MAX_TITLE, and the PR link survives the template', () => {
    const long = 'é😀'.repeat(2500)
    const { kind, data } = labelMessage({ ...base, title: long, label: 'owner' })
    const msg = buildMessage(kind, data)
    expect(msg.html).toContain(PR_URL)
    expect(Array.from(msg.plain.split('\n')[1]).length).toBe(MAX_TITLE)
    expect(msg.html.length).toBeLessThan(4096)
  })
})

function fakeFetch(...answers) {
  const list = answers.length ? answers : [{ status: 200 }]
  return vi.fn(async () => {
    const a = list.shift() || list[list.length - 1]
    return { ok: a.status >= 200 && a.status < 300, status: a.status, json: async () => ({}) }
  })
}

function logger() {
  const lines = []
  return { lines, log: (line) => lines.push(String(line)) }
}

describe('run', () => {
  const env = {
    LABEL_NAME: 'owner',
    SENDER_LOGIN: OWNER,
    OWNER_LOGIN: OWNER,
    TARGET_IS_PR: 'true',
    TARGET_TITLE: 'T',
    TARGET_URL: PR_URL,
    TELEGRAM_BOT_TOKEN: TOKEN,
    TELEGRAM_CHAT_ID: '42',
  }

  it('skips with no call when the Telegram secrets are missing', async () => {
    const fetchImpl = fakeFetch()
    const { lines, log } = logger()
    const result = await run({ ...env, TELEGRAM_BOT_TOKEN: '' }, { fetchImpl, log })
    expect(result).toBe('skipped')
    expect(fetchImpl).not.toHaveBeenCalled()
    expect(lines).toEqual(['notify skipped: no Telegram secrets'])
  })

  it('skips with no call for a label event that sends nothing', async () => {
    const fetchImpl = fakeFetch()
    const { lines, log } = logger()
    expect(await run({ ...env, LABEL_NAME: 'bug' }, { fetchImpl, log })).toBe('skipped')
    expect(fetchImpl).not.toHaveBeenCalled()
    expect(lines).toEqual(['notify skipped: this label event sends nothing'])
  })

  it('sends the owner notice as HTML with the PR link', async () => {
    const fetchImpl = fakeFetch({ status: 200 })
    const { lines, log } = logger()
    expect(await run(env, { fetchImpl, log })).toBe('sent')
    const body = JSON.parse(fetchImpl.mock.calls[0][1].body)
    expect(body.parse_mode).toBe('HTML')
    expect(body.text).toContain(`href="${PR_URL}"`)
    expect(lines).toEqual(['notify sent'])
  })

  it('sends the try-preview notice with the preview link first', async () => {
    const fetchImpl = fakeFetch({ status: 200 })
    const { log } = logger()
    await run({ ...env, LABEL_NAME: 'try-preview' }, { fetchImpl, log })
    const body = JSON.parse(fetchImpl.mock.calls[0][1].body)
    expect(body.text.indexOf(PREVIEW_URL)).toBeLessThan(body.text.indexOf(PR_URL))
  })

  it('sends the cleanup notice with the summary line from the PR body', async () => {
    const fetchImpl = fakeFetch({ status: 200 })
    const { lines, log } = logger()
    const result = await run(
      { ...env, LABEL_NAME: 'cleanup-pr', TARGET_BODY: 'Summary: Drop dead helpers\n\nDetails' },
      { fetchImpl, log },
    )
    expect(result).toBe('sent')
    const body = JSON.parse(fetchImpl.mock.calls[0][1].body)
    expect(body.text).toContain(`<b>Thread Draft</b> · <a href="${PR_URL}">Cleanup review ready</a>`)
    expect(body.text).toContain('\nT\n')
    expect(body.text).toContain('What it removes: Drop dead helpers')
    expect(body.text.endsWith('Needs you: review the PR, then merge or close it. Agents never merge a cleanup PR.')).toBe(true)
    expect(lines).toEqual(['notify sent'])
  })

  it('escapes a title with markup before it is sent', async () => {
    const fetchImpl = fakeFetch({ status: 200 })
    const { log } = logger()
    await run({ ...env, TARGET_TITLE: '<img src=x onerror=alert(1)>' }, { fetchImpl, log })
    const body = JSON.parse(fetchImpl.mock.calls[0][1].body)
    expect(body.text).toContain('&lt;img src=x onerror=alert(1)&gt;')
    expect(body.text).not.toContain('<img')
  })
})
