import { query, transaction } from '../db.js'
import { HttpError, json, readJson, readOptionalJson } from '../http.js'
import { requireUser } from '../session.js'
import { deleteBlobUrls } from '../blob.js'
import { outline, summarize } from '../draft-stats.js'
import { imageUrlsFrom, isOwnedBlobUrl } from '../draft-images.js'
import { exportAsFormattedText, exportAsJSON, exportAsNumberedText, exportAsPlainText } from '../../src/utils/exportFormats.js'
import { xLength } from '../../src/utils/xLength.js'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const COLUMNS = 'id, user_id, title, posts, is_published, published_at, created_at, updated_at, version'
const POST_TEXT_MAX = 280
const EMPTY_POST = () => ({ id: crypto.randomUUID(), text: '', images: [], embeddedTweet: null })

function isUuid(value) {
  return typeof value === 'string' && UUID_RE.test(value)
}

function requireObject(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new HttpError(400, 'Body must be a JSON object')
  }
  return body
}

function validTitle(title) {
  if (typeof title !== 'string' || title.length > 500) {
    throw new HttpError(400, 'title must be a string of at most 500 characters')
  }
  return title
}

function validPosts(posts) {
  if (!Array.isArray(posts)) throw new HttpError(400, 'posts must be an array')
  const isPost = (post) => post !== null && typeof post === 'object' && !Array.isArray(post) && typeof post.id === 'string'
  if (!posts.every(isPost)) throw new HttpError(400, 'each post must be an object with a string id')
  return posts
}

function notFound() {
  return new HttpError(404, 'Draft not found')
}

function shareLinkNotFound() {
  return new HttpError(404, 'Share link not found')
}

/**
 * The If-Match precondition of a request (RFC 9110): null when absent, { any: true } for `*`,
 * { version, weak } for one entity tag such as "3" or W/"3". Anything else is a 400.
 */
function ifMatchOf(request) {
  const header = request.headers.get('if-match')
  if (header === null) return null
  const value = header.trim()
  if (value === '*') return { any: true }
  const match = value.match(/^(W\/)?"(\d+)"$/)
  if (!match) throw new HttpError(400, 'If-Match must be * or the draft version as an entity tag, for example "3"')
  return { version: Number(match[2]), weak: Boolean(match[1]) }
}

/** Writes need the strong comparison: a weak tag never matches. */
const preconditionHolds = (expected, version) => expected === null || expected.any === true || (!expected.weak && expected.version === version)

const etagHeaders = (version) => ({ etag: `"${version}"` })

const staleResponse = (draft) =>
  json({ error: 'The draft changed since you read it', version: draft.version }, 412, etagHeaders(draft.version))

/**
 * The If-Match tag a write checks in its WHERE: null for no check (no header, or `*`), -1 for a tag
 * that never matches a version (a weak tag, or a number beyond int range), else the version.
 */
function tagOf(expected) {
  if (expected === null || expected.any === true) return null
  return expected.weak || !(Number.isSafeInteger(expected.version) && expected.version <= 2147483647) ? -1 : expected.version
}

/**
 * The loop of the PATCH routes (plan P6, P7). `write()` runs the one UPDATE and resolves to its row,
 * or undefined when it changed nothing. `answer(last)` reads the draft after such a write: it returns
 * the answer, throws, or returns undefined to ask for another try. `last` is true when no try is left:
 * a tag was sent, or this was the third try. Without a tag the UPDATE is retried, never a 412.
 * PGlite cannot reproduce the race behind the retry.
 */
async function writeOrAnswer(tag, write, answer) {
  for (let attempt = 1; ; attempt++) {
    const row = await write()
    if (row) return json({ draft: row }, 200, etagHeaders(row.version))
    const response = await answer(tag !== null || attempt >= 3)
    if (response) return response
  }
}

/** POST /api/drafts/:id/duplicate: same copy the editor's Duplicate button makes. */
async function duplicateDraft({ request, params }) {
  const session = await requireUser(request)
  if (!isUuid(params.id)) throw notFound()
  const { rows: sourceRows } = await query(
    `select title, posts from drafts where id = $1 and user_id = $2`,
    [params.id, session.uid]
  )
  if (!sourceRows[0]) throw notFound()
  const source = sourceRows[0]
  const posts = Array.isArray(source.posts) ? source.posts.map((post) => ({ ...post, id: crypto.randomUUID() })) : []
  const { rows } = await query(
    `insert into drafts (user_id, title, posts) values ($1, $2, $3::jsonb) returning ${COLUMNS}`,
    [session.uid, `${source.title || 'Untitled'} (copy)`, JSON.stringify(posts.length ? posts : [EMPTY_POST()])]
  )
  return json({ draft: rows[0] }, 201, etagHeaders(rows[0].version))
}

