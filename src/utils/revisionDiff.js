/**
 * Revision diff core (E273 task H4, #377): what changed between two drafts, by post id and by word.
 * Shared by the browser and the server, so it has no imports (like xLength.js).
 *
 * A draft is { title, posts }. A post is { id, text, images, embeddedTweet }.
 * A draft may hold two posts with the same id (the API accepts it), so a post is matched by its id and its
 * occurrence number n (0 for the first post with that id, 1 for the second, ...).
 * A missing text counts as '' and a missing image list as [] (the saved drafts allow both).
 * A missing posts list counts as [], and a null post counts as a post with no id and no text.
 *
 * Output of diffDrafts(a, b):
 * - title: null, or { before, after }.
 * - added: [{ id, n, afterId, index, post }]: index is the place in b; afterId is the id of the post before it in b.
 * - removed: [{ id, n, index }]: index is the place in a.
 * - edited: [{ id, n, index, words, post, images? }]: the post changed in place; words is the word diff of the text
 *   (null when the text did not change); images is { added, removed } counts when the images changed (no URLs).
 * - moved: [{ id, n, from, to }]: the longest increasing run of common posts keeps its place; the rest are moves.
 * - rewritten: [{ fromId, fromN, toId, toN, index, words, post }]: a removed and an added post at the same index,
 *   paired. words is the word diff when at least 30 % of the words are shared, else null.
 * `post` carries the new post, so applyDiff can rebuild b. It is data for the caller, never text for a person:
 * summaryLine() reads only positions.
 */

const WORDS = new Intl.Segmenter(undefined, { granularity: 'word' })
const REWRITE_SHARE = 0.3
// Work limits for the word diff. Above them the middle of the text is shown as one deletion and one insertion,
// which still rebuilds both sides exactly. Posts can be up to a long draft, so the limits keep one diff bounded.
// WORD_DIFF_CAP: tokens left in both texts after the common start and end are removed.
// WORD_DIFF_MAX_EDITS: inserts plus deletes the exact diff may need.
export const WORD_DIFF_CAP = 2000
const WORD_DIFF_MAX_EDITS = 1000

const draftOf = (draft) => ({
  title: draft?.title,
  posts: Array.isArray(draft?.posts) ? draft.posts : []
})
const textOf = (post) => (typeof post?.text === 'string' ? post.text : '')
const imagesOf = (post) => (Array.isArray(post?.images) ? post.images : [])
const tokenize = (text) => Array.from(WORDS.segment(text), (s) => s.segment)
const wordTokens = (text) =>
  Array.from(WORDS.segment(text))
    .filter((s) => s.isWordLike)
    .map((s) => s.segment)

