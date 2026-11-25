// What one edit changed in a draft (#405, Task B1 b): one shape for the MCP edit results, their view and their text,
// written so the editor's change summary and the History panel (#366) can use the same function on two saved drafts.
// Posts are matched by id. Positions are 1-based. Pure: no DOM, no server code.

const textOf = (post) => (typeof post?.text === 'string' ? post.text : '')
const imagesOf = (post) => (Array.isArray(post?.images) ? post.images.map((image) => (typeof image === 'string' ? image : image?.url)) : [])
const sameList = (a, b) => a.length === b.length && a.every((value, i) => value === b[i])

/** The ids of `after` (in order) that keep their order relative to each other: a longest common subsequence. */
function steadyIds(beforeIds, afterIds) {
  const n = beforeIds.length
  const m = afterIds.length
  const table = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0))
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      table[i][j] = beforeIds[i] === afterIds[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1])
    }
  }
  const steady = new Set()
  for (let i = 0, j = 0; i < n && j < m; ) {
    if (beforeIds[i] === afterIds[j]) {
      steady.add(afterIds[j])
      i++
      j++
    } else if (table[i + 1][j] >= table[i][j + 1]) i++
    else j++
  }
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
  const oldIndex = new Map(oldPosts.map((post, i) => [post?.id, i]))
  const newIds = new Set(newPosts.map((post) => post?.id))
  const steady = steadyIds(
    oldPosts.map((post) => post?.id).filter((id) => newIds.has(id)),
    newPosts.map((post) => post?.id).filter((id) => oldIndex.has(id))
  )
  const posts = []
  newPosts.forEach((post, i) => {
    if (!oldIndex.has(post?.id)) {
      posts.push({ id: post?.id, status: 'added', index: i + 1, after: textOf(post) })
      return
    }
    const old = oldPosts[oldIndex.get(post.id)]
    const edited = textOf(old) !== textOf(post) || !sameList(imagesOf(old), imagesOf(post)) || (old?.embeddedTweet ?? null) !== (post?.embeddedTweet ?? null)
    const moved = !steady.has(post.id)
    if (!edited && !moved) return
    const entry = { id: post.id, status: edited ? 'edited' : 'moved', index: i + 1, before: textOf(old), after: textOf(post) }
    if (moved) entry.from = oldIndex.get(post.id) + 1
    if (!sameList(imagesOf(old), imagesOf(post))) entry.images = { before: imagesOf(old).length, after: imagesOf(post).length }
    posts.push(entry)
  })
  oldPosts.forEach((post, i) => {
    if (!newIds.has(post?.id)) posts.push({ id: post?.id, status: 'removed', index: i + 1, before: textOf(post) })
  })
  const title = (before?.title ?? '') !== (after?.title ?? '') ? { before: before?.title ?? '', after: after?.title ?? '' } : null
  return { title, posts, most: posts.length * 2 > Math.max(oldPosts.length, newPosts.length) }
}
