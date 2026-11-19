// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { splitIntoThreads } from '../../src/utils/threadSplitter.js'
import { buildEmojiRegex, graphemeWeight, xFitEnd, xLength } from '../../src/utils/xLength.js'

describe('xLength (X weighted length)', () => {
  it('falls back to the u-flag pattern when the v flag is refused (Safari 16 and older)', () => {
    const refusesV = (source, flags) => {
      if (flags === 'v') throw new SyntaxError('Invalid regular expression flags')
      return new RegExp(source, flags)
    }
    const fallback = buildEmojiRegex(refusesV)
    expect(fallback.flags).toBe('u')
    expect(fallback.test('😀')).toBe(true)
    expect(fallback.test('a')).toBe(false)
    expect(buildEmojiRegex().flags).toBe('v')
  })

  it.each([
    ['', 0],
    ['abc', 3],
    ['א'.repeat(280), 280],
    ['שלום 👍🏽', 7],
    ['👨‍👩‍👧', 2],
    ['🇮🇱', 2],
    ['日本', 4],
    ['©', 1],
    [`see https://example.com/${'a'.repeat(200)}`, 27],
    ['see https://example.com/x y', 29],
    ['www.example.com', 23],
    ['see https://example.com/.', 28],
    ['example.com', 11]
  ])('counts %j as %i', (text, expected) => {
    expect(xLength(text)).toBe(expected)
  })

  it('counts a decomposed letter the same as its composed form', () => {
    expect(xLength('é')).toBe(1)
  })

  it('counts a post of 141 emoji as 282', () => {
    expect(xLength('😀'.repeat(141))).toBe(282)
  })

  it('ends a URL at a closing paren that closes nothing (Codex review)', () => {
    expect(xLength(`(https://example.com)${'a'.repeat(280)}`)).toBe(1 + 23 + 1 + 280)
  })

  it('keeps a balanced paren inside a URL, as in Wikipedia links', () => {
    expect(xLength('https://en.wikipedia.org/wiki/Foo_(bar)')).toBe(23)
    expect(xLength('https://en.wikipedia.org/wiki/Foo_(bar) tail')).toBe(23 + 5)
  })

  it('ends a URL at an angle bracket', () => {
    expect(xLength(`<https://example.com>${'a'.repeat(10)}`)).toBe(1 + 23 + 1 + 10)
  })

  it('does not count "https://." as a URL', () => {
    expect(xLength('https://.')).toBe(9)
  })

  it('counts a 100 KB URL and a 100 KB hostile paren run quickly (Codex review)', () => {
    const hostile = [`https://a${'('.repeat(50000)}`, `https://a${'a('.repeat(50000)}`, `https://${'(a'.repeat(50000)}`]
    for (const text of [`https://example.com/${'a'.repeat(100000)}`, ...hostile]) {
      const start = performance.now()
      xLength(text)
      expect(performance.now() - start).toBeLessThan(500)
    }
  })

  it('counts a 100 KB text quickly', () => {
    const start = performance.now()
    expect(xLength('a'.repeat(100000))).toBe(100000)
    expect(performance.now() - start).toBeLessThan(500)
  })
})

