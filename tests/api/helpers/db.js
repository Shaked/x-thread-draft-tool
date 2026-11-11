// Shared fixtures for API tests: an in-process Postgres (PGlite) wired into server/db.js.
import { PGlite } from '@electric-sql/pglite'
import { applyMigrations } from '../../../scripts/migrate.mjs'
import { setQueryImpl } from '../../../server/db.js'
import { createSession } from '../../../server/session.js'

export const APP_URL = 'https://app.test'

export async function setupTestDb() {
  process.env.SESSION_SECRET = 'test-session-secret-0123456789-abcdefghijklmnop'
  process.env.PUBLIC_APP_URL = APP_URL
  process.env.GITHUB_CLIENT_ID = 'test-client-id'
  process.env.GITHUB_CLIENT_SECRET = 'test-client-secret'

  const pg = new PGlite()
  setQueryImpl(async (text, params = []) => {
    const result = await pg.query(text, params)
    return { rows: result.rows, rowCount: result.affectedRows ?? result.rows.length }
  })
  await applyMigrations((text, params) =>
    params === undefined
      ? pg.exec(text).then((results) => ({ rows: results.at(-1)?.rows ?? [] }))
      : pg.query(text, params)
  )

  return {
    pg,
    /** Empties every table; call between tests. */
    async reset() {
      await pg.exec('truncate share_tokens, drafts, users cascade')
    },
    async insertUser(overrides = {}) {
      const user = {
        github_id: 1001,
        login: 'alice',
        name: 'Alice Example',
        avatar_url: 'https://avatars.test/alice.png',
        ...overrides
      }
      const { rows } = await pg.query(
        'insert into users (github_id, login, name, avatar_url) values ($1, $2, $3, $4) returning *',
        [user.github_id, user.login, user.name, user.avatar_url]
      )
      return rows[0]
    },
    async insertDraft(userId, overrides = {}) {
      const draft = {
        title: 'Draft',
        posts: [{ id: 'p1', text: 'hello', images: [], embeddedTweet: null }],
        is_published: false,
        published_at: null,
        ...overrides
      }
      const { rows } = await pg.query(
        `insert into drafts (user_id, title, posts, is_published, published_at)
         values ($1, $2, $3::jsonb, $4, $5) returning *`,
        [userId, draft.title, JSON.stringify(draft.posts), draft.is_published, draft.published_at]
      )
      return rows[0]
    },
    /** Cookie header value for a user row, as issued by the callback. */
    async cookieFor(user) {
      const token = await createSession({ id: user.id, github_id: user.github_id, login: user.login })
      return `xt_session=${token}`
    }
  }
}

/** Builds a Request against the app origin. */
export function apiRequest(path, { method = 'GET', body, cookie, headers = {}, origin } = {}) {
  const init = { method, headers: { ...headers } }
  if (cookie) init.headers.cookie = cookie
  if (origin) init.headers.origin = origin
  if (body !== undefined) {
    init.body = typeof body === 'string' || body instanceof Uint8Array ? body : JSON.stringify(body)
    if (!init.headers['content-type'] && typeof body !== 'string' && !(body instanceof Uint8Array)) {
      init.headers['content-type'] = 'application/json'
    }
  }
  return new Request(`${APP_URL}${path}`, init)
}
