// #474: a 412 where the other app changed other posts is merged and saved once; every other 412 shows the banner.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import DraftEditor from '../../src/pages/DraftEditor.jsx'
import { draftsApi } from '../../src/utils/api'
import { clear as idbClear, get as idbGet } from 'idb-keyval'
import { ToastProvider } from '../../src/ui/Toast.jsx'
import { ConfirmProvider } from '../../src/ui/Dialog.jsx'

vi.mock('../../src/utils/api', () => ({
  draftsApi: { get: vi.fn(), update: vi.fn() },
  authApi: { login: vi.fn() }
}))
vi.mock('idb-keyval', () => {
  const store = new Map()
  return {
    set: vi.fn(async (key, value) => void store.set(key, value)),
    get: vi.fn(async key => store.get(key)),
    del: vi.fn(async key => void store.delete(key)),
    clear: async () => store.clear()
  }
})
// One textarea per post, so a test can type in a post.
vi.mock('../../src/components/ThreadComposer', () => ({
  default: ({ posts, onPostsChange }) => (
    <div>
      {posts.map(post => (
        <textarea
          key={post.id}
          aria-label={`Post ${post.id}`}
          value={post.text}
          onChange={event => onPostsChange(posts.map(p => (p.id === post.id ? { ...p, text: event.target.value } : p)))}
        />
      ))}
      <button type="button" onClick={() => onPostsChange([posts[1], posts[0], ...posts.slice(2)])}>
        Move first post down
      </button>
    </div>
  )
}))
vi.mock('../../src/components/AgentLinkButton', () => ({ default: () => null }))
vi.mock('../../src/components/XThreadLinkButton', () => ({ default: () => null }))
vi.mock('../../src/components/ShareLinkButton', () => ({ default: () => null }))
vi.mock('../../src/components/ExportOptions', () => ({ default: () => null }))

const post = (id, text) => ({ id, text, images: [] })
const DRAFT = { id: 'd1', title: 'Draft', version: 3, posts: [post('p1', 'one'), post('p2', 'two'), post('p3', 'three')] }
const theirsWith = (posts, extra = {}) => ({ ...DRAFT, version: 5, posts, ...extra })
const withText = (id, text) => DRAFT.posts.map(p => (p.id === id ? { ...p, text } : p))
const httpError = (status, message, extra = {}) => Object.assign(new Error(message), { status, ...extra })
const stale = draft => httpError(412, 'stale', { version: draft.version, draft })

function renderEditor() {
  return render(
    <ToastProvider>
      <MemoryRouter initialEntries={['/draft/d1']}>
        <ConfirmProvider>
          <Routes>
            <Route path="/draft/:id" element={<DraftEditor user={{ login: 'owner' }} />} />
          </Routes>
        </ConfirmProvider>
      </MemoryRouter>
    </ToastProvider>
  )
}

const typer = () => userEvent.setup({ advanceTimers: vi.advanceTimersByTime, delay: null })
const tick = async ms => act(async () => void (await vi.advanceTimersByTimeAsync(ms)))
async function typeIn(label, text) {
  await typer().type(await screen.findByLabelText(label), text)
  await tick(1000)
}

