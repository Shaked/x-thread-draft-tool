// @vitest-environment node
// #385 (E273 Task H11, H1-Q4 option a): while viewing as a user, every route under /drafts answers without the target's
// text, and the target's own session still sees everything. The claim is sealed in the test (as in view-as.test.js).
import { decodeJwt } from 'jose'
import { beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('../../server/blob.js', () => ({
  putBlob: vi.fn(),
  deleteBlobUrls: vi.fn(async () => {}),
  listBlobPrefix: vi.fn(async () => ({ files: [], truncated: false })),
  removeBlobPrefix: vi.fn(async () => ({ deleted: 0, remaining: 0, bytes: 0 }))
}))

import { ROUTES, route } from '../../server/router.js'
import { sealViewAs } from '../../server/admin/view-as.js'
import { apiRequest, setupTestDb } from './helpers/db.js'

const MARK = 'VIEWASMARK-9f3a'
const MARKS = [MARK, `${MARK} title`, 'https://blob.example/img-VIEWASMARK.png']
const NIL = '00000000-0000-4000-8000-000000000000'

let db
let alice
let draft
let aliceCookie
let viewing

const call = (method, path, cookie, headers = { 'x-xt-admin': '1' }) => route(apiRequest(`/api${path}`, { method, cookie, headers }))

beforeAll(async () => {
  db = await setupTestDb()
  await db.reset()
  const admin = await db.insertUser({ github_id: 960015, login: 'shaked' })
  alice = await db.insertUser({ github_id: 1, login: 'alice' })
  draft = await db.insertDraft(alice.id, {
    title: `${MARK} title`,
    posts: [{ id: 'p1', text: `${MARK} first post`, images: [{ url: 'https://blob.example/img-VIEWASMARK.png' }], embeddedTweet: null }]
  })
  const adminCookie = await db.cookieFor(admin)
  const claim = await sealViewAs({
    adminUid: admin.id,
    adminJti: decodeJwt(adminCookie.split('=')[1]).jti,
    targetUid: alice.id,
    targetGh: alice.github_id,
    targetLogin: alice.login,
    reason: 'test',
    vid: 'v1'
  })
  viewing = `${adminCookie}; xt_view_as=${claim}`
  aliceCookie = await db.cookieFor(alice)
})

// Every GET route under /drafts, with a path that fills the parameters.
const getRoutes = () => ROUTES.filter((r) => r.method === 'GET' && r.path.startsWith('/drafts'))
const fill = (path) => path.replace(':id', draft.id).replace(':seq', '1')

describe('view as shows counts only (#385)', () => {
  it('every GET route under /drafts answers without the target\'s text', async () => {
    expect(getRoutes().length).toBeGreaterThanOrEqual(5)
    for (const r of getRoutes()) {
      const path = r.path === '/drafts' ? '/drafts?published=false' : fill(r.path)
      const text = await (await call('GET', path, viewing)).text()
      for (const mark of MARKS) expect({ path, leak: text.includes(mark) }).toEqual({ path, leak: false })
    }
  })

  it('the list shows counts under "Private draft"; the outline has counts, no preview, no images', async () => {
    const list = (await (await call('GET', '/drafts?published=false', viewing)).json()).drafts
    expect(list[0]).toMatchObject({ id: draft.id, title: 'Private draft', post_count: 1, image_count: 1 })
    const res = await call('GET', `/drafts/${draft.id}/outline`, viewing)
    expect(res.status).toBe(200)
    const { draft: outline } = await res.json()
    expect(outline).toMatchObject({ title: 'Private draft', post_count: 1 })
    expect(outline.posts[0]).toMatchObject({ index: 1, image_count: 1 })
    expect(outline.posts[0]).not.toHaveProperty('preview')
    expect(outline.posts[0]).not.toHaveProperty('images')
  })

  it('a draft, its export and its history answer 403 "Viewing as cannot open drafts."', async () => {
    for (const path of [`/drafts/${draft.id}`, `/drafts/${draft.id}/export`, `/drafts/${draft.id}/revisions`, `/drafts/${draft.id}/revisions/1`]) {
      const res = await call('GET', path, viewing)
      expect({ path, status: res.status, error: (await res.json()).error }).toEqual({ path, status: 403, error: 'Viewing as cannot open drafts.' })
    }
    // The answer is the same for a draft that does not exist: it does not say whether one exists.
    expect((await call('GET', `/drafts/${NIL}`, viewing)).status).toBe(403)
  })

  it('the target\'s own session still sees everything', async () => {
    const own = await (await call('GET', `/drafts/${draft.id}`, aliceCookie, {})).json()
    expect(own.draft.title).toBe(`${MARK} title`)
    expect(own.draft.posts[0].text).toContain(MARK)
    const outline = (await (await call('GET', `/drafts/${draft.id}/outline`, aliceCookie, {})).json()).draft
    expect(outline.posts[0].preview).toContain('VIEWASMARK')
    expect((await call('GET', `/drafts/${draft.id}/export?format=text`, aliceCookie, {})).status).toBe(200)
    expect((await call('GET', `/drafts/${draft.id}/revisions`, aliceCookie, {})).status).toBe(200)
    const list = (await (await call('GET', '/drafts?published=false', aliceCookie, {})).json()).drafts
    expect(list[0].title).toBe(`${MARK} title`)
  })

  it('every GET route under /drafts calls redactForViewAs (arch test, style of admin-role-arch)', () => {
    const missing = getRoutes().filter((r) => !String(r.handler).includes('redactForViewAs')).map((r) => r.path)
    expect(missing).toEqual([])
  })
})
