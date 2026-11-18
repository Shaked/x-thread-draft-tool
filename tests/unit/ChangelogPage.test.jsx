import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import ChangelogPage from '../../src/pages/ChangelogPage.jsx'
import { changelogApi } from '../../src/utils/api'

vi.mock('../../src/utils/api', () => ({ changelogApi: { list: vi.fn() }, authApi: { logout: vi.fn() } }))
vi.mock('../../src/utils/draftCache', () => ({ clearCachedDrafts: vi.fn().mockResolvedValue(undefined) }))

const entry = (id, date, title, summary) => ({ id, date, title, summary })
const FIRST = {
  entries: [
    entry('20261118-090000-newest', '2026-11-18T09:00:00Z', 'Newest change', 'Shown first.'),
    entry('20261118-080000-same-day', '2026-11-18T08:00:00Z', null, 'Same day, no title.'),
    entry('20261117-120000-older', '2026-11-17T12:00:00Z', 'Older change', 'Another day.')
  ],
  next: 'older'
}
const SECOND = {
  entries: [entry('20261116-100000-oldest', '2026-11-16T10:00:00Z', 'Oldest so far', 'Appended.')],
  next: null
}

function renderPage() {
  return render(
    <MemoryRouter>
      <ChangelogPage />
    </MemoryRouter>
  )
}

describe('ChangelogPage', () => {
  beforeEach(() => {
    changelogApi.list.mockReset()
  })
  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('groups entries by UTC day, newest first, under the running version', async () => {
    changelogApi.list.mockResolvedValue(FIRST)
    renderPage()
    expect(screen.getByRole('heading', { name: 'Changelog', level: 1 })).toBeInTheDocument()
    expect(screen.getByText(/^Version /)).toBeInTheDocument()
    await screen.findByText('Newest change')

    const days = screen.getAllByRole('region')
    expect(days).toHaveLength(2)
    expect(within(days[0]).getByText('Newest change')).toBeInTheDocument()
    expect(within(days[0]).getByText('Same day, no title.')).toBeInTheDocument()
    expect(within(days[1]).getByText('Older change')).toBeInTheDocument()
    expect(within(days[0]).queryByRole('heading', { level: 3, name: /Same day/ })).toBeNull()
    expect(changelogApi.list).toHaveBeenCalledWith()
  })

  it('shows Show older, appends the next page and moves focus to its first entry', async () => {
    const user = userEvent.setup()
    changelogApi.list.mockResolvedValueOnce(FIRST).mockResolvedValueOnce(SECOND)
    renderPage()
    await user.click(await screen.findByRole('button', { name: 'Show older' }))
    await screen.findByText('Oldest so far')
    expect(changelogApi.list).toHaveBeenLastCalledWith({ before: 'older' })
    expect(screen.getByText('Newest change')).toBeInTheDocument()
    expect(screen.getByText('Oldest so far').closest('article')).toHaveFocus()
    expect(screen.queryByRole('button', { name: 'Show older' })).toBeNull()
  })

  it('shows the error with Try again, and loads on retry', async () => {
    const user = userEvent.setup()
    changelogApi.list.mockRejectedValueOnce(new Error('down')).mockResolvedValueOnce(FIRST)
    renderPage()
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load the changelog.')
    await user.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByText('Newest change')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('keeps the list when Show older fails and offers it again', async () => {
    const user = userEvent.setup()
    changelogApi.list.mockResolvedValueOnce(FIRST).mockRejectedValueOnce(new Error('down')).mockResolvedValueOnce(SECOND)
    renderPage()
    await user.click(await screen.findByRole('button', { name: 'Show older' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load older changes.')
    expect(screen.getByText('Newest change')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Show older' }))
    expect(await screen.findByText('Oldest so far')).toBeInTheDocument()
  })

  it('says so when there are no entries', async () => {
    changelogApi.list.mockResolvedValue({ entries: [], next: null })
    renderPage()
    expect(await screen.findByText('No changes yet.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Show older' })).toBeNull()
  })

  it('shows a loading text first', async () => {
    changelogApi.list.mockReturnValue(new Promise(() => {}))
    renderPage()
    expect(screen.getByText('Loading…')).toBeInTheDocument()
    await waitFor(() => expect(changelogApi.list).toHaveBeenCalled())
  })
})
