import { afterEach, describe, expect, it, vi } from 'vitest'
import { draftsApi } from '../../src/utils/api'

// #363: the editor's cheap check. 304 means unchanged; a 200 carries the newer draft.
describe('draftsApi.check (If-None-Match)', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('sends the held version as a strong entity tag and returns changed: false on 304', async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 304 }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(draftsApi.check('d1', 3)).resolves.toEqual({ changed: false })
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/drafts/d1')
    expect(init.headers['if-none-match']).toBe('"3"')
  })

  it('returns the newer draft on 200', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ draft: { id: 'd1', version: 4 } }), { status: 200 })))

    await expect(draftsApi.check('d1', 3)).resolves.toEqual({ changed: true, draft: { id: 'd1', version: 4 } })
  })

  it('throws with the status on an error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'Not found' }), { status: 404 })))

    await expect(draftsApi.check('d1', 3)).rejects.toMatchObject({ status: 404, message: 'Not found' })
  })
})
