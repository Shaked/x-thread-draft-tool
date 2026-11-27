import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import DraftEditor from '../../src/pages/DraftEditor.jsx'
import { draftsApi } from '../../src/utils/api'
import { set as idbSet } from 'idb-keyval'
import { ToastProvider } from '../../src/ui/Toast.jsx'
import { ConfirmProvider } from '../../src/ui/Dialog.jsx'
import { ViewAsContext } from '../../src/utils/viewAs'

// While viewing as a user (#291) nothing of theirs is written to this browser and nothing is saved.
vi.mock('../../src/utils/api', () => ({
  draftsApi: { get: vi.fn(), update: vi.fn(), publish: vi.fn() },
  authApi: { login: vi.fn() }
}))
vi.mock('idb-keyval', () => ({ set: vi.fn(() => Promise.resolve()), del: vi.fn(() => Promise.resolve()), get: vi.fn(() => Promise.resolve(undefined)) }))
vi.mock('../../src/components/AgentLinkButton', () => ({ default: () => null }))
vi.mock('../../src/components/XThreadLinkButton', () => ({ default: () => null }))
vi.mock('../../src/components/AppBar', () => ({ default: ({ children }) => <div>{children}</div> }))
vi.mock('../../src/components/AppMenu', () => ({ default: () => null }))

const DRAFT = { id: 'd1', title: 'Draft one', version: 1, posts: [{ id: 'p1', text: 'hello', images: [] }] }
const VIEW_AS = { login: 'alice', user_id: 'u1', expires_at: '2099-01-01T00:00:00Z' }

function renderEditor(viewAs) {
  return render(
    <ViewAsContext.Provider value={viewAs}>
      <ToastProvider>
        <MemoryRouter initialEntries={['/draft/d1']}>
          <ConfirmProvider>
            <Routes>
              <Route path="/draft/:id" element={<DraftEditor user={{ login: 'owner' }} />} />
            </Routes>
          </ConfirmProvider>
        </MemoryRouter>
      </ToastProvider>
    </ViewAsContext.Provider>
  )
}

describe('DraftEditor while viewing as a user', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    draftsApi.get.mockResolvedValue(structuredClone(DRAFT))
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })
  afterEach(() => {
    vi.useRealTimers()
    cleanup()
    vi.clearAllMocks()
    vi.restoreAllMocks()
  })

  it('does not write to the browser cache on load, and never saves', async () => {
    renderEditor(VIEW_AS)
    await screen.findByLabelText('Draft title')
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000)
    })
    expect(idbSet).not.toHaveBeenCalled()
    expect(draftsApi.update).not.toHaveBeenCalled()
  })

  it('disables the title, the post text, Publish and every editing control with the reason', async () => {
    renderEditor(VIEW_AS)
    expect(await screen.findByLabelText('Draft title')).toBeDisabled()
    expect(screen.getByLabelText('Post 1 text')).toHaveAttribute('readonly')
    const publish = screen.getByRole('button', { name: 'Publish' })
    expect(publish).toHaveAttribute('aria-disabled', 'true')
    expect(publish).toHaveAccessibleDescription('Not available while viewing as alice')
    for (const name of ['Add emoji', 'Add image', 'Embed tweet', 'Add post', 'Insert post here']) {
      expect(screen.getAllByRole('button', { name: new RegExp(name) })[0]).toHaveAttribute('aria-disabled', 'true')
    }
  })

  it('writes the cache as before when not viewing', async () => {
    renderEditor(null)
    await screen.findByLabelText('Draft title')
    expect(idbSet).toHaveBeenCalledWith('draft-d1', expect.objectContaining({ id: 'd1' }))
  })
})
