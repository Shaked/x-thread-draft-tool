import { describe, expect, it } from 'vitest'
import { applyDiff, diffDrafts, diffWords, summaryLine } from '../../src/utils/revisionDiff.js'

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
  for (let i = 0; i < count; i++) posts.push(makePost(rand, `${idPrefix}${i}`))
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
      { id: 'b', from: 1, to: 4 },
      { id: 'e', from: 4, to: 1 }
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
    expect(d.added).toEqual([{ id: 'x', afterId: 'a', index: 1, post: post('x', '') }])
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
