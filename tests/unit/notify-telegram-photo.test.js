// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildMessage, notify, readPhoto, cutCaption, findScreenshot, CAPTION_MAX, PHOTO_MAX } from '../../scripts/notify-telegram.mjs'

const TOKEN = '123456:FAKE-TEST-TOKEN'
const SHA = 'a11392e1234567890abcdef'
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(100, 1)])
const REL = 'docs/changelogs/img/20261128-010101-demo.png'

let root
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'tgphoto-'))
  mkdirSync(join(root, 'docs/changelogs/img'), { recursive: true })
  writeFileSync(join(root, REL), PNG)
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

const visible = (html) => Array.from(html.replace(/<[^>]*>/g, '').replace(/&[a-z]+;/g, '_')).length

function recorder(...answers) {
  const calls = []
  const list = answers.length ? answers : [{ status: 200 }]
  const fetchImpl = vi.fn(async (url, init) => {
    calls.push({ url, init })
    const a = list.shift() || list[list.length - 1]
    if (a.throw) throw Object.assign(new Error(`boom ${url}`), { name: 'TypeError' })
    return { ok: a.status < 300, status: a.status, json: async () => a.body || {} }
  })
  return { calls, fetchImpl }
}

describe('sendPhoto for the live kind', () => {
  it('sends a multipart request whose caption equals the text of sendMessage', async () => {
    const msg = buildMessage('live', { sha: SHA, title: 'Fix the thing' })
    const { calls, fetchImpl } = recorder()
    const logs = []
    expect(await notify({ token: TOKEN, chatId: '42', ...msg, photo: REL, root, fetchImpl, log: (l) => logs.push(l) })).toBe('sent')
    expect(calls).toHaveLength(1)
    expect(calls[0].url).toBe(`https://api.telegram.org/bot${TOKEN}/sendPhoto`)
    const form = calls[0].init.body
    expect(form).toBeInstanceOf(FormData)
    expect(form.get('chat_id')).toBe('42')
    expect(form.get('parse_mode')).toBe('HTML')
    expect(form.get('caption')).toBe(msg.html)
    const file = form.get('photo')
    expect(file.type).toBe('image/png')
    expect(Buffer.from(await file.arrayBuffer())).toEqual(PNG)
    expect(logs.join('\n')).not.toContain(TOKEN)
  })

  it.each([
    ['an API error', { status: 500 }],
    ['a network error', { throw: true }],
  ])('falls back to sendMessage on %s, and never logs the token', async (_n, first) => {
    const msg = buildMessage('live', { sha: SHA, title: 'Fix' })
    const { calls, fetchImpl } = recorder(first, { status: 200 })
    const logs = []
    expect(await notify({ token: TOKEN, chatId: '42', ...msg, photo: REL, root, fetchImpl, log: (l) => logs.push(l) })).toBe('sent')
    expect(calls.map((c) => c.url.split('/').pop())).toEqual(['sendPhoto', 'sendMessage'])
    expect(JSON.parse(calls[1].init.body).text).toBe(msg.html)
    expect(logs.join('\n')).not.toContain(TOKEN)
  })

  it('falls back to sendMessage when the file is missing or too big', async () => {
    const msg = buildMessage('live', { sha: SHA, title: 'Fix' })
    writeFileSync(join(root, 'docs/changelogs/img/big.png'), Buffer.concat([PNG, Buffer.alloc(PHOTO_MAX)]))
    for (const photo of ['docs/changelogs/img/none.png', 'docs/changelogs/img/big.png']) {
      const { calls, fetchImpl } = recorder()
      await notify({ token: TOKEN, chatId: '42', ...msg, photo, root, fetchImpl, log: () => {} })
      expect(calls.map((c) => c.url.split('/').pop())).toEqual(['sendMessage'])
    }
  })

  it('sends text only when no photo is given', async () => {
    const { calls, fetchImpl } = recorder()
    await notify({ token: TOKEN, chatId: '42', ...buildMessage('live', { sha: SHA, title: 'x' }), fetchImpl, log: () => {} })
    expect(calls.map((c) => c.url.split('/').pop())).toEqual(['sendMessage'])
  })

  it('keeps a long title and a Hebrew title in the caption', async () => {
    for (const title of ['x'.repeat(500), 'תיקון הכפתור בשרשור <b> & "ציטוט"']) {
      const msg = buildMessage('live', { sha: SHA, title })
      const { calls, fetchImpl } = recorder()
      await notify({ token: TOKEN, chatId: '42', ...msg, photo: REL, root, fetchImpl, log: () => {} })
      const caption = calls[0].init.body.get('caption')
      expect(caption).toBe(msg.html)
      expect(visible(caption)).toBeLessThanOrEqual(CAPTION_MAX)
    }
  })
})

