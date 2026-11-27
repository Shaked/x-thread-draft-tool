/**
 * Revision diff core (E273 task H4, #377): what changed between two drafts, by post id and by word.
 * Shared by the browser and the server, so it has no imports (like xLength.js).
 *
 * A draft is { title, posts }. A post is { id, text, images, embeddedTweet }.
 *
 * Output of diffDrafts(a, b):
 * - title: null, or { before, after }.
 * - added: [{ id, afterId, index, post }]: index is the place in b; afterId is the post before it in b (null first).
 * - removed: [{ id, index }]: index is the place in a.
 * - edited: [{ id, index, words, post, images? }]: the post changed in place; words is the word diff of the text
 *   (null when the text did not change); images is { added, removed } counts when the images changed (no URLs).
 * - moved: [{ id, from, to }]: the longest increasing run of common posts keeps its place; the rest are moves.
 * - rewritten: [{ fromId, toId, index, words, post }]: a removed and an added post at the same index, paired.
 *   words is the word diff when at least 30 % of the words are shared, else null.
 * `post` carries the new post, so applyDiff can rebuild b. It is data for the caller, never text for a person:
 * summaryLine() reads only positions.
 */

const WORDS = new Intl.Segmenter(undefined, { granularity: 'word' })
const REWRITE_SHARE = 0.3

const tokenize = (text) => Array.from(WORDS.segment(text), (s) => s.segment)
const wordTokens = (text) =>
  Array.from(WORDS.segment(text))
    .filter((s) => s.isWordLike)
    .map((s) => s.segment)

