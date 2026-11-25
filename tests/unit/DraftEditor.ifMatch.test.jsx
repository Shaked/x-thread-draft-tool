import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import DraftEditor from '../../src/pages/DraftEditor.jsx'
import { draftsApi } from '../../src/utils/api'
import { ToastProvider } from '../../src/ui/Toast.jsx'
import { ConfirmProvider } from '../../src/ui/Dialog.jsx'

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

const DRAFT = { id: 'd1', title: 'Draft one', version: 3, posts: [{ id: 'p1', text: 'hello', images: [] }] }

function httpError(status, message, extra = {}) {
  return Object.assign(new Error(message), { status, ...extra })
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

// Runs the editor's 1 s save debounce on a fake clock.
async function runSaveDebounce() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1000)
  })
}

async function typeInTitle(text) {
  const title = await screen.findByLabelText('Draft title')
  await typer().type(title, text)
  await runSaveDebounce()
  return title
}

// userEvent with fake timers: its keystroke delays advance the fake clock, not the real one.
const typer = () => userEvent.setup({ advanceTimers: vi.advanceTimersByTime, delay: null })

function unload() {
  window.dispatchEvent(new Event('beforeunload'))
}

describe('DraftEditor save with a version (If-Match)', () => {
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

  it('makes zero saves for a draft the user did not touch, including on page unload', async () => {
    renderEditor()
    await screen.findByLabelText('Draft title')
    await runSaveDebounce()
    unload()
    await runSaveDebounce()

    expect(draftsApi.update).not.toHaveBeenCalled()
  })

  it('sends the version it loaded as If-Match, then the version the save returned', async () => {
    draftsApi.update.mockResolvedValueOnce({ ...DRAFT, version: 4 }).mockResolvedValueOnce({ ...DRAFT, version: 5 })
    renderEditor()
    await typeInTitle('!')

    expect(draftsApi.update).toHaveBeenCalledTimes(1)
    expect(draftsApi.update.mock.calls[0][2]).toBe(3)

    await typeInTitle('?')
    expect(draftsApi.update).toHaveBeenCalledTimes(2)
    expect(draftsApi.update.mock.calls[1][2]).toBe(4)
  })

  it('saves on unload only when there are unsaved edits, and keeps the request alive', async () => {
    draftsApi.update.mockResolvedValue({ ...DRAFT, version: 4 })
    renderEditor()
    const title = await screen.findByLabelText('Draft title')
    await typer().type(title, '!')
    unload()

    await waitFor(() => expect(draftsApi.update).toHaveBeenCalledTimes(1))
    expect(draftsApi.update.mock.calls[0][3]).toEqual({ keepalive: true })
  })

  it('on 412 shows the banner and stops saving until the user chooses', async () => {
    draftsApi.update.mockRejectedValue(
      httpError(412, 'stale', { version: 5, draft: { ...DRAFT, title: 'Theirs', version: 5 } })
    )
    renderEditor()
    await typeInTitle('!')

    expect(await screen.findByRole('alert')).toHaveTextContent('This draft changed in another app while you were editing.')
    const callsAfterConflict = draftsApi.update.mock.calls.length
    await typeInTitle('?')
    unload()
    expect(draftsApi.update).toHaveBeenCalledTimes(callsAfterConflict)
  })

  it('"Show their changes" adopts the other app\'s draft and keeps my text to copy', async () => {
    draftsApi.update.mockRejectedValue(
      httpError(412, 'stale', { version: 5, draft: { ...DRAFT, title: 'Theirs', version: 5 } })
    )
    renderEditor()
    await typeInTitle('!')
    await screen.findByRole('alert')

    await typer().click(screen.getByRole('button', { name: 'Show their changes' }))

    expect(await screen.findByLabelText('Draft title')).toHaveValue('Theirs')
    expect(screen.getByLabelText('Your text')).toHaveValue('Draft one!\n\nhello')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('"Keep mine" saves my text with the other app\'s version as If-Match', async () => {
    draftsApi.update
      .mockRejectedValueOnce(httpError(412, 'stale', { version: 5, draft: { ...DRAFT, title: 'Theirs', version: 5 } }))
      .mockResolvedValueOnce({ ...DRAFT, version: 6 })
    renderEditor()
    await typeInTitle('!')
    await screen.findByRole('alert')

    await typer().click(screen.getByRole('button', { name: 'Keep mine' }))

    await waitFor(() => expect(draftsApi.update).toHaveBeenCalledTimes(2))
    expect(draftsApi.update.mock.calls[1][1].title).toBe('Draft one!')
    expect(draftsApi.update.mock.calls[1][2]).toBe(5)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('saves one at a time: the next save waits for a slow save and sends its new version', async () => {
    let finishFirst
    draftsApi.update
      .mockImplementationOnce(() => new Promise(resolve => (finishFirst = resolve)))
      .mockResolvedValueOnce({ ...DRAFT, version: 5 })
    renderEditor()
    const title = await screen.findByLabelText('Draft title')
    await typer().type(title, '!')
    await runSaveDebounce()
    await typer().type(title, '?')
    await runSaveDebounce()

    expect(draftsApi.update).toHaveBeenCalledTimes(1)
    await act(async () => finishFirst({ ...DRAFT, version: 4 }))
    await waitFor(() => expect(draftsApi.update).toHaveBeenCalledTimes(2))
    expect(draftsApi.update.mock.calls[1][2]).toBe(4)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('asks before the page closes while a save is in flight and an edit is not stored yet', async () => {
    let finishFirst
    draftsApi.update.mockImplementationOnce(() => new Promise(resolve => (finishFirst = resolve)))
    renderEditor()
    const title = await screen.findByLabelText('Draft title')
    await typer().type(title, '!')
    await runSaveDebounce()
    await typer().type(title, '?')

    const event = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(true)
    await act(async () => finishFirst({ ...DRAFT, version: 4 }))
  })

  it('asks before the page closes when there are unsaved edits, even with no save in flight', async () => {
    draftsApi.update.mockResolvedValue({ ...DRAFT, version: 4 })
    renderEditor()
    const title = await screen.findByLabelText('Draft title')
    await typer().type(title, '!')

    const event = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(true)
  })

  it('asks before Back leaves the editor while a conflict waits for the choice', async () => {
    draftsApi.update.mockRejectedValue(
      httpError(412, 'stale', { version: 5, draft: { ...DRAFT, title: 'Theirs', version: 5 } })
    )
    renderEditor()
    await typeInTitle('!')
    await screen.findByRole('alert')

    await userEvent.click(screen.getByRole('link', { name: '← Back' }))

    expect(await screen.findByText('Leave this draft?')).toBeInTheDocument()
    expect(screen.getByLabelText('Draft title')).toHaveValue('Draft one!')
  })

  it('asks before the page closes while a conflict waits for the choice', async () => {
    draftsApi.update.mockRejectedValue(
      httpError(412, 'stale', { version: 5, draft: { ...DRAFT, title: 'Theirs', version: 5 } })
    )
    renderEditor()
    await typeInTitle('!')
    await screen.findByRole('alert')

    const event = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(true)
  })
})