// Stable text form of a value (sorted keys), used to compare posts and images.
function canonical(value) {
  if (value === undefined) return 'undefined'
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value && typeof value === 'object') {
    const keys = Object.keys(value)
      .filter((k) => value[k] !== undefined)
      .sort()
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`
  }
  return JSON.stringify(value) ?? 'null'
}

// A text key for a post id. null and undefined are the same missing id. NaN, Infinity and other numbers are
// spelled out, so they never read as null (JSON would turn them into null). Objects and strings use canonical().
const idKey = (id) => (typeof id === 'number' ? `#${id}` : canonical(id ?? null))
// The key of one post: its id and occurrence number, so two posts with one id stay two posts.
const keyOf = (id, n) => JSON.stringify([idKey(id), n])

// Each post of a draft with its key (see keyOf).
function keyedPosts(posts) {
  const seen = new Map()
  return posts.map((post) => {
    const id = post?.id ?? null
    const k = idKey(id)
    const n = seen.get(k) ?? 0
    seen.set(k, n + 1)
    return { post, id, n, key: keyOf(id, n) }
  })
}

/**
 * Myers diff of two token arrays. Returns [{ op: 'same' | 'del' | 'ins', value }] in order, or null when the
 * diff needs more than WORD_DIFF_MAX_EDITS edits. The trace keeps, for each step, only the diagonals -d-1..d+1
 * (a typed array), not a copy of the whole frontier.
 */
function myers(a, b) {
  const n = a.length
  const m = b.length
  const max = Math.min(n + m, WORD_DIFF_MAX_EDITS)
  const offset = max + 1
  const v = new Int32Array(2 * max + 3) // index k + offset
  const trace = []
  let found = false
  for (let d = 0; d <= max && !found; d++) {
    trace.push(v.slice(offset - d - 1, offset + d + 2)) // snapshot of diagonals -d-1..d+1, index k + d + 1
    for (let k = -d; k <= d; k += 2) {
      let x = k === -d || (k !== d && v[offset + k - 1] < v[offset + k + 1]) ? v[offset + k + 1] : v[offset + k - 1] + 1
      let y = x - k
      while (x < n && y < m && a[x] === b[y]) {
        x++
        y++
      }
      v[offset + k] = x
      if (x >= n && y >= m) {
        found = true
        break
      }
    }
  }
  return found ? backtrack(trace, a, b) : null
}

/** Walks the snapshots back from the end point to the start, and returns the ops in order. */
function backtrack(trace, a, b) {
  const ops = []
  let x = a.length
  let y = b.length
  for (let d = trace.length - 1; d >= 0; d--) {
    const snap = trace[d]
    const at = (k) => snap[k + d + 1]
    const k = x - y
    const prevK = k === -d || (k !== d && at(k - 1) < at(k + 1)) ? k + 1 : k - 1
    const prevX = at(prevK)
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
 * The common start and end are taken off first. When the rest is above WORD_DIFF_CAP tokens, or needs more than
 * WORD_DIFF_MAX_EDITS edits, the rest is one 'del' and one 'ins' (still exact on both sides).
 */
export function diffWords(before, after) {
  const x = tokenize(before)
  const y = tokenize(after)
  let start = 0
  while (start < x.length && start < y.length && x[start] === y[start]) start++
  let endX = x.length
  let endY = y.length
  while (endX > start && endY > start && x[endX - 1] === y[endY - 1]) {
    endX--
    endY--
  }
  const middleX = x.slice(start, endX)
  const middleY = y.slice(start, endY)
  const exact = middleX.length + middleY.length <= WORD_DIFF_CAP ? myers(middleX, middleY) : null
  const ops = []
  for (let i = 0; i < start; i++) ops.push({ op: 'same', value: x[i] })
  if (exact) {
    ops.push(...exact)
  } else {
    if (middleX.length) ops.push({ op: 'del', value: middleX.join('') })
    if (middleY.length) ops.push({ op: 'ins', value: middleY.join('') })
  }
  for (let i = endX; i < x.length; i++) ops.push({ op: 'same', value: x[i] })
  return runs(ops)
}

/** Positions of a longest strictly increasing run of `values` (values are distinct). Returns a Set of positions. */
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
function imageChanges(before, after) {
  const left = new Map()
  for (const img of imagesOf(before)) {
    const key = canonical(img)
    left.set(key, (left.get(key) ?? 0) + 1)
  }
  let added = 0
  for (const img of imagesOf(after)) {
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

function editEntry(before, after, index, id, n) {
  const entry = {
    id,
    n,
    index,
    words: textOf(before) === textOf(after) ? null : diffWords(textOf(before), textOf(after)),
    post: after
  }
  const images = imageChanges(before, after)
  if (images.added || images.removed) entry.images = images
  return entry
}

/** What changed from draft a to draft b. Pure: the same inputs always give the same diff. */
export function diffDrafts(a, b) {
  const from = draftOf(a)
  const to = draftOf(b)
  const aPosts = keyedPosts(from.posts)
  const bPosts = keyedPosts(to.posts)
  const bIndex = new Map(bPosts.map((p, i) => [p.key, i]))
  const aKeys = new Set(aPosts.map((p) => p.key))

  const removed = []
  const common = []
  aPosts.forEach((p, index) => {
    const at = bIndex.get(p.key)
    if (at === undefined) removed.push({ id: p.id, n: p.n, index })
    else common.push({ id: p.id, n: p.n, from: index, to: at, before: p.post, after: bPosts[at].post })
  })

  const added = []
  bPosts.forEach((p, index) => {
    if (!aKeys.has(p.key)) {
      added.push({ id: p.id, n: p.n, afterId: index > 0 ? bPosts[index - 1].id : null, index, post: p.post })
    }
  })

  const keep = longestIncreasing(common.map((c) => c.to))
  const moved = []
  const edited = []
  common.forEach((c, i) => {
    if (!keep.has(i)) moved.push({ id: c.id, n: c.n, from: c.from, to: c.to })
    if (canonical(c.before) !== canonical(c.after)) edited.push(editEntry(c.before, c.after, c.to, c.id, c.n))
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
      fromN: r.n,
      toId: partner.id,
      toN: partner.n,
      index: partner.index,
      words: rewriteWords(textOf(aPosts[r.index].post), textOf(partner.post)),
      post: partner.post
    })
  }
  rewritten.sort((p, q) => p.index - q.index)

  return {
    title: from.title === to.title ? null : { before: from.title, after: to.title },
    added: added.filter((e) => addedByIndex.has(e.index)),
    removed: keptRemoved,
    edited,
    moved,
    rewritten
  }
}

/** Rebuilds draft b from draft a and diffDrafts(a, b). Used by the tests to prove the diff is complete. */
export function applyDiff(a, d) {
  const from = draftOf(a)
  const removedKeys = new Set(d.removed.map((r) => keyOf(r.id, r.n)))
  const rewrittenFromKeys = new Set(d.rewritten.map((r) => keyOf(r.fromId, r.fromN)))
  const movedKeys = new Set(d.moved.map((m) => keyOf(m.id, m.n)))
  const content = new Map(keyedPosts(from.posts).map((p) => [p.key, p.post]))
  for (const e of d.edited) content.set(keyOf(e.id, e.n), e.post)

  // Unmoved common posts keep their order, so they fill the places the placed posts leave.
  const rest = keyedPosts(from.posts)
    .filter((p) => !removedKeys.has(p.key) && !rewrittenFromKeys.has(p.key) && !movedKeys.has(p.key))
    .map((p) => content.get(p.key))

  const length = from.posts.length - removedKeys.size - rewrittenFromKeys.size + d.added.length + d.rewritten.length
  const posts = new Array(length)
  const placed = new Array(length).fill(false)
  const place = (i, post) => {
    posts[i] = post
    placed[i] = true
  }
  for (const e of d.added) place(e.index, e.post)
  for (const r of d.rewritten) place(r.index, r.post)
  for (const m of d.moved) place(m.to, content.get(keyOf(m.id, m.n)))
  let next = 0
  for (let i = 0; i < length; i++) if (!placed[i]) place(i, rest[next++])

  return { title: d.title ? d.title.after : from.title, posts }
}

/**
 * Short English text for a diff, e.g. "changed post 2, added post 5 after post 4, moved post 6 to 2".
 * Positions: removed[].index is a position in a (the old draft); every other index is a position in b (the new draft).
 */
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
