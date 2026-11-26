import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import AdminLayout from '../../src/pages/admin/AdminLayout.jsx'
import App from '../../src/App.jsx'

const group = (route, op, count, p95) => ({
  group: { route, op, caller: 'all' },
  count,
  errors: { '4xx': 3, '429': 1, '5xx': 2, tool_error: 0 },
  p50: 8.4, p90: 15.9, p95, p99: null, p99_9: null
})

const series = (name, values, grain = 'hour', p95 = []) => ({
  name,
  grain,
  points: values.map((value, i) => ({ at: `2026-11-2${i}T10:00:00Z`, value, p95: p95[i] ?? null }))
})

function answer(me = {}) {
  return vi.fn(async (url) => {
    const path = String(url)
    if (path === '/api/auth/me') return { ok: true, json: async () => me }
    if (path.startsWith('/api/admin/metrics/series')) {
      const name = new URL(path, 'http://x').searchParams.get('name')
      if (name === 'requests') return { ok: true, json: async () => series('requests', [5, 9, 3], 'hour', [20, null, 30]) }
      return { ok: true, json: async () => series(name, [1, null, 4], 'day') }
    }
    if (path.startsWith('/api/admin/metrics')) {
      const by = new URL(path, 'http://x').searchParams.get('by')
      const metrics =
        by === 'total' ? [group('all', '-', 100, 22.4)]
        : by === 'route' ? [group('GET /drafts', '-', 60, 22.4), group('GET /me', '-', 40, null)]
        : [group('all', 'tool:list_drafts', 7, 12), group('all', 'tools/list', 2, 3)]
      return { ok: true, json: async () => ({ metrics }) }
    }
    return { ok: false, status: 404, json: async () => ({}) }
  })
}

const open = () =>
  render(
    <MemoryRouter initialEntries={['/admin/metrics']}>
      <Routes>
        <Route path="/admin/*" element={<AdminLayout />} />
      </Routes>
    </MemoryRouter>
  )

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  window.history.pushState({}, '', '/')
})

describe('admin metrics page', () => {
  it('shows the summary, both tables and the product table, with – and the samples text for a null percentile', async () => {
    const fetchMock = answer()
    vi.stubGlobal('fetch', fetchMock)
    open()
    expect(await screen.findByText('5xx share')).toBeInTheDocument()
    expect(screen.getByText('2%')).toBeInTheDocument()
    const routes = screen.getByRole('table', { name: 'Requests and times by route' })
    expect(within(routes).getAllByRole('row')).toHaveLength(3)
    expect(within(routes).getAllByText('– (needs 200 samples)')).toHaveLength(1)
    expect(within(routes).getAllByText('– (needs 1000 samples)').length).toBe(2)
    const tools = screen.getByRole('table', { name: 'Requests and times by tool' })
    expect(within(tools).getAllByRole('row')).toHaveLength(2)
    expect(within(tools).getByText('list_drafts')).toBeInTheDocument()
    const product = screen.getByRole('table', { name: /Product numbers/ })
    expect(within(product).getAllByRole('row')).toHaveLength(4)
    expect(fetchMock.mock.calls.find(([url]) => String(url).includes('/admin/metrics?'))[1].headers['x-xt-admin']).toBe('1')
    expect(screen.getByRole('link', { name: 'Metrics' })).toHaveAttribute('aria-current', 'page')
  })

  it('draws one point for each series entry', async () => {
    vi.stubGlobal('fetch', answer())
    open()
    const chart = await screen.findByRole('img', { name: /Requests and p95 per hour, 3 points/ })
    expect(chart.querySelectorAll('circle')).toHaveLength(5) // 3 requests + 2 p95 (the null is a gap)
  })

  it('loads the new window when the switch changes', async () => {
    const fetchMock = answer()
    vi.stubGlobal('fetch', fetchMock)
    open()
    await screen.findByText('5xx share')
    fireEvent.click(screen.getByRole('radio', { name: '7 days' }))
    expect(screen.getByRole('radio', { name: '7 days' })).toBeChecked() // the switch stays while the new window loads
    await waitFor(() => expect(fetchMock.mock.calls.some(([url]) => String(url) === '/api/admin/metrics?window=7d&by=total')).toBe(true))
  })

  it('shows an error with a retry when the numbers do not load', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 404, json: async () => ({}) })))
    open()
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load the metrics.')
  })

  it('sends a normal user from /admin/metrics to /', async () => {
    window.history.pushState({}, '', '/admin/metrics')
    vi.stubGlobal('fetch', answer({ user: { login: 'bob', role: 'user' } }))
    render(<App />)
    await waitFor(() => expect(window.location.pathname).toBe('/'))
    expect(document.body.textContent).not.toMatch(/5xx share/)
  })
})
