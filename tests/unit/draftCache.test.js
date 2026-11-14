import { beforeEach, describe, expect, it, vi } from 'vitest'

const { keysMock, delManyMock } = vi.hoisted(() => ({ keysMock: vi.fn(), delManyMock: vi.fn() }))

vi.mock('idb-keyval', () => ({ keys: (...a) => keysMock(...a), delMany: (...a) => delManyMock(...a) }))

import { clearCachedDrafts } from '../../src/utils/draftCache.js'

describe('clearCachedDrafts', () => {
  beforeEach(() => {
    keysMock.mockReset()
    delManyMock.mockReset()
  })

  it('deletes every draft-* key and nothing else', async () => {
    keysMock.mockResolvedValue(['draft-a', 'xt-theme', 'draft-b', 42])
    await clearCachedDrafts()
    expect(delManyMock).toHaveBeenCalledWith(['draft-a', 'draft-b'])
  })

  it('does nothing when no draft is cached', async () => {
    keysMock.mockResolvedValue(['xt-theme'])
    await clearCachedDrafts()
    expect(delManyMock).not.toHaveBeenCalled()
  })

  it('never throws when IndexedDB is blocked', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    keysMock.mockRejectedValue(new Error('blocked'))
    await expect(clearCachedDrafts()).resolves.toBeUndefined()
    spy.mockRestore()
  })
})
