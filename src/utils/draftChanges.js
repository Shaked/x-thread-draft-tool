// What one edit changed in a draft (#405, Task B1 b): one shape for the MCP edit results, their view and their text,
// written so the editor's change summary and the History panel (#366) can use the same function on two saved drafts.
// Posts are matched by id. Positions are 1-based. Pure: no DOM, no server code.

const textOf = (post) => (typeof post?.text === 'string' ? post.text : '')
const imagesOf = (post) => (Array.isArray(post?.images) ? post.images.map((image) => (typeof image === 'string' ? image : image?.url)) : [])
const sameList = (a, b) => a.length === b.length && a.every((value, i) => value === b[i])

/**
 * The ids of `after` (in order) that keep their order relative to each other: the longest run of posts whose places
 * before the edit go up (O(n log n) time, O(n) memory, so a long draft stays cheap). Same order: every id.
 */
function steadyIds(beforeIds, afterIds) {
  if (sameList(beforeIds, afterIds)) return new Set(afterIds)
  const place = new Map(beforeIds.map((id, i) => [id, i]))
  const seq = afterIds.map((id) => place.get(id))
  const tails = []
  const prev = new Array(seq.length)
  seq.forEach((value, i) => {
    let lo = 0
    let hi = tails.length
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (seq[tails[mid]] < value) lo = mid + 1
      else hi = mid
    }
    prev[i] = lo > 0 ? tails[lo - 1] : -1
    tails[lo] = i
  })
  const steady = new Set()
  for (let i = tails.length > 0 ? tails[tails.length - 1] : -1; i >= 0; i = prev[i]) steady.add(afterIds[i])
  return steady
}

/**
 * The changes from `before` to `after` (drafts with { title, posts }): one entry per changed post, in the order of the
 * draft after the edit, then the removed posts. Each entry: { id, status: 'added' | 'edited' | 'moved' | 'removed',
 * index (its place after the edit; before it for a removed post), from (its place before, when it moved),
 * before (text before), after (text after), images: { before, after } (counts, only when they changed) }.
 * `title` is { before, after } when the title changed, else null. `most` is true when most posts changed.
 */
export function changesOf(before, after) {
  const oldPosts = Array.isArray(before?.posts) ? before.posts : []
  const newPosts = Array.isArray(after?.posts) ? after.posts : []
  // A post is matched by its id and, for an id used more than once, by which use it is (the first d before is the
  // first d after), so a repeated id never pairs two different posts.
  const keysOf = (posts) => {
    const seen = new Map()
    return posts.map((post) => {
      const n = seen.get(post?.id) ?? 0
      seen.set(post?.id, n + 1)
      return `${typeof post?.id}:${post?.id}#${n}`
    })
  }
  const oldKeys = keysOf(oldPosts)
  const newKeys = keysOf(newPosts)
  const oldIndex = new Map(oldKeys.map((key, i) => [key, i]))
  const newSet = new Set(newKeys)
  const steady = steadyIds(oldKeys.filter((key) => newSet.has(key)), newKeys.filter((key) => oldIndex.has(key)))
  const posts = []
  newPosts.forEach((post, i) => {
    const key = newKeys[i]
    if (!oldIndex.has(key)) {
      posts.push({ id: post?.id, status: 'added', index: i + 1, after: textOf(post) })
      return
    }
    const old = oldPosts[oldIndex.get(key)]
    const edited = textOf(old) !== textOf(post) || !sameList(imagesOf(old), imagesOf(post)) || (old?.embeddedTweet ?? null) !== (post?.embeddedTweet ?? null)
    const moved = !steady.has(key)
    if (!edited && !moved) return
    const entry = { id: post.id, status: edited ? 'edited' : 'moved', index: i + 1, before: textOf(old), after: textOf(post) }
    if (moved) entry.from = oldIndex.get(key) + 1
    if (!sameList(imagesOf(old), imagesOf(post))) entry.images = { before: imagesOf(old).length, after: imagesOf(post).length }
    posts.push(entry)
  })
  oldPosts.forEach((post, i) => {
    if (!newSet.has(oldKeys[i])) posts.push({ id: post?.id, status: 'removed', index: i + 1, before: textOf(post) })
  })
  const title = (before?.title ?? '') !== (after?.title ?? '') ? { before: before?.title ?? '', after: after?.title ?? '' } : null
  return { title, posts, most: posts.length * 2 > Math.max(oldPosts.length, newPosts.length) }
}
