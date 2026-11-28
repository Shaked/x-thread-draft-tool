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

// The real helper, wrapped so the test sees that each draft route actually calls it at runtime (not just names it in its source).
vi.mock('../../server/view-as-redact.js', async (original) => {
  const actual = await original()
  return { ...actual, redactForViewAs: vi.fn(actual.redactForViewAs) }
})

import { redactForViewAs } from '../../server/view-as-redact.js'
import { ROUTES, route } from '../../server/router.js'
import { sealViewAs } from '../../server/admin/view-as.js'
import { apiRequest, setupTestDb } from './helpers/db.js'

// Every user-settable field of a draft carries the marker: the title, a post id (validPosts accepts any string), the text, an image
// url and its alt text, an embedded tweet, and a field the app does not know. Anything that shows the marker leaks draft text.
const MARK = 'VIEWASMARK-9f3a'
const LEAK = /viewasmark/i
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
    posts: [
      {
        id: `${MARK}-postid`,
        text: `${MARK} first post`,
        images: [{ url: 'https://blob.example/img-VIEWASMARK.png', alt: `${MARK} alt` }],
        embeddedTweet: { url: `https://x.com/a/status/1?${MARK}`, html: `${MARK} embed` },
        note: `${MARK} unknown field`
      },
      { id: 'p2', text: `${MARK} second post`, images: [], embeddedTweet: null }
    ]
  })
  await db.insertDraft(alice.id, { title: `${MARK} published`, is_published: true, published_at: new Date().toISOString(), posts: [{ id: `${MARK}-pub`, text: `${MARK} published post`, images: [] }] })
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

// Every GET route under /drafts, and every GET route that is not an admin route, with a path that fills the parameters.
const getRoutes = () => ROUTES.filter((r) => r.method === 'GET' && r.path.startsWith('/drafts'))
const allGetRoutes = () => ROUTES.filter((r) => r.method === 'GET' && !r.path.startsWith('/admin'))
const fill = (path) => path.replace(':id', draft.id).replace(':seq', '1').replace(/:\w+/g, NIL)
const listPath = (path) => (path === '/drafts' ? '/drafts?published=false' : fill(path))

describe('view as shows counts only (#385)', () => {
  it('no GET route except /admin answers with the target\'s text, in any field', async () => {
    expect(allGetRoutes().length).toBeGreaterThanOrEqual(15)
    for (const r of allGetRoutes()) {
      for (const path of r.path === '/drafts' ? ['/drafts?published=false', '/drafts?published=true', '/drafts?published=false&view=summary'] : [fill(r.path)]) {
        const res = await call('GET', path, viewing)
        expect({ path, leak: LEAK.test(await res.text()) }).toEqual({ path, leak: false })
      }
    }
  })

  it('every GET route under /drafts calls redactForViewAs at runtime', async () => {
    expect(getRoutes().length).toBeGreaterThanOrEqual(5)
    for (const r of getRoutes()) {
      redactForViewAs.mockClear()
      await call('GET', listPath(r.path), viewing)
      expect({ path: r.path, calls: redactForViewAs.mock.calls.length > 0 }).toEqual({ path: r.path, calls: true })
    }
  })

  it('the list and the outline show only counts and flags, under "Private draft"', async () => {
    const list = (await (await call('GET', '/drafts?published=false', viewing)).json()).drafts
    expect(list[0]).toMatchObject({ id: draft.id, title: 'Private draft', post_count: 2, image_count: 1 })
    const res = await call('GET', `/drafts/${draft.id}/outline`, viewing)
    expect(res.status).toBe(200)
    const { draft: outline } = await res.json()
    expect(outline).toMatchObject({ title: 'Private draft', post_count: 2 })
    // Only the allowed fields: counts and flags, never the post id, the preview or the image urls.
    expect(outline.posts[0]).toEqual({ index: 1, chars: expect.any(Number), remaining: expect.any(Number), over_limit: false, image_count: 1 })
    expect(Object.keys(outline).sort()).toEqual(['id', 'image_count', 'is_published', 'over_limit_count', 'post_count', 'posts', 'published_at', 'title', 'total_chars', 'updated_at', 'version'])
    expect(Object.keys(list[0]).sort()).toEqual(Object.keys(outline).filter((key) => key !== 'posts').sort())
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
    expect(own.draft.posts[0].id).toBe(`${MARK}-postid`)
    expect((await call('GET', `/drafts/${draft.id}/export?format=text`, aliceCookie, {})).status).toBe(200)
    expect((await call('GET', `/drafts/${draft.id}/revisions`, aliceCookie, {})).status).toBe(200)
    const list = (await (await call('GET', '/drafts?published=false', aliceCookie, {})).json()).drafts
    expect(list[0].title).toBe(`${MARK} title`)
  })
})
