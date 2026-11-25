// @vitest-environment node
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { route } from '../../server/router.js'
import { issuePair } from '../../server/oauth/tokens.js'
import { APP_URL, apiRequest, setupTestDb } from './helpers/db.js'

let db
let token

beforeAll(async () => {
  db = await setupTestDb()
})

beforeEach(async () => {
  await db.reset()
  await db.pg.query(
    "insert into oauth_clients (client_id, kind, client_name) values ('xtc_mcp_test', 'registered', 'Test') on conflict do nothing"
  )
  // The admin (GitHub id 960015, #368): the only identity the changelog answers.
  const owner = await db.insertUser({ github_id: 960015, login: 'owner' })
  token = await tokenFor(owner)
  normalToken = await tokenFor(await db.insertUser({ github_id: 1, login: 'alice' }))
})

let normalToken

/** A bearer token for `user`, granted for drafts on the MCP connection (the same grant as the other API tests). */
async function tokenFor(user) {
  const { rows } = await db.pg.query(
    "insert into oauth_grants (user_id, client_id, scope, resource) values ($1, 'xtc_mcp_test', 'drafts', $2) returning id",
    [user.id, `${APP_URL}/api`]
  )
  return (await issuePair(rows[0].id)).access_token
}

/** GET /api/changelog with the token (or none). */
function get(query = '', { signedIn = true, bearer = token } = {}) {
  const headers = signedIn ? { authorization: `Bearer ${bearer}` } : {}
  return route(apiRequest(`/api/changelog${query}`, { headers }))
}

/** Every entry, walking the pages with the largest limit. */
async function walk() {
  const all = []
  let before = null
  do {
    const res = await get(`?limit=50${before ? `&before=${before}` : ''}`)
    const body = await res.json()
    all.push(...body.entries)
    before = body.next
  } while (before)
  return all
}

describe('GET /api/changelog', () => {
  it('is admin only: signed out, and a normal user, get the 404 of an unknown path, with the same body (#368)', async () => {
    const unknown = await (await route(apiRequest('/api/zz-no-such-route'))).text()
    for (const res of [await get('', { signedIn: false }), await get('', { bearer: normalToken })]) {
      expect(res.status).toBe(404)
      expect(await res.text()).toBe(unknown)
    }
  })

  it('is private and cacheable for five minutes', async () => {
    const res = await get()
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toBe('private, max-age=300')
  })

  it('returns 20 entries by default, newest first, with id, date, title, summary, area, link and details', async () => {
    const body = await (await get()).json()
    const all = await walk()
    expect(all.length).toBeGreaterThanOrEqual(2)
    expect(body.entries).toEqual(all.slice(0, 20))
    expect(Object.keys(body.entries[0]).sort()).toEqual(['area', 'date', 'details', 'id', 'link', 'summary', 'title'])
    const ids = all.map((entry) => entry.id)
    expect([...ids].sort().reverse()).toEqual(ids)
  })

  it('pages: limit=1 gives next, the next page starts right after it, and no entry repeats', async () => {
    const first = await (await get('?limit=1')).json()
    expect(first.entries).toHaveLength(1)
    expect(first.next).toBe(first.entries[0].id)
    const second = await (await get(`?limit=1&before=${first.next}`)).json()
    expect(second.entries[0].id).not.toBe(first.entries[0].id)
    expect(second.entries[0].id).toBe((await walk())[1].id)
    const all = await walk()
    expect(new Set(all.map((entry) => entry.id)).size).toBe(all.length)
  })

  it('ends with next null, and an empty page after the last entry', async () => {
    const all = await walk()
    const last = await (await get(`?limit=50&before=${all.at(-1).id}`)).json()
    expect(last).toEqual({ entries: [], next: null })
  })

  it('refuses a limit above 50, below 1 or not a number with 400', async () => {
    expect((await get('?limit=51')).status).toBe(400)
    expect((await get('?limit=0')).status).toBe(400)
    expect((await get('?limit=abc')).status).toBe(400)
  })

  it('refuses an unknown before with 400', async () => {
    expect((await get('?before=19990101-000000-nope')).status).toBe(400)
  })

  it('is not listed in the OpenAPI document (admin routes are not in it, #368)', async () => {
    const doc = await (await route(apiRequest('/api/openapi.json'))).json()
    expect(doc.paths['/changelog']).toBeUndefined()
  })
})
