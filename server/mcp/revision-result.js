// The text of the three revision tools (E273 task H7, #380). Plain readable text, never a code block (#358): one line per
// revision, and the changed posts as "Post N before:" and "Post N after:" block quotes. Draft text is copied as it is
// (Hebrew byte for byte, no direction marks). Only get_revision shows post text; the list and the restore never do (T5).
// Words written here are the server's own: the revision numbers, the actor and the summary line from revisionDiff.js.

/** At most this many changed posts are written out; the call that follows names how to read the rest. */
const TEXT_LIMIT = 10

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`

/** "3 minutes ago", "2 hours ago", "5 days ago"; older than 30 days: the date. `now` is a parameter for the tests. */
function ago(iso, now = Date.now()) {
  const seconds = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000))
  if (seconds < 60) return 'just now'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${plural(minutes, 'minute')} ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${plural(hours, 'hour')} ago`
  const days = Math.floor(hours / 24)
  return days <= 30 ? `${plural(days, 'day')} ago` : `on ${new Date(iso).toISOString().slice(0, 10)}`
}

const KIND_NAMES = { restore: 'a restore', system: 'the app' }

/** Who made a revision: the actor name, else a plain word for the kind, else nothing (an edit with no actor). */
const actorOf = (rev) => (rev.actor_name ? ` by ${rev.actor_name}` : rev.actor_kind ? ` by ${KIND_NAMES[rev.actor_kind] ?? rev.actor_kind}` : '')

const revisionHead = (rev, now) => `Revision ${rev.seq}${actorOf(rev)}, ${ago(rev.created_at, now)}`

/** "Revision 14 by ChatGPT, 3 minutes ago: changed post 2, added post 5 after post 4." */
function revisionLine(rev, now) {
  const label = rev.label ? ` ${rev.label}.` : ''
  return `${revisionHead(rev, now)}: ${rev.summary ?? 'no changes'}.${label}`
}

/** The text of list_revisions: one line per revision, newest first, then the next call. */
export function listText(body, id, now) {
  const revisions = body?.revisions ?? []
  if (revisions.length === 0) return 'This draft has no revisions yet.'
  const lines = revisions.map((rev) => revisionLine(rev, now))
  const next = [`To see what a revision changed, call get_revision with id ${id} and revision ${revisions[0].seq}.`]
  if (body.next_before !== null && body.next_before !== undefined) next.push(`For older revisions, call list_revisions with before ${body.next_before}.`)
  else next.push('That is the whole history.')
  return `${lines.join('\n')}\n\n${next.join(' ')}`
}

/** A quote block of a text: every line starts with "> " (an empty line with ">"). */
const quote = (text) => String(text ?? '').split('\n').map((line) => (line ? `> ${line}` : '>')).join('\n')
const textOf = (post) => (typeof post?.text === 'string' ? post.text : '')
// A title shows on one line: runs of whitespace (a newline too) become one space, so a title is not shown byte for byte.
const oneLine = (title) => String(title || 'Untitled draft').replace(/\s+/g, ' ').trim()

/** The nth post of a state with this id (n counts the posts that share an id), or undefined. */
function findPost(posts, id, n) {
  let seen = 0
  for (const post of posts) {
    if ((post?.id ?? null) !== (id ?? null)) continue
    if (seen === n) return post
    seen += 1
  }
  return undefined
}

/**
 * The changed posts of a diff as blocks of text. `from` is the state the diff starts from, `to` the state it ends at.
 * `names` are the two words of the pair ("before" and "after", or "now" and "in revision 14" against the draft now).
 * Added and removed posts have one side only; a moved post has a line and no text.
 */
function changeBlocks(diff, from, to, names) {
  const [first, second] = names
  const blocks = []
  if (diff.title) blocks.push(`Title ${first}:\n${quote(oneLine(diff.title.before))}\n\nTitle ${second}:\n${quote(oneLine(diff.title.after))}`)
  const pair = (index, before, after) => `Post ${index} ${first}:\n${quote(textOf(before))}\n\nPost ${index} ${second}:\n${quote(textOf(after))}`
  for (const e of diff.edited) {
    const before = findPost(from.posts, e.id, e.n)
    if (e.words === null && !e.images) continue // only a field the text never shows changed
    blocks.push(e.words === null ? `Post ${e.index + 1}: only its images changed (${e.images.added} added, ${e.images.removed} removed).` : pair(e.index + 1, before, e.post))
  }
  for (const r of diff.rewritten) blocks.push(pair(r.index + 1, findPost(from.posts, r.fromId, r.fromN), r.post))
  for (const a of diff.added) {
    const place = a.afterId === null ? 'first' : `after post ${a.index}`
    blocks.push(`Post ${a.index + 1} ${second}, added ${place}:\n${quote(textOf(a.post))}`)
  }
  for (const r of diff.removed) blocks.push(`Post ${r.index + 1} ${first}${first === 'now' ? `, not ${second}` : ', then removed'}:\n${quote(textOf(from.posts[r.index]))}`)
  for (const m of diff.moved) blocks.push(`Post ${m.from + 1} moved to position ${m.to + 1}.`)
  return blocks
}

/**
 * The text of get_revision. `body` is the route answer ({ revision, state, against, diff }); `from` is the state the
 * diff starts from ({ title, posts }); `current` is the draft's version now. Ends with the next call.
 */
export function revisionText(body, id, from, current, now) {
  const { revision: rev, against, diff } = body
  const toNow = against === 'current'
  const label = rev.label ? ` ${rev.label}.` : ''
  const compared = toNow ? 'Compared with the draft now.' : typeof against === 'number' ? `Compared with revision ${against}.` : 'Nothing came before it.'
  const head = `${revisionHead(rev, now)}.${label} ${compared}`
  const names = toNow ? ['now', `in revision ${rev.seq}`] : ['before', 'after']
  const blocks = changeBlocks(diff, from, body.state, names)
  const shown = blocks.slice(0, TEXT_LIMIT)
  if (blocks.length > TEXT_LIMIT) shown.push(`And ${blocks.length - TEXT_LIMIT} more changes: call get_revision again with against set to a nearer revision.`)
  const parts = [head, shown.length ? shown.join('\n\n') : 'No post or title changed.']
  const restore = (seq) => `call restore_revision with id ${id}, revision ${seq} and version ${current}`
  if (typeof against === 'number') {
    parts.push(`To go back to before this change, ${restore(against)}. To restore this revision itself, use revision ${rev.seq} instead.`)
  } else {
    parts.push(`To restore this revision, ${restore(rev.seq)}.`)
  }
  return parts.join('\n\n')
}

/** The text of restore_revision (T5: counts and numbers, no post text). `sent` is the version the caller sent. */
export function restoreText(body, sent) {
  const { draft, restored_from: from, images_not_restored: dropped } = body
  const count = draft.post_count ?? draft.posts?.length ?? 0
  if (body.written === false) {
    const stale = sent === draft.version ? '' : ` The version you sent (${sent}) was stale: the draft is at version ${draft.version}.`
    return `Nothing changed: revision ${from} is already the current state, so nothing was written.${stale}`
  }
  const images = dropped > 0 ? ` ${plural(dropped, 'image')} could not be restored because the file is gone.` : ''
  return `Restored revision ${from}: the draft is now version ${draft.version} with ${plural(count, 'post')}.${images} The revision before the restore is kept: call list_revisions to go back.`
}