/** GET /api/drafts/:id/export?format=json|text|formatted (owner only, like GET by id). */
async function exportDraft({ request, url, params }) {
  const session = await requireUser(request)
  if (!isUuid(params.id)) throw notFound()
  const format = url.searchParams.get('format') ?? 'json'
  const { rows } = await query(`select ${COLUMNS} from drafts where id = $1 and user_id = $2`, [params.id, session.uid])
  if (!rows[0]) throw notFound()
  const draft = rows[0]
  const posts = Array.isArray(draft.posts) ? draft.posts : []
  if (format === 'json') {
    return new Response(exportAsJSON({ title: draft.title, posts }), {
      headers: { 'content-type': 'application/json; charset=utf-8' }
    })
  }
  if (format === 'text' || format === 'formatted') {
    const numbered = url.searchParams.get('numbered') === 'true'
    const body =
      format === 'text' ? (numbered ? exportAsNumberedText(posts) : exportAsPlainText(posts)) : exportAsFormattedText(posts)
    return new Response(body, { headers: { 'content-type': 'text/plain; charset=utf-8' } })
  }
  throw new HttpError(400, 'format must be json, text or formatted')
}

/** Loads a draft owned by `uid`, or throws 404. Used by every owner-only route. */
async function ownedPosts(id, uid) {
  if (!isUuid(id)) throw notFound()
  const { rows } = await query('select posts from drafts where id = $1 and user_id = $2', [id, uid])
  if (!rows[0]) throw notFound()
  return rows[0].posts
}

/**
 * The URLs (of `urls`) that a draft of `uid` still uses, answered by the database: one statement,
 * no draft's posts leave it. A URL that appears anywhere in a post's JSON counts as used (images
 * or plain text), so a file is never deleted by mistake. The URL is compared in its JSON-escaped
 * form (jsonb text escapes quotes, backslashes and control characters). `exceptDraftId` is left out (or null).
 */
export async function usedImageUrls(run, uid, urls, exceptDraftId) {
  if (urls.length === 0) return new Set()
  const { rows } = await run(
    `select u.url from unnest($2::text[]) as u(url)
      where exists (select 1 from drafts d where d.user_id = $1
                     and ($3::uuid is null or d.id <> $3::uuid)
                     and strpos(d.posts::text, substr(to_jsonb(u.url)::text, 2, length(to_jsonb(u.url)::text) - 2)) > 0)`,
    [uid, urls, exceptDraftId]
  )
  return new Set(rows.map((row) => row.url))
}

/**
 * Blob URLs that may be deleted with this draft: only the owner's own objects, and never an
 * object that another draft of the same owner still references (duplicates share URLs).
 */
async function deletableImageUrls(run, uid, id, posts) {
  const owned = imageUrlsFrom(posts).filter((url) => isOwnedBlobUrl(url, uid))
  const used = await usedImageUrls(run, uid, owned, id)
  return owned.filter((url) => !used.has(url))
}

/**
 * GET /api/drafts?published=true|false&limit=1..200 (default 100). view=summary returns counts per
 * draft instead of the posts (server/draft-stats.js); without view the answer is the full drafts.
 */
async function listDrafts({ request, url }) {
  const session = await requireUser(request)
  const flag = url.searchParams.get('published')
  if (flag !== 'true' && flag !== 'false') throw new HttpError(400, 'published must be true or false')
  const published = flag === 'true'
  const limitParam = url.searchParams.get('limit') ?? '100'
  const limit = Number(limitParam)
  if (!Number.isInteger(limit) || limit < 1 || limit > 200) throw new HttpError(400, 'limit must be from 1 to 200')
  const view = url.searchParams.get('view')
  if (view !== null && view !== 'summary') throw new HttpError(400, 'view must be summary')
  const order = published ? 'published_at desc' : 'updated_at desc'
  const { rows } = await query(
    `select ${COLUMNS} from drafts where user_id = $1 and is_published = $2 order by ${order} limit $3`,
    [session.uid, published, limit]
  )
  if (view === 'summary') return json({ drafts: rows.map(summarize) })
  return json({ drafts: rows })
}

