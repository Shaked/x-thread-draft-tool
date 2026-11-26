// Merge two edits of one draft when they touch different posts (#474, #354). Pure: no DOM, no server code.
// base = the copy the editor last read or saved, mine = the editor's copy, theirs = the draft in the 412 answer.
// Returns the merged { title, posts } or null (null means: show the conflict banner). It never picks one side's text
// for a post that both sides changed, and it never drops a post or a title that one side changed.

const stable = (value) => {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`
  if (value !== null && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`
  }
  return JSON.stringify(value)
}

const postsOf = (draft) => (Array.isArray(draft?.posts) ? draft.posts : [])
const idsOf = (draft) => postsOf(draft).map((post) => post?.id)
const sameIds = (a, b) => a.length === b.length && a.every((id, i) => id === b[i])

/** What one side changed against base: the ids whose content changed or that were removed, and whether the order or set of posts changed. */
function changesOf(base, side) {
  const baseById = new Map(postsOf(base).map((post) => [post.id, stable(post)]))
  const sideById = new Map(postsOf(side).map((post) => [post.id, stable(post)]))
  const touched = new Set()
  for (const [id, content] of baseById) if (sideById.has(id) ? sideById.get(id) !== content : true) touched.add(id)
  return { touched, structural: !sameIds(idsOf(base), idsOf(side)), titleChanged: (side?.title ?? '') !== (base?.title ?? '') }
}

/** True when every post has a string id and no id repeats, on all three copies. A draft that fails this is never merged. */
const idsAreSound = (draft) => {
  const ids = idsOf(draft)
  return ids.every((id) => typeof id === 'string') && new Set(ids).size === ids.length
}

export function mergeDraftEdits(base, mine, theirs) {
  if (![base, mine, theirs].every((draft) => draft && idsAreSound(draft))) return null
  const my = changesOf(base, mine)
  const their = changesOf(base, theirs)
  // At most one side changed the title, and at most one side added, removed or moved posts.
  if (my.titleChanged && their.titleChanged) return null
  if (my.structural && their.structural) return null
  // The two sides must have changed different posts (a removal counts as a change of that post).
  for (const id of my.touched) if (their.touched.has(id)) return null

  const baseIds = new Set(idsOf(base))
  const mineById = new Map(postsOf(mine).map((post) => [post.id, post]))
  const theirsById = new Map(postsOf(theirs).map((post) => [post.id, post]))
  const baseById = new Map(postsOf(base).map((post) => [post.id, post]))
  // The side that changed the set or order of posts decides both. When neither did, they are base's.
  const lead = their.structural ? theirs : mine
  const posts = postsOf(lead).map((post) => {
    if (!baseIds.has(post.id)) return post
    if (my.touched.has(post.id)) return mineById.get(post.id)
    if (their.touched.has(post.id)) return theirsById.get(post.id)
    return baseById.get(post.id)
  })
  // A post the lead side removed was not edited by the other side (checked above), so no post is missing here.
  // A post the other side added cannot exist: only one side may have changed the set of posts.
  const title = my.titleChanged ? mine.title : their.titleChanged ? theirs.title : base.title
  return { ...theirs, title, posts }
}

/** The ids of the merged posts whose content came from the other app, for the highlight. */
export function idsFromTheirs(base, theirs, merged) {
  const baseById = new Map(postsOf(base).map((post) => [post.id, stable(post)]))
  return postsOf(merged)
    .filter((post) => baseById.get(post.id) !== stable(post) && stable(postsOf(theirs).find((t) => t.id === post.id)) === stable(post))
    .map((post) => post.id)
}
