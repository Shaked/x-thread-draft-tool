import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import AdminLayout from '../../src/pages/admin/AdminLayout.jsx'

const ID = '11111111-1111-4111-8111-111111111111'
const user = (over = {}) => ({
  id: ID, login: 'ada', name: '<b>Ada</b>', created_at: '2026-11-01T10:00:00.000Z', last_active_at: null, suspended_at: null,
  drafts: 3, posts: 9, api_tokens_active: 1, connected_apps: 2, mcp_calls_7d: 20, ...over
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

function mount(path, answer) {
  const fetchMock = vi.fn(async (url) => answer(String(url)))
  vi.stubGlobal('fetch', fetchMock)
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/admin/*" element={<AdminLayout />} />
      </Routes>
    </MemoryRouter>
  )
  return fetchMock
}
const ok = (body) => ({ ok: true, json: async () => body })

describe('admin users list', () => {
  it('shows users as text, with the status, and pages with the cursor', async () => {
    const fetchMock = mount('/admin/users', (url) =>
      url.includes('cursor=NEXT')
        ? ok({ users: [user({ id: '22222222-2222-4222-8222-222222222222', login: 'bob', suspended_at: '2026-11-02T00:00:00Z', name: null })], next_cursor: null })
        : ok({ users: [user()], next_cursor: 'NEXT' })
    )
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(await screen.findByText('<b>Ada</b>')).toBeInTheDocument()
    expect(document.querySelector('td b')).toBeNull()
    expect(screen.getByRole('link', { name: 'ada' })).toHaveAttribute('href', `/admin/users/${ID}`)
    await userEvent.click(screen.getByRole('button', { name: 'Load more' }))
    expect(await screen.findByRole('link', { name: 'bob' })).toBeInTheDocument()
    expect(within(screen.getByRole('table')).getByText('Suspended')).toBeInTheDocument()
    expect(fetchMock.mock.calls.some(([url, init]) => url === '/api/admin/users?cursor=NEXT' && init.headers['x-xt-admin'] === '1')).toBe(true)
    expect(screen.queryByRole('button', { name: 'Load more' })).toBeNull()
    expect(errors.mock.calls.flat().join(' ')).not.toMatch(/same key/)
    errors.mockRestore()
  })

  it('validates the search and sends the prefix and the status', async () => {
    const fetchMock = mount('/admin/users', () => ok({ users: [], next_cursor: null }))
    await screen.findByText('No users match.')
    await userEvent.type(screen.getByLabelText('Login starts with'), 'a_b')
    expect(screen.getByText('Use 1 to 39 letters, digits or hyphens.')).toBeInTheDocument()
    await userEvent.clear(screen.getByLabelText('Login starts with'))
    await userEvent.type(screen.getByLabelText('Login starts with'), 'ad')
    await userEvent.selectOptions(screen.getByLabelText('Status'), 'suspended')
    await userEvent.click(screen.getByRole('button', { name: 'Search' }))
    await waitFor(() => expect(fetchMock.mock.calls.some(([url]) => url === '/api/admin/users?q=ad&status=suspended')).toBe(true))
  })
})
