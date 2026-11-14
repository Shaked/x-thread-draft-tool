// @vitest-environment node
import { beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('../../server/blob.js', () => ({ putBlob: vi.fn(), deleteBlobUrls: vi.fn(async () => {}) }))

import { route } from '../../server/router.js'
import { apiRequest, setupTestDb } from './helpers/db.js'

let db

beforeAll(async () => {
  db = await setupTestDb()
})

describe('GET /api/drafts/:id/export numbered text', () => {
  it('numbered=true puts an i/N line before each post, the same as the UI copy', async () => {
    await db.reset()
    const alice = await db.insertUser({ github_id: 1, login: 'alice' })
    const posts = [
      { id: 'a', text: 'first post', images: [], embeddedTweet: null },
      { id: 'b', text: 'second', images: [], embeddedTweet: null }
    ]
    const { rows } = await db.pg.query(
      'insert into drafts (user_id, title, posts) values ($1, $2, $3::jsonb) returning id',
      [alice.id, 'T', JSON.stringify(posts)]
    )
    const cookie = await db.cookieFor(alice)
    const numbered = await route(apiRequest(`/api/drafts/${rows[0].id}/export?format=text&numbered=true`, { method: 'GET', cookie }))
    expect(numbered.status).toBe(200)
    expect(await numbered.text()).toBe('1/2\nfirst post\n\n2/2\nsecond')
    const plain = await route(apiRequest(`/api/drafts/${rows[0].id}/export?format=text`, { method: 'GET', cookie }))
    expect(await plain.text()).toBe('first post\n\nsecond')
  })
})
