import { HttpError } from './http.js'
import { outline, summarize } from './draft-stats.js'

// #385 (E273 Task H11, owner decision H1-Q4 option a): while an admin views as a user, drafts show counts only.
// This is the one place that decides it. Every route that reads a draft calls it; tests/api/view-as-private.test.js
// asserts it at runtime for each GET route under /drafts and scans every non-admin GET route for draft text.
const PRIVATE_TITLE = 'Private draft'

// Allowlists, not removals: a field a user can fill with text (a post id is any string, validPosts) must never pass because
// it was not thought of. A new field is hidden until it is added here. Everything listed is a count, a flag, a time or a server-made id.
const DRAFT_FIELDS = ['id', 'is_published', 'updated_at', 'published_at', 'version', 'post_count', 'total_chars', 'over_limit_count', 'image_count']
const POST_FIELDS = ['index', 'chars', 'remaining', 'over_limit', 'image_count']
const pick = (source, fields) => Object.fromEntries(fields.map((field) => [field, source[field]]))

const counts = (draft) => ({ ...pick(summarize(draft), DRAFT_FIELDS), title: PRIVATE_TITLE })

/**
 * `kind` names what the route is about to answer:
 *  - 'open': the route would show draft text (a draft, its export, its history). A view-as caller gets 403 before any query.
 *  - 'list': `data` is draft rows; a view-as caller gets summaries with the title replaced.
 *  - 'outline': `data` is one draft row; a view-as caller gets counts per post, with no preview, no post text, no post id and no image urls.
 * Without `session.viewAs` it returns `data` unchanged.
 */
export function redactForViewAs(session, kind, data) {
  if (!session.viewAs) return data
  if (kind === 'open') throw new HttpError(403, 'Viewing as cannot open drafts.')
  if (kind === 'list') return data.map(counts)
  if (kind === 'outline') {
    return { ...counts(data), posts: outline(data).posts.map((post) => pick(post, POST_FIELDS)) }
  }
  throw new Error(`redactForViewAs: unknown kind ${kind}`)
}
