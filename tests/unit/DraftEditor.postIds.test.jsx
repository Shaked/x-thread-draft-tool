import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import DraftEditor from '../../src/pages/DraftEditor.jsx'
import { draftsApi } from '../../src/utils/api'

vi.mock('../../src/utils/api', () => ({
  draftsApi: { get: vi.fn(), update: vi.fn() },
  authApi: { login: vi.fn() }
}))
vi.mock('idb-keyval', () => ({ set: vi.fn(() => Promise.resolve()), del: vi.fn(() => Promise.resolve()) }))
vi.mock('../../src/components/ThreadComposer', () => ({ default: () => null }))
vi.mock('../../src/components/AgentLinkButton', () => ({ default: () => null }))
vi.mock('../../src/components/XThreadLinkButton', () => ({ default: () => null }))
vi.mock('../../src/components/ShareLinkButton', () => ({ default: () => null }))
vi.mock('../../src/components/ExportOptions', () => ({ default: () => null }))
vi.mock('../../src/components/AppBar', () => ({ default: ({ children }) => <div>{children}</div> }))
vi.mock('../../src/components/AppMenu', () => ({ default: () => null }))

function renderEditor() {
  return render(
    <MemoryRouter initialEntries={['/draft/d1']}>
      <Routes>
        <Route path="/draft/:id" element={<DraftEditor user={{ login: 'owner' }} />} />
      </Routes>
    </MemoryRouter>
  )
}

// Types one character into the title, which starts the debounced save (1 s), then returns what was saved.
async function editAndReadSavedPosts() {
  const title = await screen.findByLabelText('Draft title')
  await userEvent.type(title, '!')
  // Run the 1 s save debounce on a fake clock instead of waiting for it.
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1000)
  })
  await waitFor(() => expect(draftsApi.update).toHaveBeenCalled(), { timeout: 3000 })
  return draftsApi.update.mock.calls[0][1].posts
}

describe('DraftEditor and posts saved without an id', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    vi.spyOn(console, 'error').mockImplementation(() => {})
    draftsApi.update.mockResolvedValue({})
  })

  afterEach(() => {
    vi.useRealTimers()
    cleanup()
    vi.clearAllMocks()
    vi.restoreAllMocks()
  })

  it('gives an id to an object post that has none, and keeps the ids that exist', async () => {
    draftsApi.get.mockResolvedValue({
      id: 'd1',
      title: 'Old draft',
      posts: [
        { text: 'saved before ids', images: [] },
        { id: 'p2', text: 'has an id', images: [] }
      ]
    })
    renderEditor()
    const posts = await editAndReadSavedPosts()

    expect(posts).toHaveLength(2)
    expect(typeof posts[0].id).toBe('string')
    expect(posts[0].id).not.toBe('')
    expect(posts[0].text).toBe('saved before ids')
    expect(posts[1]).toEqual({ id: 'p2', text: 'has an id', images: [] })
  })

  it('leaves a draft whose posts all have ids exactly as it was', async () => {
    draftsApi.get.mockResolvedValue({
      id: 'd1',
      title: 'Current draft',
      posts: [{ id: 'p1', text: 'one', images: [] }]
    })
    renderEditor()
    const posts = await editAndReadSavedPosts()

    expect(posts).toEqual([{ id: 'p1', text: 'one', images: [] }])
  })
})
