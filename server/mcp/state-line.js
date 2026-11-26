// The state line (docs/plans/draft-contract.md section 3, #390): one plain line at the end of every successful draft
// result. Only server-written words, the id, numbers and the editor link: never a title, post text or image url.
import { outline } from '../draft-stats.js'

const IMAGE_LIMIT = 4
const EDIT_HINT = 'Saved. Say in one line what changed; quote only the changed posts, not the whole draft.'
const REWRITE_HINT = 'Saved. Say in one line what changed; if no card shows the thread, quote the changed posts.'
const OUTLINE_HINT = 'Call get_draft for the text, or update_post to change a post.'
const IMAGE_ELSEWHERE_HINT = (images) => `Saved. Say in one line which images changed; the draft has ${images} in all.`

const GROUP = {
  get_draft: 'read',
  create_draft: 'read',
  create_thread_from_text: 'read',
  duplicate_draft: 'read',
  get_draft_outline: 'outline',
  update_draft: 'rewrite',
  add_post: 'edit',
  update_post: 'edit',
  remove_post: 'edit',
  move_post: 'edit',
  add_image_from_url: 'image',
  remove_image: 'image'
}

/** The tools whose successful results end with a state line. */
export const STATE_LINE_TOOLS = Object.keys(GROUP)

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`

/**
 * The state line of a draft result. `draft` is the outline or the full draft row; `postId` names the post an image
 * tool changed. Returns null for a tool that has no state line.
 */
export function stateLine(draft, tool, origin, { postId } = {}) {
  const group = GROUP[tool]
  if (!group || !draft?.id) return null
  const stats = 'over_limit_count' in draft ? draft : outline(draft)
  const posts = Array.isArray(draft.posts) ? draft.posts : []
  const count = stats.post_count ?? posts.length
  const images = plural(stats.image_count ?? 0, 'image')
  const imagePost = group === 'image' && postId !== undefined ? outline(draft).posts.find((post) => post.id === postId) : undefined
  const hints = {
    read: `To change a post, call update_post with this id, the post's id from posts, and version ${stats.version}.`,
    outline: OUTLINE_HINT,
    rewrite: REWRITE_HINT,
    edit: EDIT_HINT,
    image: imagePost ? `Saved. Post ${imagePost.index} has ${imagePost.image_count} of ${IMAGE_LIMIT} images. Say this in one line.` : IMAGE_ELSEWHERE_HINT(images)
  }
  return `Draft ${draft.id}, version ${stats.version}, ${plural(count, 'post')}, ${stats.over_limit_count} over 280, ${images}. Editor: ${origin}/draft/${draft.id}. ${hints[group]}`
}
