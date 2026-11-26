import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import AdminLayout from '../../src/pages/admin/AdminLayout.jsx'
import App from '../../src/App.jsx'

const STATS = {
  users: 12, users_suspended: 1, drafts: 40, published_drafts: 9, posts: 130, images: 7, api_tokens_active: 3, connected_apps: 2,
  share_links_active: 4, mcp_calls_24h: 210, mcp_calls_7d: 1500, active_users_24h: 5, active_users_7d: 9,
  signups_by_day: [{ day: '2026-11-24', signups: 2 }, { day: '2026-11-25', signups: 0 }]
}

function answer(me) {
  return vi.fn(async (url) => {
    const path = String(url)
    if (path === '/api/auth/me') return { ok: true, json: async () => me }
    if (path === '/api/admin/stats') return { ok: true, json: async () => ({ stats: STATS }) }
    return { ok: false, status: 404, json: async () => ({}) }
  })
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  window.history.pushState({}, '', '/')
})

describe('admin shell', () => {
  it('shows the statistics, with the admin header, and the menu with its coming-soon entries', async () => {
    const fetchMock = answer({})
    vi.stubGlobal('fetch', fetchMock)
    render(
      <MemoryRouter initialEntries={['/admin']}>
        <Routes>
          <Route path="/admin/*" element={<AdminLayout />} />
        </Routes>
      </MemoryRouter>
    )
    expect(await screen.findByText('Active users, 24 hours')).toBeInTheDocument()
    const call = fetchMock.mock.calls.find(([url]) => url === '/api/admin/stats')
    expect(call[1].headers['x-xt-admin']).toBe('1')
    const table = screen.getByRole('table')
    expect(within(table).getAllByRole('row')).toHaveLength(3)
    expect(screen.getByRole('link', { name: 'Statistics' })).toHaveAttribute('aria-current', 'page')
    for (const name of ['Metrics', 'Feature flags', 'Changelog', 'Users', 'Audit log']) {
      expect(screen.getByRole('link', { name })).toBeInTheDocument()
    }
  })

  it('the Changelog entry opens the changelog inside the admin shell (#484)', async () => {
    const user = userEvent.setup()
    vi.stubGlobal('fetch', vi.fn(async (url) => {
      const path = String(url)
      if (path === '/api/auth/me') return { ok: true, json: async () => ({}) }
      if (path === '/api/admin/stats') return { ok: true, json: async () => ({ stats: STATS }) }
      if (path.startsWith('/api/changelog?')) {
        return { ok: true, json: async () => ({ entries: [{ id: '20261125-100000-shell', date: '2026-11-25T10:00:00Z', title: 'Shell change', summary: 'Shown in the admin shell.', area: 'Admin' }], next: null }) }
      }
      return { ok: false, status: 404, json: async () => ({}) }
    }))
    render(
      <MemoryRouter initialEntries={['/admin']}>
        <Routes>
          <Route path="/admin/*" element={<AdminLayout />} />
        </Routes>
      </MemoryRouter>
    )
    await user.click(await screen.findByRole('link', { name: 'Changelog' }))
    expect(await screen.findByText('Shown in the admin shell.')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Changelog', level: 2 })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Changelog' })).toHaveAttribute('aria-current', 'page')
  })

  it('shows Coming soon for a page that is not built yet', async () => {
    vi.stubGlobal('fetch', answer({}))
    render(
      <MemoryRouter initialEntries={['/admin/audit']}>
        <Routes>
          <Route path="/admin/*" element={<AdminLayout />} />
        </Routes>
      </MemoryRouter>
    )
    expect(await screen.findByText('Coming soon.')).toBeInTheDocument()
  })

  it('shows an error with a retry when the numbers do not load', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 404, json: async () => ({}) })))
    render(
      <MemoryRouter initialEntries={['/admin']}>
        <Routes>
          <Route path="/admin/*" element={<AdminLayout />} />
        </Routes>
      </MemoryRouter>
    )
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load the statistics.')
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument()
  })
})

describe('admin route in the app', () => {
  it('sends a normal user from /admin to / and shows no admin text', async () => {
    window.history.pushState({}, '', '/admin')
    vi.stubGlobal('fetch', answer({ user: { login: 'bob', role: 'user' } }))
    render(<App />)
    await waitFor(() => expect(window.location.pathname).toBe('/'))
    expect(document.body.textContent).not.toMatch(/Statistics|Audit log|Admin/)
  })

  it('sends a signed-out visitor from /admin to /', async () => {
    window.history.pushState({}, '', '/admin/users')
    vi.stubGlobal('fetch', answer({ user: null }))
    render(<App />)
    await waitFor(() => expect(window.location.pathname).toBe('/'))
  })

  it('opens the admin area for the admin', async () => {
    window.history.pushState({}, '', '/admin')
    vi.stubGlobal('fetch', answer({ user: { login: 'shaked', role: 'admin', admin: true } }))
    render(<App />)
    expect(await screen.findByText('Active users, 24 hours')).toBeInTheDocument()
  })
})