describe('DraftEditor merge after a 412 (#474)', () => {
  beforeEach(async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    await idbClear()
    draftsApi.update.mockReset()
    draftsApi.get.mockResolvedValue(structuredClone(DRAFT))
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })
  afterEach(() => {
    vi.useRealTimers()
    cleanup()
    vi.clearAllMocks()
    vi.restoreAllMocks()
  })

  it('different posts: merges, saves once with their version, shows the note for 6 s, no banner', async () => {
    draftsApi.update
      .mockRejectedValueOnce(stale(theirsWith(withText('p3', 'three, by the AI app'))))
      .mockResolvedValueOnce({ ...DRAFT, version: 6 })
    renderEditor()
    await typeIn('Post p1', '!')

    await waitFor(() => expect(draftsApi.update).toHaveBeenCalledTimes(1))
    await tick(1000)
    await waitFor(() => expect(draftsApi.update).toHaveBeenCalledTimes(2))
    const [, body, ifMatch] = draftsApi.update.mock.calls[1]
    expect(ifMatch).toBe(5)
    expect(body.posts.map(p => p.text)).toEqual(['one!', 'two', 'three, by the AI app'])
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByLabelText('Post p1')).toHaveValue('one!')
    expect(screen.getByLabelText('Post p3')).toHaveValue('three, by the AI app')
    expect(screen.getByText('Changes from another app were added. Your edits are kept.')).toBeInTheDocument()

    await tick(1000)
    expect(draftsApi.update).toHaveBeenCalledTimes(2)
    await tick(6000)
    expect(screen.queryByText('Changes from another app were added. Your edits are kept.')).not.toBeInTheDocument()
    // The kept copy of my text is gone once the merged save worked.
    expect(await idbGet('draft-d1-mine')).toBeUndefined()
  })

  it('keeps text typed while the merged save waits', async () => {
    draftsApi.update
      .mockRejectedValueOnce(stale(theirsWith(withText('p3', 'AI three'))))
      .mockResolvedValueOnce({ ...DRAFT, version: 6 })
      .mockResolvedValueOnce({ ...DRAFT, version: 7 })
    renderEditor()
    await typeIn('Post p1', '!')
    await waitFor(() => expect(draftsApi.update).toHaveBeenCalledTimes(1))
    await typer().type(screen.getByLabelText('Post p2'), '?')
    await tick(1000)
    await tick(1000)

    const last = draftsApi.update.mock.calls.at(-1)
    expect(last[1].posts.map(p => p.text)).toEqual(['one!', 'two?', 'AI three'])
    expect(last[2]).toBeGreaterThanOrEqual(5)
  })

  it('the same post: the banner, nothing saved, my text kept', async () => {
    draftsApi.update.mockRejectedValue(stale(theirsWith(withText('p1', 'one, by the AI app'))))
    renderEditor()
    await typeIn('Post p1', '!')

    expect(await screen.findByRole('alert')).toHaveTextContent('This draft changed in another app while you were editing.')
    expect(screen.queryByText('Changes from another app were added. Your edits are kept.')).not.toBeInTheDocument()
    expect(draftsApi.update).toHaveBeenCalledTimes(1)
    expect(screen.getByLabelText('Post p1')).toHaveValue('one!')
    expect(await idbGet('draft-d1-mine')).toContain('one!')
  })

  it('both sides moved posts: the banner, nothing saved', async () => {
    draftsApi.update.mockRejectedValue(stale(theirsWith([DRAFT.posts[0], DRAFT.posts[2], DRAFT.posts[1]])))
    renderEditor()
    await typer().click(await screen.findByRole('button', { name: 'Move first post down' }))
    await tick(1000)

    expect(await screen.findByRole('alert')).toBeInTheDocument()
    expect(draftsApi.update).toHaveBeenCalledTimes(1)
    expect(screen.queryByText('Changes from another app were added. Your edits are kept.')).not.toBeInTheDocument()
    expect((await idbGet('draft-d1-mine')) ?? '').toContain('two')
  })

  it('they moved posts and I edited text: merges in their order', async () => {
    draftsApi.update
      .mockRejectedValueOnce(stale(theirsWith([DRAFT.posts[1], DRAFT.posts[0], DRAFT.posts[2]])))
      .mockResolvedValueOnce({ ...DRAFT, version: 6 })
    renderEditor()
    await typeIn('Post p3', '!')
    await tick(1000)
    await waitFor(() => expect(draftsApi.update).toHaveBeenCalledTimes(2))
    expect(draftsApi.update.mock.calls[1][1].posts.map(p => p.text)).toEqual(['two', 'one', 'three!'])
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('the title changed on both sides: the banner', async () => {
    draftsApi.update.mockRejectedValue(stale(theirsWith(DRAFT.posts, { title: 'Theirs' })))
    renderEditor()
    await typer().type(await screen.findByLabelText('Draft title'), '!')
    await tick(1000)
    expect(await screen.findByRole('alert')).toBeInTheDocument()
    expect(draftsApi.update).toHaveBeenCalledTimes(1)
  })

  it('the merged save gets a 412 too: the banner, and nothing is lost', async () => {
    draftsApi.update
      .mockRejectedValueOnce(stale(theirsWith(withText('p3', 'AI three'))))
      .mockRejectedValueOnce(stale({ ...theirsWith(withText('p3', 'AI three again')), version: 7 }))
    renderEditor()
    await typeIn('Post p1', '!')
    await waitFor(() => expect(draftsApi.update).toHaveBeenCalledTimes(1))
    await tick(1000)

    expect(await screen.findByRole('alert')).toBeInTheDocument()
    expect(draftsApi.update).toHaveBeenCalledTimes(2)
    await tick(5000)
    expect(draftsApi.update).toHaveBeenCalledTimes(2)
    // My edit is still in the editor and kept in this browser.
    expect(screen.getByLabelText('Post p1')).toHaveValue('one!')
    expect(await idbGet('draft-d1-mine')).toContain('one!')
  })

  it('a 412 without the other draft is the banner', async () => {
    draftsApi.update.mockRejectedValue(httpError(412, 'stale', { version: 5 }))
    renderEditor()
    await typeIn('Post p1', '!')
    expect(await screen.findByRole('alert')).toBeInTheDocument()
  })
})