/** POST /api/drafts */
async function createDraft({ request }) {
  const session = await requireUser(request)
  const body = requireObject(await readJson(request))
  const title = body.title === undefined ? '' : validTitle(body.title)
  const posts = body.posts === undefined ? [EMPTY_POST()] : validPosts(body.posts)
  const { rows } = await query(
    `insert into drafts (user_id, title, posts) values ($1, $2, $3::jsonb) returning ${COLUMNS}`,
    [session.uid, title, JSON.stringify(posts)]
  )
  return json({ draft: rows[0] }, 201, etagHeaders(rows[0].version))
}

/** GET /api/drafts/:id: owner only. Another user, or nobody (401), never reads a draft by id. */
async function getDraft({ request, params }) {
  const session = await requireUser(request)
  if (!isUuid(params.id)) throw notFound()
  const { rows } = await query(`select ${COLUMNS} from drafts where id = $1 and user_id = $2`, [params.id, session.uid])
  if (!rows[0]) throw notFound()
  return json({ draft: rows[0] }, 200, etagHeaders(rows[0].version))
}

/** GET /api/drafts/:id/outline: owner only. Counts and a preview per post, not the full text. */
async function getDraftOutline({ request, params }) {
  const session = await requireUser(request)
  if (!isUuid(params.id)) throw notFound()
  const { rows } = await query(`select ${COLUMNS} from drafts where id = $1 and user_id = $2`, [params.id, session.uid])
  if (!rows[0]) throw notFound()
  return json({ draft: outline(rows[0]) })
}

/**
 * PATCH /api/drafts/:id: owner only; a non-owner gets 404 and the row is untouched. One UPDATE
 * that re-checks its WHERE on the newest row. Sending what the draft already holds is a 200 with no write (a replay); a
 * stale If-Match is a 412 with no write.
 */
async function updateDraft({ request, params }) {
  const session = await requireUser(request)
  const body = requireObject(await readJson(request))
  if (body.title === undefined && body.posts === undefined) {
    throw new HttpError(400, 'Nothing to update')
  }
  const title = body.title === undefined ? null : validTitle(body.title)
  const posts = body.posts === undefined ? null : JSON.stringify(validPosts(body.posts))
  if (!isUuid(params.id)) throw notFound()
  const tag = tagOf(ifMatchOf(request))

  // Without a tag the UPDATE can skip the row because the body looked like a replay, then another
  // write lands before the SELECT and the SELECT sees a real change (see writeOrAnswer).
  return writeOrAnswer(
    tag,
    async () =>
      (
        await query(
          `update drafts
            set title = coalesce($3, title),
                posts = coalesce($4::jsonb, posts),
                version = version + 1,
                updated_at = now()
          where id = $1 and user_id = $2
            and not (($3::text is null or title = $3::text) and ($4::jsonb is null or posts = $4::jsonb))
            and ($5::int is null or version = $5::int)
          returning ${COLUMNS}`,
          [params.id, session.uid, title, posts, tag]
        )
      ).rows[0],
    async (last) => {
      // No write: not the owner, a replay, or a stale tag. This statement never writes.
      const { rows: found } = await query(
        `select ${COLUMNS},
                ($3::text is null or title = $3::text) as same_title,
                ($4::jsonb is null or posts = $4::jsonb) as same_posts
           from drafts where id = $1 and user_id = $2`,
        [params.id, session.uid, title, posts]
      )
      if (!found[0]) throw notFound()
      const { same_title: sameTitle, same_posts: samePosts, ...draft } = found[0]
      if (sameTitle && samePosts) return json({ draft }, 200, etagHeaders(draft.version))
      return last ? staleResponse(draft) : undefined
    }
  )
}

/**
 * PATCH /api/drafts/:id/posts/:postId: changes only the text of one post, and returns the draft.
 * One UPDATE that re-checks its WHERE on the newest row (owner, not published, the post exists,
 * its text differs, the If-Match). Sending the text the post already has is a 200 with no write (a
 * replay). A stale If-Match is a 412 with no write.
 */
