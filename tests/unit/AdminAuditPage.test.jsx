import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import AdminLayout from '../../src/pages/admin/AdminLayout.jsx'

// The audit page (#288) reads GET /api/admin/audit, the same rows as admin_audit_log.
const event = (id, created_at, action, extra = {}) => ({
  id, created_at, actor_login: 'shaked', action, outcome: 'done', target_github_id: '42', target_login: 'bob', details: {}, ...extra
})

const ROWS = [
  event(3, '2026-11-25T10:00:00.000Z', 'suspend_user', { details: { reason: '<img src=x onerror="alert(1)">' } }),
  event(2, '2026-11-24T09:00:00.000Z', 'delete_user', { outcome: 'started' }),
  event(1, '2026-11-23T08:00:00.000Z', 'unsuspend_user', { target_login: 'carol' })
]

// A full page of 50 rows, so the page offers "Older".
const FULL_PAGE = Array.from({ length: 50 }, (_, index) =>
  event(100 + index, new Date(Date.UTC(2026, 10, 25, 12) - index * 60000).toISOString(), 'suspend_user')
)

function answerWith(audit) {
  return vi.fn(async (url) => {
    const path = String(url)
    if (path.startsWith('/api/admin/audit')) {
      const result = await audit(path)
      if (result instanceof Error) throw result
      return { ok: true, json: async () => ({ events: result }) }
    }
    return { ok: false, status: 404, json: async () => ({}) }
  })
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/admin/audit']}>
      <Routes>
        <Route path="/admin/*" element={<AdminLayout />} />
      </Routes>
    </MemoryRouter>
  )
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  window.history.pushState({}, '', '/')
})

describe('admin audit log page', () => {
  it('shows the rows newest first, the same data as the audit route, with the action in each row', async () => {
    const fetchMock = answerWith(() => ROWS)
    vi.stubGlobal('fetch', fetchMock)
    renderPage()
    const table = await screen.findByRole('table')
    const rows = within(table).getAllByRole('row')
    expect(rows).toHaveLength(4)
    expect(rows[1]).toHaveTextContent('suspend_user')
    expect(rows[1]).toHaveTextContent('2026-11-25 10:00:00 UTC')
    expect(rows[2]).toHaveTextContent('delete_user')
    expect(rows[3]).toHaveTextContent('carol')
    const call = fetchMock.mock.calls.find(([url]) => String(url).startsWith('/api/admin/audit'))
    expect(call[0]).toBe('/api/admin/audit?limit=50')
    expect(call[1].headers['x-xt-admin']).toBe('1')
    expect(screen.getByRole('link', { name: 'Audit log' })).toHaveAttribute('aria-current', 'page')
    expect(screen.queryByRole('button', { name: 'Older' })).toBeNull()
  })

  it('the action filter hides the other rows, on the rows already loaded', async () => {
    vi.stubGlobal('fetch', answerWith(() => ROWS))
    renderPage()
    const table = await screen.findByRole('table')
    fireEvent.change(screen.getByLabelText('Action'), { target: { value: 'delete_user' } })
    const rows = within(table).getAllByRole('row')
    expect(rows).toHaveLength(2)
    expect(rows[1]).toHaveTextContent('delete_user')
    expect(screen.getByText('Filters the rows loaded on this page. No new request is sent.')).toBeInTheDocument()
  })

  it('the filter offers only the actions the server writes', async () => {
    vi.stubGlobal('fetch', answerWith(() => ROWS))
    renderPage()
    await screen.findByRole('table')
    const options = within(screen.getByLabelText('Action')).getAllByRole('option').map((option) => option.textContent)
    expect(options).toEqual(['All actions', 'suspend_user', 'unsuspend_user', 'delete_user', 'view_as_start', 'view_as_end'])
  })

  it('the filter shows the view-as rows when picked', async () => {
    const viewAs = [
      event(7, '2026-11-25T11:00:00.000Z', 'view_as_start'),
      event(6, '2026-11-25T10:30:00.000Z', 'view_as_end'),
      event(5, '2026-11-25T10:00:00.000Z', 'delete_user')
    ]
    vi.stubGlobal('fetch', answerWith(() => viewAs))
    renderPage()
    const table = await screen.findByRole('table')
    fireEvent.change(screen.getByLabelText('Action'), { target: { value: 'view_as_end' } })
    const rows = within(table).getAllByRole('row')
    expect(rows).toHaveLength(2)
    expect(rows[1]).toHaveTextContent('view_as_end')
  })

  it('a filter with no matching loaded row says so', async () => {
    vi.stubGlobal('fetch', answerWith(() => [event(5, '2026-11-25T10:00:00.000Z', 'suspend_user')]))
    renderPage()
    await screen.findByRole('table')
    fireEvent.change(screen.getByLabelText('Action'), { target: { value: 'delete_user' } })
    expect(await screen.findByText('No loaded row has this action.')).toBeInTheDocument()
  })

  it('"Older" sends the time of the last row as before, and appends the next rows', async () => {
    const fetchMock = answerWith((path) => (path.includes('before=') ? ROWS : FULL_PAGE))
    vi.stubGlobal('fetch', fetchMock)
    renderPage()
    await screen.findByRole('table')
    fireEvent.click(await screen.findByRole('button', { name: 'Older' }))
    const last = FULL_PAGE[FULL_PAGE.length - 1].created_at
    await waitFor(() => {
      const table = screen.getByRole('table')
      expect(within(table).getAllByRole('row')).toHaveLength(1 + 50 + 3)
    })
    const older = fetchMock.mock.calls.map(([url]) => String(url)).find((url) => url.includes('before='))
    expect(older).toBe(`/api/admin/audit?limit=50&before=${encodeURIComponent(last)}`)
  })

  it('a short page is the last one: no Older button', async () => {
    vi.stubGlobal('fetch', answerWith(() => ROWS))
    renderPage()
    await screen.findByRole('table')
    expect(screen.queryByRole('button', { name: 'Older' })).toBeNull()
  })

  it('shows an error when older rows do not load', async () => {
    vi.stubGlobal('fetch', answerWith((path) => (path.includes('before=') ? new Error('down') : FULL_PAGE)))
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: 'Older' }))
    expect(await screen.findByText('Could not load older rows.')).toBeInTheDocument()
  })

  it('details show as plain text, never as HTML', async () => {
    vi.stubGlobal('fetch', answerWith(() => ROWS))
    const { container } = renderPage()
    expect(await screen.findByText(/<img src=x onerror=/)).toBeInTheDocument()
    expect(container.querySelector('img')).toBeNull()
  })

  it('says so when there is no row yet', async () => {
    vi.stubGlobal('fetch', answerWith(() => []))
    renderPage()
    expect(await screen.findByText('Nothing has been recorded yet.')).toBeInTheDocument()
  })

  it('shows an error with a retry, and loads when the retry works', async () => {
    let calls = 0
    vi.stubGlobal('fetch', answerWith(() => (++calls === 1 ? new Error('down') : ROWS)))
    renderPage()
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load the audit log.')
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByRole('table')).toBeInTheDocument()
  })
})
