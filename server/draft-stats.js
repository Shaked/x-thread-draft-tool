import { xLength } from '../src/utils/xLength.js'

// Small answers about a draft for agents: counts and a short preview per post, never the full text.
// Length is the X weighted length (src/utils/xLength.js), the same count the editor shows.
const LIMIT = 280
const PREVIEW_CHARS = 40

const postsOf = (draft) => (Array.isArray(draft.posts) ? draft.posts : [])
const charsOf = (post) => xLength(typeof post?.text === 'string' ? post.text : '')
const imagesOf = (post) => (Array.isArray(post?.images) ? post.images.length : 0)

/** The draft without its posts: id, title, state and counts. */
export function summarize(draft) {
  const posts = postsOf(draft)
  return {
    id: draft.id,
    title: draft.title,
    is_published: draft.is_published,
    updated_at: draft.updated_at,
    published_at: draft.published_at,
    version: draft.version,
    post_count: posts.length,
    total_chars: posts.reduce((sum, post) => sum + charsOf(post), 0),
    over_limit_count: posts.filter((post) => charsOf(post) > LIMIT).length,
    image_count: posts.reduce((sum, post) => sum + imagesOf(post), 0)
  }
}

/** The summary plus one line per post: 1-based index, length, room left, images and a short preview. */
export function outline(draft) {
  return {
    ...summarize(draft),
    posts: postsOf(draft).map((post, i) => {
      const chars = charsOf(post)
      return {
        id: post?.id,
        index: i + 1,
        chars,
        remaining: LIMIT - chars,
        over_limit: chars > LIMIT,
        image_count: imagesOf(post),
        preview: Array.from(typeof post?.text === 'string' ? post.text : '').slice(0, PREVIEW_CHARS).join('')
      }
    })
  }
}