async function patchPostText({ request, params }) {
  const session = await requireUser(request)
  const body = requireObject(await readJson(request))
  if (Object.keys(body).some((key) => key !== 'text')) throw new HttpError(400, 'Only text can be changed here')
  if (typeof body.text !== 'string' || body.text.length > 4000 || xLength(body.text) > POST_TEXT_MAX) {
    throw new HttpError(400, `text must be a string of at most ${POST_TEXT_MAX} characters as X counts them`)
  }
  if (!isUuid(params.id)) throw notFound()
  const tag = tagOf(ifMatchOf(request))

  // The post is found by its id and compared as JSON, the same way the JavaScript checks below
  // compare it (`===` on a string), so the UPDATE and the answer agree. The first post with the id
  // is the one changed, as findIndex does. Retries: see writeOrAnswer.
  return writeOrAnswer(
    tag,
    async () =>
      (
        await query(
          `update drafts
            set posts = jsonb_set(posts,
                  array[(select (e.ord - 1)::text from jsonb_array_elements(posts) with ordinality e(p, ord)
                          where e.p->'id' = to_jsonb($3::text) order by e.ord limit 1), 'text'],
                  to_jsonb($4::text)),
                version = version + 1,
                updated_at = now()
          where id = $1 and user_id = $2 and not is_published
            and exists (select 1 from jsonb_array_elements(posts) e(p) where e.p->'id' = to_jsonb($3::text))
            and (select e.p->'text' from jsonb_array_elements(posts) with ordinality e(p, ord)
                  where e.p->'id' = to_jsonb($3::text) order by e.ord limit 1) is distinct from to_jsonb($4::text)
            and ($5::int is null or version = $5::int)
          returning ${COLUMNS}`,
          [params.id, session.uid, params.postId, body.text, tag]
        )
      ).rows[0],
    async (last) => {
      // No write: not the owner, published, no such post, a replay, or a stale tag. This statement never writes.
      const { rows: found } = await query(`select ${COLUMNS} from drafts where id = $1 and user_id = $2`, [params.id, session.uid])
      if (!found[0]) throw notFound()
      const draft = found[0]
      if (draft.is_published) throw new HttpError(409, 'This draft is published. Duplicate it to edit.')
      const index = draft.posts.findIndex((post) => post.id === params.postId)
      if (index < 0) throw new HttpError(404, 'Post not found in this draft')
      if (draft.posts[index].text === body.text) return json({ draft }, 200, etagHeaders(draft.version))
      return last ? staleResponse(draft) : undefined
    }
  )
}

/**
 * POST /api/drafts/:id/publish: clears the draft's images from its posts and deletes their Blob
 * files. One transaction with the row locked. Publishing a published draft is a 200 with no write
 * (a replay); a stale If-Match is a 412 with no write. The files are deleted only after the commit,
 * so a rolled-back publish never loses an image.
 */
async function publishDraft({ request, params }) {
  const session = await requireUser(request)
  if (!isUuid(params.id)) throw notFound()
  const expected = ifMatchOf(request)

  const { response, doomed } = await transaction(async (q) => {
    const { rows: found } = await q(`select ${COLUMNS} from drafts where id = $1 and user_id = $2 for update`, [params.id, session.uid])
    if (!found[0]) throw notFound()
    const draft = found[0]
    if (draft.is_published) return { response: json({ draft }, 200, etagHeaders(draft.version)), doomed: [] }
    if (!preconditionHolds(expected, draft.version)) return { response: staleResponse(draft), doomed: [] }
    const doomed = await deletableImageUrls(q, session.uid, params.id, draft.posts)
    const cleaned = draft.posts.map((post) => ({ ...post, images: [] }))
    const { rows } = await q(
      `update drafts
          set posts = $3::jsonb,
              is_published = true,
              published_at = now(),
              version = version + 1,
              updated_at = now()
        where id = $1 and user_id = $2
        returning ${COLUMNS}`,
      [params.id, session.uid, JSON.stringify(cleaned)]
    )
    return { response: json({ draft: rows[0] }, 200, etagHeaders(rows[0].version)), doomed }
  })
  if (doomed.length) await deleteBlobUrls(doomed)
  return response
}

/** DELETE /api/drafts/:id */
async function deleteDraft({ request, params }) {
  const session = await requireUser(request)
  const posts = await ownedPosts(params.id, session.uid)
  await deleteBlobUrls(await deletableImageUrls(query, session.uid, params.id, posts))
  await query('delete from drafts where id = $1 and user_id = $2', [params.id, session.uid])
  return json({ ok: true })
}

const SHARE_TTL_MIN = 60
const SHARE_TTL_MAX = 604800
const SHARE_TTL_DEFAULT = 3600

/** The default lifetime of a new share link: SHARE_LINK_TTL_SECONDS when it is a valid number, else one hour. */
function defaultShareTtl() {
  const configured = Number(process.env.SHARE_LINK_TTL_SECONDS)
  return Number.isInteger(configured) && configured >= SHARE_TTL_MIN && configured <= SHARE_TTL_MAX ? configured : SHARE_TTL_DEFAULT
}

