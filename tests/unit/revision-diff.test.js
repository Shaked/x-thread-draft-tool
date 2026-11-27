import { describe, expect, it } from 'vitest'
import { WORD_DIFF_CAP, applyDiff, diffDrafts, diffWords, summaryLine } from '../../src/utils/revisionDiff.js'

// Seeded generator (mulberry32): the same 500 pairs every run, no network, no new dependency.
function rng(seed) {
  let s = seed >>> 0
  return () => {
    s = (s + 0x6d2b79f5) >>> 0
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const PIECES = [
  'שלום עולם',
  'הטיוטה הזאת',
  'Hello world',
  'a short English line',
  'emoji 👍🏽 skin tone',
  'family 👨‍👩‍👧 ZWJ',
  'flag 🇮🇱 and 🇺🇸',
  'café with a combining mark',
  '‏מעורב RTL mark',
  'keycap 1️⃣',
  '…',
  '#tag @user https://example.com/a?b=1',
  ''
]

function makeText(rand, maxPieces = 6) {
  const count = Math.floor(rand() * (maxPieces + 1))
  const parts = []
  for (let i = 0; i < count; i++) parts.push(PIECES[Math.floor(rand() * PIECES.length)])
  return parts.join(' ')
}

const IMAGES = [{ url: '/img/1.png' }, { url: '/img/2.png' }, { url: '/img/3.png' }]

function makePost(rand, id) {
  const images = []
  if (rand() < 0.2) images.push(IMAGES[Math.floor(rand() * IMAGES.length)])
  return { id, text: makeText(rand), images, embeddedTweet: rand() < 0.1 ? 'https://x.com/a/status/1' : null }
}

function makeDraft(rand, idPrefix) {
  const count = Math.floor(rand() * 9)
  const posts = []
  for (let i = 0; i < count; i++) {
    const reuse = i > 0 && rand() < 0.1
    posts.push(makePost(rand, reuse ? posts[i - 1].id : `${idPrefix}${i}`))
  }
  return { title: makeText(rand, 3), posts }
}

let nextId = 0
const freshId = () => `n${nextId++}`

// Applies 1 to 4 random changes to a draft: edits, adds, removes, moves, title, images, rewrites.
function mutate(rand, draft) {
  const d = { title: draft.title, posts: draft.posts.map((p) => ({ ...p, images: [...p.images] })) }
  const steps = 1 + Math.floor(rand() * 4)
  for (let s = 0; s < steps; s++) {
    const kind = Math.floor(rand() * 8)
    if (kind === 0 && d.posts.length) {
      const p = d.posts[Math.floor(rand() * d.posts.length)]
      p.text = `${p.text} ${makeText(rand, 2)}`.trim()
    } else if (kind === 1) {
      d.posts.splice(Math.floor(rand() * (d.posts.length + 1)), 0, makePost(rand, freshId()))
    } else if (kind === 2 && d.posts.length) {
      d.posts.splice(Math.floor(rand() * d.posts.length), 1)
    } else if (kind === 3 && d.posts.length > 1) {
      const [p] = d.posts.splice(Math.floor(rand() * d.posts.length), 1)
      d.posts.splice(Math.floor(rand() * (d.posts.length + 1)), 0, p)
    } else if (kind === 4) {
      d.title = makeText(rand, 3)
    } else if (kind === 5 && d.posts.length) {
      const p = d.posts[Math.floor(rand() * d.posts.length)]
      p.images = rand() < 0.5 ? [...p.images, IMAGES[0]] : p.images.slice(1)
    } else if (kind === 6 && d.posts.length) {
      const i = Math.floor(rand() * d.posts.length)
      d.posts[i] = makePost(rand, freshId())
    } else if (kind === 7 && d.posts.length) {
      const p = d.posts[Math.floor(rand() * d.posts.length)]
      p.embeddedTweet = p.embeddedTweet ? null : 'https://x.com/a/status/2'
    }
  }
  return d
}

// Grapheme boundary offsets of a string (never split by a diff part).
function graphemeBoundaries(s) {
  const seg = new Intl.Segmenter(undefined, { granularity: 'grapheme' })
  const set = new Set([0])
  let offset = 0
  for (const { segment } of seg.segment(s)) {
    offset += segment.length
    set.add(offset)
  }
  return set
}

// Every part boundary of diffWords(x, y) falls between grapheme clusters of both texts, and the parts rebuild both.
function expectWholeGraphemes(x, y) {
  const parts = diffWords(x, y)
  expect(parts.filter((p) => p.op !== 'del').map((p) => p.text).join('')).toBe(y)
  expect(parts.filter((p) => p.op !== 'ins').map((p) => p.text).join('')).toBe(x)
  for (const [text, keep] of [
    [y, (p) => p.op !== 'del'],
    [x, (p) => p.op !== 'ins']
  ]) {
    const bounds = graphemeBoundaries(text)
    let offset = 0
    for (const p of parts.filter(keep)) {
      offset += p.text.length
      expect(bounds.has(offset), `a part ends inside a grapheme in ${JSON.stringify(text)}`).toBe(true)
    }
  }
}

const emptyDiff = (d) =>
  d.title === null && d.added.length === 0 && d.removed.length === 0 && d.edited.length === 0 && d.moved.length === 0 && d.rewritten.length === 0

describe('revision diff core (#377)', () => {
  it('500 seeded pairs: applying the diff to a rebuilds b exactly', () => {
    const rand = rng(377)
    for (let i = 0; i < 500; i++) {
      const a = makeDraft(rand, `a${i}-`)
      const b = mutate(rand, a)
      const diff = diffDrafts(a, b)
      expect(applyDiff(a, diff), `pair ${i}`).toEqual(b)
    }
  })

  it('500 seeded pairs: a draft against itself gives an empty diff', () => {
    const rand = rng(378)
    for (let i = 0; i < 500; i++) {
      const a = makeDraft(rand, `s${i}-`)
      expect(emptyDiff(diffDrafts(a, a)), `draft ${i}`).toBe(true)
      expect(summaryLine(diffDrafts(a, a))).toBe('no changes')
    }
  })

  it('500 seeded pairs: word diffs rebuild both sides and never split a grapheme', () => {
    const rand = rng(379)
    for (let i = 0; i < 500; i++) {
      const x = makeText(rand, 8)
      const y = makeText(rand, 8)
      const parts = diffWords(x, y)
      const after = parts.filter((p) => p.op !== 'del').map((p) => p.text).join('')
      const before = parts.filter((p) => p.op !== 'ins').map((p) => p.text).join('')
      expect(after, `after ${i}`).toBe(y)
      expect(before, `before ${i}`).toBe(x)
      for (const [text, keep] of [
        [y, (p) => p.op !== 'del'],
        [x, (p) => p.op !== 'ins']
      ]) {
        const bounds = graphemeBoundaries(text)
        let offset = 0
        for (const p of parts.filter(keep)) {
          offset += p.text.length
          expect(bounds.has(offset), `pair ${i}: a part ends inside a grapheme`).toBe(true)
        }
      }
    }
  })

  it('hand case: an AI rewrite with new ids is a set of rewritten posts, with words when they are shared', () => {
    const a = {
      title: 'Launch',
      posts: [
        { id: 'p1', text: 'We ship the new editor today for every writer', images: [], embeddedTweet: null },
        { id: 'p2', text: 'It keeps drafts safe and fast on phones', images: [], embeddedTweet: null }
      ]
    }
    const b = {
      title: 'Launch',
      posts: [
        { id: 'q1', text: 'We ship the new editor today for every writer and team', images: [], embeddedTweet: null },
        { id: 'q2', text: 'Quantum butterflies negotiate with the ocean', images: [], embeddedTweet: null }
      ]
    }
    const d = diffDrafts(a, b)
    expect(d.added).toEqual([])
    expect(d.removed).toEqual([])
    expect(d.rewritten.map((r) => [r.fromId, r.toId, r.index])).toEqual([
      ['p1', 'q1', 0],
      ['p2', 'q2', 1]
    ])
    expect(d.rewritten[0].words).not.toBeNull()
    expect(d.rewritten[1].words).toBeNull()
    expect(applyDiff(a, d)).toEqual(b)
    expect(summaryLine(d)).toBe('rewrote post 1, rewrote post 2')
  })

  it('hand case: a post moved and edited keeps its id and appears as both moved and changed', () => {
    const post = (id, text) => ({ id, text, images: [], embeddedTweet: null })
    const a = { title: 'T', posts: [post('a', 'A'), post('b', 'B'), post('c', 'C'), post('d', 'D'), post('e', 'E')] }
    const b = { title: 'T', posts: [post('a', 'A'), post('e', 'E'), post('c', 'C'), post('d', 'D'), post('b', 'B changed')] }
    const d = diffDrafts(a, b)
    // a, c, d keep their order (the longest increasing run); b and e are the moves.
    expect(d.moved).toEqual([
      { id: 'b', n: 0, from: 1, to: 4 },
      { id: 'e', n: 0, from: 4, to: 1 }
    ])
    expect(d.edited.map((e) => [e.id, e.index])).toEqual([['b', 4]])
    expect(d.edited[0].words.map((p) => p.op)).toContain('ins')
    expect(applyDiff(a, d)).toEqual(b)
    expect(summaryLine(d)).toBe('changed post 5, moved post 2 to 5, moved post 5 to 2')
  })

  it('hand case: Hebrew, a changed word and a new emoji, in one post', () => {
    const before = 'שלום עולם 👍🏽 היום'
    const after = 'שלום לכולם 👍🏽 היום 🇮🇱'
    const parts = diffWords(before, after)
    expect(parts.filter((p) => p.op === 'del').map((p) => p.text)).toEqual(['עולם'])
    expect(parts.filter((p) => p.op === 'ins').map((p) => p.text).join('')).toContain('לכולם')
    expect(parts.filter((p) => p.op === 'ins').map((p) => p.text).join('')).toContain('🇮🇱')
  })

  it('hand case: an added post is placed after its neighbour, and an empty post is a post', () => {
    const post = (id, text) => ({ id, text, images: [], embeddedTweet: null })
    const a = { title: 'T', posts: [post('a', 'A'), post('b', 'B')] }
    const b = { title: 'T', posts: [post('a', 'A'), post('x', ''), post('b', 'B')] }
    const d = diffDrafts(a, b)
    expect(d.added).toEqual([{ id: 'x', n: 0, afterId: 'a', index: 1, post: post('x', '') }])
    expect(summaryLine(d)).toBe('added post 2 after post 1')
    expect(applyDiff(a, d)).toEqual(b)
  })

  it('hand case: image counts only, with no URL in the diff summary, and a title change', () => {
    const a = { title: 'Old', posts: [{ id: 'a', text: 'Hi', images: [{ url: 'https://cdn.example/1.png' }], embeddedTweet: null }] }
    const b = {
      title: 'New',
      posts: [{ id: 'a', text: 'Hi', images: [{ url: 'https://cdn.example/2.png' }, { url: 'https://cdn.example/3.png' }], embeddedTweet: null }]
    }
    const d = diffDrafts(a, b)
    expect(d.title).toEqual({ before: 'Old', after: 'New' })
    expect(d.edited[0].images).toEqual({ added: 2, removed: 1 })
    expect(d.edited[0].words).toBeNull()
    expect(summaryLine(d)).toBe('changed the title, changed post 1')
    expect(summaryLine(d)).not.toContain('http')
    expect(applyDiff(a, d)).toEqual(b)
  })

  it('hand case: two posts with one id stay two posts (the API allows it)', () => {
    const post = (id, text) => ({ id, text, images: [], embeddedTweet: null })
    const a = { title: 'T', posts: [post('x', 'first'), post('x', 'second'), post('y', 'Y')] }
    expect(emptyDiff(diffDrafts(a, a))).toBe(true)
    const b = { title: 'T', posts: [post('x', 'first'), post('x', 'second edited'), post('y', 'Y')] }
    const d = diffDrafts(a, b)
    expect(d.edited.map((e) => [e.id, e.n, e.index])).toEqual([['x', 1, 1]])
    expect(d.removed).toEqual([])
    expect(applyDiff(a, d)).toEqual(b)
    const c = { title: 'T', posts: [post('x', 'second'), post('y', 'Y')] }
    const removal = diffDrafts(a, c)
    // Occurrences match by position: the first x now reads "second" and the second x is gone.
    expect(removal.removed).toEqual([{ id: 'x', n: 1, index: 1 }])
    expect(removal.edited.map((e) => [e.id, e.n, e.index])).toEqual([['x', 0, 0]])
    expect(applyDiff(a, removal)).toEqual(c)
  })

  it('hand case: a missing text and a null image list count as empty, never as the word "undefined"', () => {
    const a = { title: 'T', posts: [{ id: 'a', text: 'Hello', images: null, embeddedTweet: null }] }
    const b = { title: 'T', posts: [{ id: 'a', images: [{ url: '/u' }], embeddedTweet: null }] }
    const d = diffDrafts(a, b)
    expect(d.edited[0].words).toEqual([{ op: 'del', text: 'Hello' }])
    expect(d.edited[0].images).toEqual({ added: 1, removed: 0 })
    expect(JSON.stringify(d)).not.toContain('undefined')
    expect(applyDiff(a, d)).toEqual(b)
    expect(emptyDiff(diffDrafts(b, b))).toBe(true)
  })

  it('a total rewrite of about 20 KB finishes in under 200 ms and still rebuilds exactly', () => {
    const before = Array.from({ length: 2500 }, (_, i) => `alpha${i}`).join(' ')
    const after = Array.from({ length: 2500 }, (_, i) => `beta${i}`).join(' ')
    expect(before.length).toBeGreaterThan(20_000)
    const started = performance.now()
    const parts = diffWords(before, after)
    expect(performance.now() - started).toBeLessThan(200)
    expect(parts.filter((p) => p.op !== 'ins').map((p) => p.text).join('')).toBe(before)
    expect(parts.filter((p) => p.op !== 'del').map((p) => p.text).join('')).toBe(after)
    const a = { title: 'T', posts: [{ id: 'p', text: before, images: [], embeddedTweet: null }] }
    const b = { title: 'T', posts: [{ id: 'p', text: after, images: [], embeddedTweet: null }] }
    expect(applyDiff(a, diffDrafts(a, b))).toEqual(b)
  })

  it('the word diff cap: exact up to WORD_DIFF_CAP tokens, one deletion and one insertion above it', () => {
    // Every word changes at both ends and every other word in between, so no common start or end is taken off.
    const pair = (words) => {
      const before = Array.from({ length: words }, (_, i) => `w${i}`).join(' ')
      const after = Array.from({ length: words }, (_, i) => (i % 2 === 0 || i === words - 1 ? `c${i}` : `w${i}`)).join(' ')
      return [before, after]
    }
    // 2 * (2 * words - 1) tokens across both texts: 500 words give 1998 tokens (at the cap), 501 give 2002.
    const [beforeAtCap, afterAtCap] = pair(500)
    const exact = diffWords(beforeAtCap, afterAtCap)
    expect(exact.length).toBeGreaterThan(3)
    expect(exact.filter((p) => p.op !== 'ins').map((p) => p.text).join('')).toBe(beforeAtCap)

    const [beforeOver, afterOver] = pair(501)
    expect(2 * (2 * 501 - 1)).toBeGreaterThan(WORD_DIFF_CAP)
    const capped = diffWords(beforeOver, afterOver)
    expect(capped.map((p) => p.op)).toEqual(['del', 'ins'])
    expect(capped.filter((p) => p.op !== 'ins').map((p) => p.text).join('')).toBe(beforeOver)
    expect(capped.filter((p) => p.op !== 'del').map((p) => p.text).join('')).toBe(afterOver)
  })

  it('a null or missing posts list, a null post and a null draft do not throw and still rebuild', () => {
    const p = { id: 'a', text: 'Hi', images: [], embeddedTweet: null }
    const d1 = diffDrafts(null, { title: 'T', posts: [p] })
    expect(applyDiff(null, d1)).toEqual({ title: 'T', posts: [p] })
    const noList = { title: 'T' }
    expect(applyDiff(noList, diffDrafts(noList, { title: 'T', posts: [p] }))).toEqual({ title: 'T', posts: [p] })
    const a = { title: 'T', posts: [p] }
    const b = { title: 'T', posts: [null, p, undefined] }
    const d2 = diffDrafts(a, b)
    expect(applyDiff(a, d2)).toEqual(b)
    expect(emptyDiff(diffDrafts(b, b))).toBe(true)
    expect(summaryLine(diffDrafts(null, null))).toBe('no changes')
  })

  it('ids that look alike stay apart: null vs a missing id, NaN, objects', () => {
    const text = (id, t) => ({ id, text: t, images: [], embeddedTweet: null })
    // A post with id null and a post with no id are two posts; a second one must not collapse into the first.
    const pairs = [
      [[text(null, 'x')], [null, text(null, 'x')]],
      [[{ text: 'x' }], [{ text: 'x' }, text(null, 'x')]],
      [[text(NaN, 'x')], [text(NaN, 'x'), text(NaN, 'y')]],
      [[text({ k: 1 }, 'x')], [text({ k: 1 }, 'x'), text({ k: 1 }, 'y')]],
      [[text(Infinity, 'x')], [text(null, 'x'), text(Infinity, 'y')]]
    ]
    for (const [posts, bPosts] of pairs) {
      const a = { title: 'T', posts }
      const b = { title: 'T', posts: bPosts }
      const d = diffDrafts(a, b)
      expect(emptyDiff(d)).toBe(false)
      expect(applyDiff(a, d)).toEqual(b)
    }
  })

  it('fuzz: null posts and null, undefined and NaN ids still rebuild exactly (2,000 seeded pairs)', () => {
    const rand = rng(4242)
    const ids = [undefined, null, NaN, 'a', 'b', 1, { k: 1 }]
    const fuzzPost = () => {
      const r = rand()
      if (r < 0.1) return null
      if (r < 0.15) return undefined
      return { id: ids[Math.floor(rand() * ids.length)], text: makeText(rand, 2), images: [], embeddedTweet: null }
    }
    const fuzzDraft = () => ({ title: 'T', posts: Array.from({ length: Math.floor(rand() * 6) }, fuzzPost) })
    for (let i = 0; i < 2000; i++) {
      const a = fuzzDraft()
      const b = rand() < 0.5 ? fuzzDraft() : { title: 'T', posts: [...a.posts].sort(() => rand() - 0.5) }
      expect(applyDiff(a, diffDrafts(a, b)), `pair ${i}`).toEqual(b)
    }
  })

  it('the edit limit: more edits than WORD_DIFF_MAX_EDITS (within the token cap) gives one deletion and one insertion', () => {
    // The two texts share their spaces, so the common part is 399 spaces and the exact diff needs 1,100 edits:
    // above WORD_DIFF_MAX_EDITS (1,000), under WORD_DIFF_CAP (1,898 tokens). Without the limit it is 1,199 parts.
    const before = Array.from({ length: 400 }, (_, i) => `a${i}`).join(' ')
    const after = Array.from({ length: 550 }, (_, i) => `b${i}`).join(' ')
    const parts = diffWords(before, after)
    expect(parts.map((p) => p.op)).toEqual(['del', 'ins'])
    expect(parts.filter((p) => p.op !== 'ins').map((p) => p.text).join('')).toBe(before)
    expect(parts.filter((p) => p.op !== 'del').map((p) => p.text).join('')).toBe(after)
  })

  it('one 125 KB post with a tiny edit at the end is fast and rebuilds exactly (Node 20 in CI)', () => {
    // Codex measured the full segmentation of this case at about 5 s on Node 20; only the changed end is segmented now.
    const before = 'word '.repeat(25000)
    const after = `${before}edit`
    const started = performance.now()
    const parts = diffWords(before, after)
    expect(performance.now() - started).toBeLessThan(500)
    expect(parts.filter((p) => p.op !== 'ins').map((p) => p.text).join('')).toBe(before)
    expect(parts.filter((p) => p.op !== 'del').map((p) => p.text).join('')).toBe(after)
  })

  it('one 125 KB post rewritten in full is bounded and rebuilds exactly', () => {
    const before = Array.from({ length: 25000 }, (_, i) => `alpha${i}`).join(' ')
    const after = Array.from({ length: 25000 }, (_, i) => `beta${i}`).join(' ')
    const started = performance.now()
    const parts = diffWords(before, after)
    expect(performance.now() - started).toBeLessThan(500)
    expect(parts.filter((p) => p.op !== 'ins').map((p) => p.text).join('')).toBe(before)
    expect(parts.filter((p) => p.op !== 'del').map((p) => p.text).join('')).toBe(after)
  })

  it('no part ends inside a grapheme cluster: skin tones, ZWJ families, astral marks, a halfwidth voiced mark', () => {
    const cases = [
      ['a b', 'a \u{1F3FD}b'],
      ['a b', 'a \u{1F468}\u200D\u{1F469}\u200D\u{1F467}b'],
      ['a b', 'a \u{1D165}b'],
      ['a b', 'a \uFF9Eb'],
      ['a \u{1F3FD} b', 'a \u{1F3FD} c \uFF9E'],
      ['x \u{1F3FD}', 'x \u{1F3FD}\u{1F3FD} z']
    ]
    for (const [x, y] of cases) expectWholeGraphemes(x, y)
  })

  it('fuzz: 1,000 seeded pairs with spaces next to clusters that must not be split', () => {
    const rand = rng(9090)
    const pieces = ['a', 'b', ' ', ' ', '\u{1F3FD}', '\u{1F468}\u200D\u{1F469}', '\u{1D165}', '\uFF9E', 'e\u0301', '\u65E5', '\u200D', '\u{1F1EE}\u{1F1F1}']
    const text = () => Array.from({ length: Math.floor(rand() * 14) }, () => pieces[Math.floor(rand() * pieces.length)]).join('')
    for (let i = 0; i < 1000; i++) {
      const x = text()
      const y = rand() < 0.5 ? text() : x.slice(0, Math.floor(rand() * (x.length + 1))) + text()
      expectWholeGraphemes(x, y)
    }
  })

  it('a long text with no spaces keeps its fine diff: Japanese, Thai and Chinese with one character inserted', () => {
    const samples = [
      '日本語の文章をテストします。',
      'ภาษาไทยทดสอบการเปรียบเทียบ',
      '中文测试文本的比较和差异。'
    ]
    for (const sample of samples) {
      const before = sample.repeat(Math.ceil(3000 / sample.length))
      const cut = Math.floor(before.length / 2)
      const after = `${before.slice(0, cut)}字${before.slice(cut)}`
      const parts = diffWords(before, after)
      const changed = parts.filter((p) => p.op !== 'same')
      expect(changed.map((p) => p.text).join('').length).toBeLessThan(10)
      expect(parts.filter((p) => p.op !== 'ins').map((p) => p.text).join('')).toBe(before)
      expect(parts.filter((p) => p.op !== 'del').map((p) => p.text).join('')).toBe(after)
    }
  })

  it('a large post whose id changes is a rewrite with no word count, and it is fast', () => {
    const big = 'word '.repeat(25000)
    const a = { title: 'T', posts: [{ id: 'a', text: big, images: [], embeddedTweet: null }] }
    const b = { title: 'T', posts: [{ id: 'b', text: `${big}edit`, images: [], embeddedTweet: null }] }
    const started = performance.now()
    const d = diffDrafts(a, b)
    expect(performance.now() - started).toBeLessThan(500)
    expect(d.rewritten.map((r) => [r.fromId, r.toId])).toEqual([['a', 'b']])
    expect(d.rewritten[0].words).toBeNull()
    expect(applyDiff(a, d)).toEqual(b)
  })

  it('a rewrite of a short post keeps its word diff when enough words are shared', () => {
    const a = { title: 'T', posts: [{ id: 'a', text: 'We ship the new editor today for every writer', images: [], embeddedTweet: null }] }
    const b = { title: 'T', posts: [{ id: 'b', text: 'We ship the new editor today for every writer and team', images: [], embeddedTweet: null }] }
    const d = diffDrafts(a, b)
    expect(d.rewritten[0].words).not.toBeNull()
    expect(applyDiff(a, d)).toEqual(b)
  })

  it('a 1 MB draft: a few edits, a move and an add are found, and the rebuild matches', () => {
    const posts = []
    for (let i = 0; i < 3600; i++) posts.push({ id: `m${i}`, text: `${'Word '.repeat(55)}${i} 👍🏽`, images: [], embeddedTweet: null })
    const a = { title: 'Big', posts }
    const b = {
      title: 'Big',
      posts: [
        ...posts.slice(0, 10),
        { ...posts[10], text: `${posts[10].text} edited` },
        ...posts.slice(11, 2000),
        posts[3000],
        ...posts.slice(2000, 3000),
        { id: 'new', text: 'Brand new post', images: [], embeddedTweet: null },
        ...posts.slice(3001)
      ]
    }
    const size = JSON.stringify(a).length
    expect(size).toBeGreaterThan(1_000_000)
    const d = diffDrafts(a, b)
    expect(d.added.map((e) => e.id)).toEqual(['new'])
    expect(d.moved.length).toBeGreaterThan(0)
    expect(applyDiff(a, d)).toEqual(b)
  })
})
