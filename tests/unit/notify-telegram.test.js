// @vitest-environment node
import { describe, it, expect, vi } from 'vitest'
import { clip, notify, MAX_TEXT } from '../../scripts/notify-telegram.mjs'

const TOKEN = '123456:FAKE-TEST-TOKEN'

function fakeFetch(status = 200) {
  return vi.fn(async () => ({ ok: status >= 200 && status < 300, status }))
}

function logger() {
  const lines = []
  return { lines, log: (line) => lines.push(String(line)) }
}

describe('notify-telegram', () => {
  it('skips with no call when a secret is missing or empty', async () => {
    for (const secrets of [{ token: '', chatId: '1' }, { token: TOKEN, chatId: '' }, {}]) {
      const fetchImpl = fakeFetch()
      const { lines, log } = logger()
      const result = await notify({ ...secrets, text: 'hello', fetchImpl, log })
      expect(result).toBe('skipped')
      expect(fetchImpl).not.toHaveBeenCalled()
      expect(lines).toEqual(['notify skipped: no Telegram secrets'])
    }
  })

  it('skips when there is no text', async () => {
    const fetchImpl = fakeFetch()
    const { lines, log } = logger()
    expect(await notify({ token: TOKEN, chatId: '1', text: '', fetchImpl, log })).toBe('skipped')
    expect(fetchImpl).not.toHaveBeenCalled()
    expect(lines).toEqual(['notify skipped: no text'])
  })

  it('sends one plain-text message with the right body', async () => {
    const fetchImpl = fakeFetch(200)
    const { lines, log } = logger()
    const result = await notify({ token: TOKEN, chatId: '42', text: 'Production is live', fetchImpl, log })
    expect(result).toBe('sent')
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    const [url, init] = fetchImpl.mock.calls[0]
    expect(url).toBe(`https://api.telegram.org/bot${TOKEN}/sendMessage`)
    expect(init.method).toBe('POST')
    const body = JSON.parse(init.body)
    expect(body).toEqual({ chat_id: '42', text: 'Production is live', disable_web_page_preview: false })
    expect(body).not.toHaveProperty('parse_mode')
    expect(lines).toEqual(['notify sent'])
  })

  it('cuts the text to 400 characters', async () => {
    const long = 'a'.repeat(500)
    const fetchImpl = fakeFetch(200)
    await notify({ token: TOKEN, chatId: '42', text: long, fetchImpl, log: () => {} })
    const body = JSON.parse(fetchImpl.mock.calls[0][1].body)
    expect(body.text).toHaveLength(MAX_TEXT)
    expect(body.text).toBe('a'.repeat(MAX_TEXT))
  })

  it('clip keeps surrogate pairs whole', () => {
    const text = '😀'.repeat(MAX_TEXT + 1)
    const cut = clip(text)
    expect(Array.from(cut)).toHaveLength(MAX_TEXT)
    expect(cut).toBe('😀'.repeat(MAX_TEXT))
  })

  it('an HTTP 500 still resolves, prints only the status, and never the token', async () => {
    const fetchImpl = fakeFetch(500)
    const { lines, log } = logger()
    const result = await notify({ token: TOKEN, chatId: '42', text: 'x', fetchImpl, log })
    expect(result).toBe('failed')
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
    const result = await notify({ token: TOKEN, chatId: '42', text: 'x', fetchImpl, log })
    expect(result).toBe('failed')
    expect(lines).toEqual(['notify failed: TypeError'])
    const output = lines.join('\n')
    expect(output).not.toContain(TOKEN)
    expect(output).not.toContain('api.telegram.org')
  })
})