/** The optional body of POST /drafts/:id/share-tokens. An empty body means the defaults. */
async function shareLinkOptions(request) {
  const body = await readOptionalJson(request)
  if (body === undefined) return { expiresIn: defaultShareTtl(), oneTime: true }
  requireObject(body)
  const expiresIn = body.expires_in === undefined ? defaultShareTtl() : body.expires_in
  if (!Number.isInteger(expiresIn) || expiresIn < SHARE_TTL_MIN || expiresIn > SHARE_TTL_MAX) {
    throw new HttpError(400, `expires_in must be a whole number of seconds from ${SHARE_TTL_MIN} to ${SHARE_TTL_MAX}`)
  }
  if (body.one_time !== undefined && typeof body.one_time !== 'boolean') throw new HttpError(400, 'one_time must be true or false')
  return { expiresIn, oneTime: body.one_time ?? true }
}

/**
 * POST /api/drafts/:id/share-tokens: a share link for the X-thread or agent link, or a reusable one.
 * Body (optional): { expires_in: 60..604800 seconds, one_time: true | false }.
 */
async function createShareToken({ request, params }) {
  const session = await requireUser(request)
  if (!isUuid(params.id)) throw notFound()
  const { expiresIn, oneTime } = await shareLinkOptions(request)
  const { rows } = await query(
    `insert into share_tokens (draft_id, created_by, one_time, expires_at)
     select $1::uuid, $2::uuid, $3::boolean, now() + ($4::integer * interval '1 second')
      where exists (select 1 from drafts where id = $1::uuid and user_id = $2::uuid)
     returning token, expires_at, one_time`,
    [params.id, session.uid, oneTime, expiresIn]
  )
  if (!rows[0]) throw notFound()
  return json({ token: rows[0].token, expires_at: rows[0].expires_at, one_time: rows[0].one_time }, 201)
}

/** DELETE /api/drafts/:id/share-tokens/:token: owner only. The link stops working at once. */
async function revokeShareToken({ request, params }) {
  const session = await requireUser(request)
  if (!isUuid(params.id) || !isUuid(params.token)) throw shareLinkNotFound()
  const { rows } = await query(
    `delete from share_tokens s
      using drafts d
      where s.token = $1 and s.draft_id = $2 and d.id = s.draft_id and d.user_id = $3
     returning s.token`,
    [params.token, params.id, session.uid]
  )
  if (!rows[0]) throw shareLinkNotFound()
  return new Response(null, { status: 204 })
}

/** DELETE /api/drafts/:id/share-tokens: owner only. Every share link of the draft stops working. */
async function revokeAllShareTokens({ request, params }) {
  const session = await requireUser(request)
  if (!isUuid(params.id)) throw notFound()
  const { rows } = await query('select 1 from drafts where id = $1 and user_id = $2', [params.id, session.uid])
  if (!rows[0]) throw notFound()
  await query('delete from share_tokens where draft_id = $1', [params.id])
  return new Response(null, { status: 204 })
}

export const draftRoutes = [
  { method: 'GET', path: '/drafts', handler: listDrafts, ci: true },
  { method: 'POST', path: '/drafts', handler: createDraft, ci: true },
  { method: 'GET', path: '/drafts/:id', handler: getDraft, ci: true },
  { method: 'GET', path: '/drafts/:id/outline', handler: getDraftOutline, ci: true },
  { method: 'PATCH', path: '/drafts/:id', handler: updateDraft, ci: true },
  { method: 'POST', path: '/drafts/:id/publish', handler: publishDraft, ci: true },
  { method: 'POST', path: '/drafts/:id/duplicate', handler: duplicateDraft, ci: true },
  { method: 'GET', path: '/drafts/:id/export', handler: exportDraft, ci: true },
  { method: 'DELETE', path: '/drafts/:id', handler: deleteDraft, ci: true },
  { method: 'POST', path: '/drafts/:id/share-tokens', handler: createShareToken, ci: true },
  { method: 'DELETE', path: '/drafts/:id/share-tokens', handler: revokeAllShareTokens, ci: true },
  { method: 'DELETE', path: '/drafts/:id/share-tokens/:token', handler: revokeShareToken, ci: true },
  { method: 'PATCH', path: '/drafts/:id/posts/:postId', handler: patchPostText, ci: true }
]