describe('cutCaption', () => {
  it('leaves a short caption alone', () => {
    expect(cutCaption('<b>a</b> b')).toBe('<b>a</b> b')
  })
  it('cuts to 1024 visible characters and closes open tags and links', () => {
    const html = `<b>App</b> · <a href="https://example.com/x?a=1&amp;b=2">${'שלום &amp; '.repeat(300)}</a>`
    const out = cutCaption(html)
    expect(visible(out)).toBeLessThanOrEqual(CAPTION_MAX)
    expect(out.endsWith('…</a>')).toBe(true)
    expect(out).toContain('<a href="https://example.com/x?a=1&amp;b=2">')
    expect(out).not.toMatch(/&[a-z]*$/)
    expect((out.match(/<a /g) || []).length).toBe((out.match(/<\/a>/g) || []).length)
  })
  it('never splits an emoji or an entity', () => {
    const out = cutCaption('😀'.repeat(2000))
    expect(Array.from(out).every((c) => c === '😀' || c === '…')).toBe(true)
    expect(cutCaption('&amp;'.repeat(2000)).replace(/&amp;/g, '').replace('…', '')).toBe('')
  })
})

describe('readPhoto: path validation', () => {
  it('accepts the changelog image', () => {
    expect(readPhoto(REL, root)?.bytes).toEqual(PNG)
  })
  it.each([
    ['..'],
    ['docs/changelogs/img/../../../etc/passwd.png'],
    ['../docs/changelogs/img/20261128-010101-demo.png'],
    ['/etc/passwd'],
    ['docs/changelogs/other/a.png'],
    ['docs/changelogs/a.png'],
    ['src/a.png'],
    ['docs/changelogs/img/a.jpg'],
    ['docs/changelogs/img/a.png.txt'],
    ['docs/changelogs/img/sub/a.png'],
    ['docs/changelogs/img/..png'],
    ['docs/changelogs/img/a b.png'],
    [''],
    [null],
  ])('rejects %s', (rel) => {
    expect(readPhoto(rel, root)).toBeNull()
  })
  it('rejects a symlink to a file, a symlinked folder, a directory, a non-PNG and a big file', () => {
    const outside = mkdtempSync(join(tmpdir(), 'tgout-'))
    try {
      writeFileSync(join(outside, 'secret.png'), PNG)
      symlinkSync(join(outside, 'secret.png'), join(root, 'docs/changelogs/img/link.png'))
      expect(readPhoto('docs/changelogs/img/link.png', root)).toBeNull()
      mkdirSync(join(root, 'docs/changelogs/img/dir.png'))
      expect(readPhoto('docs/changelogs/img/dir.png', root)).toBeNull()
      writeFileSync(join(root, 'docs/changelogs/img/text.png'), 'not a png')
      expect(readPhoto('docs/changelogs/img/text.png', root)).toBeNull()
      writeFileSync(join(root, 'docs/changelogs/img/big.png'), Buffer.concat([PNG, Buffer.alloc(PHOTO_MAX)]))
      expect(readPhoto('docs/changelogs/img/big.png', root)).toBeNull()
      const other = mkdtempSync(join(tmpdir(), 'tgroot-'))
      mkdirSync(join(other, 'docs/changelogs'), { recursive: true })
      symlinkSync(outside, join(other, 'docs/changelogs/img'))
      writeFileSync(join(outside, '20261128-010101-demo.png'), PNG)
      expect(readPhoto(REL, other)).toBeNull()
      rmSync(other, { recursive: true, force: true })
    } finally {
      rmSync(outside, { recursive: true, force: true })
    }
  })
})

describe('findScreenshot', () => {
  const fakeGit = (entries) => (args) => {
    if (args[0] === 'diff') return entries.map(([status, path]) => `${status}\t${path}`).join('\n')
    const path = args[1].split(':')[1]
    return entries.find(([, p]) => p === path)[2]
  }
  const E = 'docs/changelogs/20261128-010101-demo.md'
  it('returns the image of an added entry with a screenshot line', () => {
    expect(findScreenshot(SHA, { git: fakeGit([['A', E, 'Title\nScreenshot: img/20261128-010101-demo.png\n']]) })).toBe(REL)
    expect(findScreenshot(SHA, { git: fakeGit([['A', E, 'Screenshot: ![x](img/20261128-010101-demo.png)']]) })).toBe(REL)
  })
  it('returns nothing for "not needed", another name, a changed entry, a bad sha or a git error', () => {
    expect(findScreenshot(SHA, { git: fakeGit([['A', E, 'Screenshot: not needed, CI only']]) })).toBe('')
    expect(findScreenshot(SHA, { git: fakeGit([['A', E, 'Screenshot: img/../../x.png']]) })).toBe('')
    expect(findScreenshot(SHA, { git: fakeGit([['A', E, 'Screenshot: img/other.png']]) })).toBe('')
    expect(findScreenshot(SHA, { git: fakeGit([['M', E, 'Screenshot: img/20261128-010101-demo.png']]) })).toBe('')
    expect(findScreenshot('--upload-pack=x', { git: () => { throw new Error('no') } })).toBe('')
    expect(findScreenshot(SHA, { git: () => { throw new Error('no') } })).toBe('')
  })
})
