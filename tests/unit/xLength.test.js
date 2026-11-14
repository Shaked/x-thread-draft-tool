import { describe, expect, it } from 'vitest'
import { splitIntoThreads } from '../../src/utils/threadSplitter.js'
import { buildEmojiRegex, xFitEnd, xLength } from '../../src/utils/xLength.js'

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

  it('cuts only at grapheme boundaries', () => {
    const family = '👨‍👩‍👧'
    const end = xFitEnd(family.repeat(10), 5)
    expect(end).toBe(family.length * 2)
  })
})
