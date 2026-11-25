// The result of an MCP edit tool (#405, Task B1 b): what the edit changed, for the thread view (_meta x-thread/changes)
// and as compact text for the model and for apps that show no view. Routing rule, written once here:
// - the whole draft is shown only when it has fewer than 4 posts, when most of its posts changed, or when the state
//   before the edit is not known (another write landed in between);
// - otherwise only the changed posts are shown: before and after of their text, the new count and the new version.
import { changesOf } from '../../src/utils/draftChanges.js'

/** At most this many changed posts are written out in the text; the view has all of them. */
const TEXT_LIMIT = 10
const FULL_BELOW = 4

/**
 * The x-thread/changes value: { version, post_count, known, full, title, posts } (posts: see changesOf).
 * `before` is the draft read before the write (or null when not known), `after` the saved draft.
 */
export function changeMeta(before, after) {
  const base = { version: after.version, post_count: after.posts.length }
  // Known only when this write is the only one since `before` (or nothing was written).
  const known = Boolean(before) && (after.version === before.version || after.version === before.version + 1)
  if (!known) return { ...base, known: false, full: true, title: null, posts: [] }
  const { title, posts, most } = changesOf(before, after)
  return { ...base, known: true, full: after.posts.length < FULL_BELOW || most, title, posts }
}

const quote = (text) => String(text).split('\n').map((line) => (line ? `> ${line}` : '>'))
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`

/**
 * One changed post as markdown lines: the post as it is now (quoted when its text changed), a removed post's old text.
 * The text before an edit is in the view only: the assistant read it before the edit, and the result stays short (T5).
 */
function postLines(change, total) {
  const at = `**Post ${change.index}/${total}**`
  const images = change.images ? [`Images: ${change.images.before} before, ${change.images.after} now.`] : []
  const moved = change.from ? `, moved from post ${change.from}` : ''
  if (change.status === 'added') return [`${at}, added`, ...quote(change.after), ...images]
  if (change.status === 'removed') return [`**Removed post** (was post ${change.index})`, ...quote(change.before)]
  if (change.status === 'moved') return [`${at}${moved}`]
  return [`${at}, edited${moved}`, ...(change.before === change.after ? [] : quote(change.after)), ...images]
}

/** The "after the edit" text of docs/plans/draft-contract.md section 2.4 (one set of instructions, #358). */
const AFTER_EDIT = 'Saved. Do not show the whole draft again: say in one line what changed and quote only the changed posts, if any.'

/**
 * The text of an edit's result: one line with what to do, the new version and the count, then the changed posts only,
 * unless the whole draft is shown (`changes.full`): then the caller adds the whole thread as its own text part.
 * The editor link is in the JSON part before it.
 */
export function changesText(changes) {
  const state = `Version ${changes.version}, ${plural(changes.post_count, 'post')}`
  if (changes.full) return `${AFTER_EDIT} ${state}. The view shows the whole draft.`
  if (changes.posts.length === 0 && !changes.title) return `Nothing changed. ${state}.`
  const lines = [`${AFTER_EDIT} ${state}; changed: ${plural(changes.posts.length, 'post')}. The view shows what changed.`]
  const oneLine = (title) => String(title || 'Untitled draft').replace(/\s+/g, ' ').trim()
  if (changes.title) lines.push('', `Title: "${oneLine(changes.title.before)}" is now "${oneLine(changes.title.after)}".`)
  for (const change of changes.posts.slice(0, TEXT_LIMIT)) lines.push('', ...postLines(change, changes.post_count))
  if (changes.posts.length > TEXT_LIMIT) lines.push('', `And ${changes.posts.length - TEXT_LIMIT} more changed posts: the view lists them.`)
  return lines.join('\n')
}