describe('splitIntoThreads with X weighted length', () => {
  it('keeps a 280-character Hebrew post in one piece', () => {
    const text = 'א'.repeat(280)
    expect(splitIntoThreads(text)).toEqual([text])
  })

  it('never cuts inside a URL', () => {
    const url = `https://example.com/${'a.b'.repeat(40)}`
    const text = `${'word '.repeat(50)}${url} tail text here`
    const chunks = splitIntoThreads(text)
    expect(chunks.length).toBeGreaterThan(1)
    expect(chunks.some((chunk) => chunk.includes(url))).toBe(true)
    for (const chunk of chunks) expect(xLength(chunk)).toBeLessThanOrEqual(280)
  })

  it('keeps each chunk within the limit for emoji text', () => {
    const chunks = splitIntoThreads('😀 '.repeat(200))
    expect(chunks.length).toBeGreaterThan(1)
    for (const chunk of chunks) expect(xLength(chunk)).toBeLessThanOrEqual(280)
  })

  it('splits a 100 KB text with URLs quickly and keeps each URL whole (Codex review)', () => {
    const url = `https://example.com/${'a'.repeat(100000)}`
    const start = performance.now()
    const chunks = splitIntoThreads(`${'see '.repeat(100)}${url}`)
    expect(performance.now() - start).toBeLessThan(500)
    expect(chunks.some((chunk) => chunk.includes(url))).toBe(true)
    for (const chunk of chunks) expect(xLength(chunk)).toBeLessThanOrEqual(280)
  })

  it('splits 100 KB of short URLs quickly and loses no word (Codex review)', () => {
    const text = 'https://a.co/x '.repeat(6500)
    const start = performance.now()
    const chunks = splitIntoThreads(text)
    expect(performance.now() - start).toBeLessThan(500)
    expect(chunks.join(' ').split(/\s+/)).toEqual(text.trim().split(/\s+/))
    for (const chunk of chunks) expect(xLength(chunk)).toBeLessThanOrEqual(280)
  })

  it('cuts only at grapheme boundaries', () => {
    const family = '👨‍👩‍👧'
    const end = xFitEnd(family.repeat(10), 5)
    expect(end).toBe(family.length * 2)
  })
})

describe('xLength in the old-browser fallback (no v flag)', () => {
  const refusesV = (source, flags) => {
    if (flags === 'v') throw new SyntaxError('Invalid regular expression flags')
    return new RegExp(source, flags)
  }
  const fallback = buildEmojiRegex(refusesV)
  // The fallback's weight for a string: each Intl.Segmenter grapheme weighed with the fallback matcher.
  const weighFallback = (text) =>
    [...new Intl.Segmenter().segment(text.normalize('NFC'))].reduce(
      (sum, { segment }) => sum + graphemeWeight(segment, fallback),
      0
    )
  const ENGLAND = '\u{1F3F4}\u{E0067}\u{E0062}\u{E0065}\u{E006E}\u{E0067}\u{E007F}'

  it.each([
    ['👍🏽', 2],
    ['👨‍👩‍👧', 2],
    ['🇮🇱', 2],
    ['1️⃣', 2],
    ['#️⃣', 2],
    ['❤️', 2],
    [ENGLAND, 2],
    ['a', 1],
    ['א', 1],
    ['©', 1],
    ['1', 1]
  ])('weighs %j as %i in the fallback and in the normal path', (text, expected) => {
    expect(weighFallback(text)).toBe(expected)
    expect(xLength(text)).toBe(expected)
  })

  it('weighs 100 skin-tone thumbs as 200 in both paths', () => {
    const text = '👍🏽'.repeat(100)
    expect(weighFallback(text)).toBe(200)
    expect(xLength(text)).toBe(200)
  })

  it.each([
    'a', 'א', '1', '©', '®', '日本', '😀😀', '👍', '👍🏽', '👍🏽👍🏽', 'a👍🏽b', '👍 👍🏽',
    '👨‍👩‍👧', '👩🏽‍💻', '🧑‍🤝‍🧑', '🏳️‍🌈', '🇮🇱', '🇺🇸', '🇮🇱🇮', '🇺', '1️⃣', '*️⃣', '0️⃣',
    '❤️', '❤', '☺️', '☺', '✌🏽', '©️', '\u{1F3FB}', ENGLAND, 'e\u0301', 'שלום 👍🏽'
  ])('keeps the fallback weight of %j equal to the normal path', (text) => {
    expect(weighFallback(text)).toBe(xLength(text))
  })

  it('keeps the \\p{Emoji} prefilter: text without an emoji code point is not an emoji', () => {
    expect(fallback.test('a')).toBe(false)
    expect(xLength('abc')).toBe(3)
  })
})
