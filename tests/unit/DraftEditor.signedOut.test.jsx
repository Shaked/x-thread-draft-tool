import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import DraftEditor from '../../src/pages/DraftEditor.jsx'
import { draftsApi } from '../../src/utils/api'
import { set as idbSet } from 'idb-keyval'

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

const DRAFT = { id: 'd1', title: 'Draft one', posts: [{ id: 'p1', text: 'hello', images: [] }] }

function httpError(status, message) {
  return Object.assign(new Error(message), { status })
}

function renderEditor() {
  return render(
    <MemoryRouter initialEntries={['/draft/d1']}>
      <Routes>
        <Route path="/draft/:id" element={<DraftEditor user={{ login: 'owner' }} />} />
      </Routes>
    </MemoryRouter>
  )
}

// Runs the editor's 1 s save debounce on a fake clock instead of waiting for it.
async function runSaveDebounce() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1000)
  })
}

// Types one character into the title, which starts the debounced save (1 s), and lets it fire.
async function editTitle() {
  const title = await screen.findByLabelText('Draft title')
  await userEvent.type(title, '!')
  await runSaveDebounce()
  return title
}

describe('DraftEditor when the session has ended', () => {
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

  it('says so instead of "Saving…", keeps the typed text, and does not cache it', async () => {
    draftsApi.update.mockRejectedValue(httpError(401, 'Unauthorized'))
    renderEditor()
    const title = await editTitle()

    expect(await screen.findByRole('alert', {}, { timeout: 3000 })).toHaveTextContent(
      'You are signed out. Your text is still here: copy it, then sign in again.'
    )
    expect(screen.getByRole('button', { name: 'Sign in with GitHub' })).toBeVisible()
    expect(screen.getByRole('status')).toHaveTextContent('Not saved')
    expect(title).toHaveValue('Draft one!')
    // The signed-out copy is never written to the browser cache.
    expect(idbSet).not.toHaveBeenCalledWith('draft-d1', expect.objectContaining({ title: 'Draft one!' }))
  })

  it('hides the note once a later save succeeds', async () => {
    draftsApi.update.mockRejectedValueOnce(httpError(401, 'Unauthorized')).mockResolvedValue({})
    renderEditor()
    await editTitle()
    await screen.findByRole('alert', {}, { timeout: 3000 })

    await userEvent.type(screen.getByLabelText('Draft title'), '?')
    await runSaveDebounce()

    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument(), { timeout: 3000 })
    expect(screen.getByRole('status')).toHaveTextContent('Saved')
  })

  it('leaves other save errors on the existing path', async () => {
    draftsApi.update.mockRejectedValue(httpError(500, 'Server error'))
    renderEditor()
    await editTitle()

    await waitFor(() => expect(draftsApi.update).toHaveBeenCalled(), { timeout: 3000 })
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('Saving…')
    expect(idbSet).toHaveBeenCalledWith('draft-d1', expect.objectContaining({ title: 'Draft one!' }))
  })
})