// Stable text form of a value (sorted keys), used to compare posts and images.
function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value && typeof value === 'object') {
    const keys = Object.keys(value)
      .filter((k) => value[k] !== undefined)
      .sort()
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`
  }
  return JSON.stringify(value) ?? 'null'
}

/** Myers diff of two arrays. Returns [{ op: 'same' | 'del' | 'ins', value }] in order. */
function myers(a, b) {
  const n = a.length
  const m = b.length
  const max = n + m
  let v = new Map([[1, 0]])
  const trace = []
  let found = false
  for (let d = 0; d <= max && !found; d++) {
    trace.push(v)
    v = new Map(v)
    for (let k = -d; k <= d; k += 2) {
      let x = k === -d || (k !== d && v.get(k - 1) < v.get(k + 1)) ? v.get(k + 1) : v.get(k - 1) + 1
      let y = x - k
      while (x < n && y < m && a[x] === b[y]) {
        x++
        y++
      }
      v.set(k, x)
      if (x >= n && y >= m) {
        found = true
        break
      }
    }
  }
  const ops = []
  let x = n
  let y = m
  for (let d = trace.length - 1; d >= 0; d--) {
    const vd = trace[d]
    const k = x - y
    const prevK = k === -d || (k !== d && vd.get(k - 1) < vd.get(k + 1)) ? k + 1 : k - 1
    const prevX = vd.get(prevK)
    const prevY = prevX - prevK
    while (x > prevX && y > prevY) {
      ops.push({ op: 'same', value: a[x - 1] })
      x--
      y--
    }
    if (d > 0) ops.push(x === prevX ? { op: 'ins', value: b[y - 1] } : { op: 'del', value: a[x - 1] })
    x = prevX
    y = prevY
  }
  return ops.reverse()
}

/** Joins neighbouring parts with the same op. */
function runs(ops) {
  const out = []
  for (const { op, value } of ops) {
    const last = out[out.length - 1]
    if (last && last.op === op) last.text += value
    else out.push({ op, text: value })
  }
  return out
}

/**
 * Word diff of two texts: [{ op: 'same' | 'del' | 'ins', text }]. The cut is Intl.Segmenter's word cut, so
 * grapheme clusters are never split. Joining the 'same' and 'ins' parts gives `after`; 'same' and 'del' give `before`.
 */
export function diffWords(before, after) {
  return runs(myers(tokenize(before), tokenize(after)))
}

/** Index pairs of a longest strictly increasing run of `values` (values are distinct). Returns a Set of positions. */
function longestIncreasing(values) {
  const tails = []
  const prev = new Array(values.length)
  for (let i = 0; i < values.length; i++) {
    let lo = 0
    let hi = tails.length
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (values[tails[mid]] < values[i]) lo = mid + 1
      else hi = mid
    }
    prev[i] = lo > 0 ? tails[lo - 1] : -1
    tails[lo] = i
  }
  const keep = new Set()
  for (let i = tails.length ? tails[tails.length - 1] : -1; i >= 0; i = prev[i]) keep.add(i)
  return keep
}

/** Image counts without URLs: how many images were added to and removed from a post. */
function imageChanges(before = [], after = []) {
  const left = new Map()
  for (const img of before) {
    const key = canonical(img)
    left.set(key, (left.get(key) ?? 0) + 1)
  }
  let added = 0
  for (const img of after) {
    const key = canonical(img)
    if (left.get(key) > 0) left.set(key, left.get(key) - 1)
    else added++
  }
  let removed = 0
  for (const count of left.values()) removed += count
  return { added, removed }
}

/** Word diff for a rewritten post, or null when fewer than 30 % of the words are shared (it would be noise). */
function rewriteWords(before, after) {
  const x = wordTokens(before)
  const y = wordTokens(after)
  const total = Math.max(x.length, y.length)
  if (total === 0) return diffWords(before, after)
  const left = new Map()
  for (const w of x) left.set(w, (left.get(w) ?? 0) + 1)
  let shared = 0
  for (const w of y) {
    if (left.get(w) > 0) {
      left.set(w, left.get(w) - 1)
      shared++
    }
  }
  return shared / total >= REWRITE_SHARE ? diffWords(before, after) : null
}

function editEntry(before, after, index) {
  const entry = {
    id: after.id,
    index,
    words: before.text === after.text ? null : diffWords(before.text, after.text),
    post: after
  }
  const images = imageChanges(before.images, after.images)
  if (images.added || images.removed) entry.images = images
  return entry
}

/** What changed from draft a to draft b. Pure: the same inputs always give the same diff. */
export function diffDrafts(a, b) {
  const aPosts = a.posts
  const bPosts = b.posts
  const aIndex = new Map(aPosts.map((p, i) => [p.id, i]))
  const bIndex = new Map(bPosts.map((p, i) => [p.id, i]))

  const removed = []
  const common = []
  aPosts.forEach((p, from) => {
    const to = bIndex.get(p.id)
    if (to === undefined) removed.push({ id: p.id, index: from })
    else common.push({ id: p.id, from, to })
  })

  const added = []
  bPosts.forEach((p, index) => {
    if (!aIndex.has(p.id)) added.push({ id: p.id, afterId: index > 0 ? bPosts[index - 1].id : null, index, post: p })
  })

  const keep = longestIncreasing(common.map((c) => c.to))
  const moved = []
  const edited = []
  common.forEach((c, i) => {
    if (!keep.has(i)) moved.push({ id: c.id, from: c.from, to: c.to })
    if (canonical(aPosts[c.from]) !== canonical(bPosts[c.to])) edited.push(editEntry(aPosts[c.from], bPosts[c.to], c.to))
  })

  // A removed and an added post at the same index are one rewritten post.
  const addedByIndex = new Map(added.map((e) => [e.index, e]))
  const rewritten = []
  const keptRemoved = []
  for (const r of removed) {
    const partner = addedByIndex.get(r.index)
    if (!partner) {
      keptRemoved.push(r)
      continue
    }
    addedByIndex.delete(r.index)
    rewritten.push({
      fromId: r.id,
      toId: partner.id,
      index: partner.index,
      words: rewriteWords(aPosts[r.index].text, partner.post.text),
      post: partner.post
    })
  }
  rewritten.sort((p, q) => p.index - q.index)

  return {
    title: a.title === b.title ? null : { before: a.title, after: b.title },
    added: added.filter((e) => addedByIndex.has(e.index)),
    removed: keptRemoved,
    edited,
    moved,
    rewritten
  }
}

/** Rebuilds draft b from draft a and diffDrafts(a, b). Used by the tests to prove the diff is complete. */
export function applyDiff(a, d) {
  const removedIds = new Set(d.removed.map((r) => r.id))
  const rewrittenFrom = new Set(d.rewritten.map((r) => r.fromId))
  const movedIds = new Set(d.moved.map((m) => m.id))
  const content = new Map(a.posts.map((p) => [p.id, p]))
  for (const e of d.edited) content.set(e.id, e.post)

  // Unmoved common posts keep their order, so they fill the places the placed posts leave.
  const rest = a.posts
    .filter((p) => !removedIds.has(p.id) && !rewrittenFrom.has(p.id) && !movedIds.has(p.id))
    .map((p) => content.get(p.id))

  const length = a.posts.length - removedIds.size - rewrittenFrom.size + d.added.length + d.rewritten.length
  const posts = new Array(length)
  for (const e of d.added) posts[e.index] = e.post
  for (const r of d.rewritten) posts[r.index] = r.post
  for (const m of d.moved) posts[m.to] = content.get(m.id)
  let next = 0
  for (let i = 0; i < length; i++) if (posts[i] === undefined) posts[i] = rest[next++]

  return { title: d.title ? d.title.after : a.title, posts }
}

/** Short English text for a diff, e.g. "changed post 2, added post 5 after post 4, moved post 6 to 2". */
export function summaryLine(d) {
  const parts = []
  if (d.title) parts.push('changed the title')
  for (const e of d.edited) parts.push(`changed post ${e.index + 1}`)
  for (const r of d.rewritten) parts.push(`rewrote post ${r.index + 1}`)
  for (const e of d.added) {
    parts.push(e.afterId === null ? `added post ${e.index + 1} first` : `added post ${e.index + 1} after post ${e.index}`)
  }
  for (const r of d.removed) parts.push(`removed post ${r.index + 1}`)
  for (const m of d.moved) parts.push(`moved post ${m.from + 1} to ${m.to + 1}`)
  return parts.length ? parts.join(', ') : 'no changes'
}
