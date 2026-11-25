import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import DraftEditor from '../../src/pages/DraftEditor.jsx'
import { draftsApi } from '../../src/utils/api'
import { clear as idbClear } from 'idb-keyval'
import { ToastProvider } from '../../src/ui/Toast.jsx'
import { ConfirmProvider } from '../../src/ui/Dialog.jsx'

// Live updates (#363): the open editor asks the server for newer versions, with the rate, pause and stop rules.
vi.mock('../../src/utils/api', () => ({
  draftsApi: { get: vi.fn(), update: vi.fn(), check: vi.fn() },
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
vi.mock('../../src/components/ThreadComposer', () => ({ default: () => null }))
vi.mock('../../src/components/AgentLinkButton', () => ({ default: () => null }))
vi.mock('../../src/components/XThreadLinkButton', () => ({ default: () => null }))
vi.mock('../../src/components/ShareLinkButton', () => ({ default: () => null }))
vi.mock('../../src/components/ExportOptions', () => ({ default: () => null }))

const DRAFT = { id: 'd1', title: 'Draft one', version: 3, posts: [{ id: 'p1', text: 'hello', images: [] }] }
const UNCHANGED = { changed: false }

function setVisibility(state) {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state })
  document.dispatchEvent(new Event('visibilitychange'))
}

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

async function advance(ms) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms)
  })
}

const typer = () => userEvent.setup({ advanceTimers: vi.advanceTimersByTime, delay: null })

describe('DraftEditor live updates (#363)', () => {
  beforeEach(async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    await idbClear()
    setVisibility('visible')
    draftsApi.get.mockResolvedValue(structuredClone(DRAFT))
    draftsApi.check.mockResolvedValue(UNCHANGED)
    draftsApi.update.mockImplementation(async (_id, patch) => ({ ...DRAFT, ...patch, version: 4 }))
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    cleanup()
    setVisibility('visible')
    vi.useRealTimers()
    vi.clearAllMocks()
    vi.restoreAllMocks()
  })

  it('checks every 4 s with the version it holds, as If-None-Match', async () => {
    renderEditor()
    await screen.findByLabelText('Draft title')

    await advance(4000)
    expect(draftsApi.check).toHaveBeenCalledTimes(1)
    expect(draftsApi.check).toHaveBeenLastCalledWith('d1', 3)

    await advance(4000)
    expect(draftsApi.check).toHaveBeenCalledTimes(2)
  })

  it('stops while the page is hidden and checks at once when it is visible again', async () => {
    renderEditor()
    await screen.findByLabelText('Draft title')

    setVisibility('hidden')
    await advance(20000)
    expect(draftsApi.check).not.toHaveBeenCalled()

    setVisibility('visible')
    await advance(0)
    expect(draftsApi.check).toHaveBeenCalledTimes(1)
  })

  it('shows a newer version without a reload and checks again from that version', async () => {
    draftsApi.check.mockResolvedValueOnce({
      changed: true,
      draft: { ...DRAFT, version: 4, title: 'Changed by an AI app', posts: [{ id: 'p1', text: 'changed', images: [] }] }
    })
    renderEditor()
    const title = await screen.findByLabelText('Draft title')

    await advance(4000)
    expect(title).toHaveValue('Changed by an AI app')
    expect(screen.getByText('Updated just now')).toBeInTheDocument()

    await advance(4000)
    expect(draftsApi.check).toHaveBeenLastCalledWith('d1', 4)
  })

  it('does not check while a save is in flight', async () => {
    draftsApi.update.mockImplementation(() => new Promise(() => {}))
    renderEditor()
    const title = await screen.findByLabelText('Draft title')

    await typer().type(title, '!')
    await advance(1000) // the 1 s debounce starts a save that never ends
    draftsApi.check.mockClear()
    await advance(12000)
    expect(draftsApi.check).not.toHaveBeenCalled()
  })

  it('does not check while there are unsaved edits', async () => {
    draftsApi.update.mockRejectedValue(Object.assign(new Error('server down'), { status: 500 }))
    renderEditor()
    const title = await screen.findByLabelText('Draft title')

    await typer().type(title, '!')
    await advance(1000)
    draftsApi.check.mockClear()
    await advance(12000)
    expect(draftsApi.check).not.toHaveBeenCalled()
  })

  it('checks every 15 s after two minutes with no change and no input', async () => {
    renderEditor()
    await screen.findByLabelText('Draft title')

    await advance(2 * 60 * 1000 + 1000)
    draftsApi.check.mockClear()
    await advance(60000)
    expect(draftsApi.check.mock.calls.length).toBeGreaterThanOrEqual(3)
    expect(draftsApi.check.mock.calls.length).toBeLessThanOrEqual(5)
  })

  it('pauses after ten minutes, and Resume (or any input) starts checks again', async () => {
    renderEditor()
    await screen.findByLabelText('Draft title')

    await advance(10 * 60 * 1000 + 5000)
    expect(screen.getByText('Live updates paused')).toBeInTheDocument()
    draftsApi.check.mockClear()
    await advance(60000)
    expect(draftsApi.check).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Resume' }))
    await advance(4000)
    expect(draftsApi.check).toHaveBeenCalledTimes(1)
    expect(screen.queryByText('Live updates paused')).not.toBeInTheDocument()
  })
})
