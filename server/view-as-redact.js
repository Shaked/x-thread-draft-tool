import { HttpError } from './http.js'
import { outline, summarize } from './draft-stats.js'

// #385 (E273 Task H11, owner decision H1-Q4 option a): while an admin views as a user, drafts show counts only.
// This is the one place that decides it. Every route that reads a draft calls it; tests/api/view-as-private.test.js
// asserts that each GET route under /drafts does.
const PRIVATE_TITLE = 'Private draft'

const counts = (draft) => ({ ...summarize(draft), title: PRIVATE_TITLE })

/**
 * `kind` names what the route is about to answer:
 *  - 'open': the route would show draft text (a draft, its export, its history). A view-as caller gets 403 before any query.
 *  - 'list': `data` is draft rows; a view-as caller gets summaries with the title replaced.
 *  - 'outline': `data` is one draft row; a view-as caller gets counts per post, with no preview, no post text and no image urls.
 * Without `session.viewAs` it returns `data` unchanged.
 */
export function redactForViewAs(session, kind, data) {
  if (!session.viewAs) return data
  if (kind === 'open') throw new HttpError(403, 'Viewing as cannot open drafts.')
  if (kind === 'list') return data.map(counts)
  if (kind === 'outline') {
    const full = outline(data)
    return { ...counts(data), posts: full.posts.map((post) => Object.fromEntries(Object.entries(post).filter(([key]) => key !== 'preview'))) }
  }
  throw new Error(`redactForViewAs: unknown kind ${kind}`)
}
