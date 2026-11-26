import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import AdminLayout from '../../src/pages/admin/AdminLayout.jsx'
import { ToastProvider } from '../../src/ui/Toast'

// #287: suspend, unsuspend and delete on the user page. The server decides; the page asks for the typed login first.
const ID = '11111111-1111-4111-8111-111111111111'
const OLD = new Date(Date.now() - 60 * 60 * 1000).toISOString()
const BASE = {
  id: ID, login: 'ada', name: 'Ada', created_at: '2026-11-01T10:00:00.000Z', suspended_at: null, suspended_reason: null, protected: false,
  drafts: 3, api_tokens: [], connected_apps: []
}
const DRY = { dry_run: true, user: { id: ID, login: 'ada' }, will_delete: { drafts: 3, share_links: 1, api_tokens: 2, connected_apps: 1, oauth_tokens: 4, mcp_rate_rows: 5, image_files: 7 }, confirm_token: 'TOKEN-1', expires_in: 600 }

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  localStorage.clear()
  sessionStorage.clear()
})

// `answers` maps "METHOD path" to [status, body]; the user read is always answered first.
function mount(user, answers = {}) {
  const fetchMock = vi.fn(async (url, init = {}) => {
    const key = `${init.method ?? 'GET'} ${url}`
    const [status, body] = key === `GET /api/admin/users/${ID}` ? [200, { user }] : answers[key] ?? [500, { error: `unexpected ${key}` }]
    return { ok: status < 400, status, json: async () => body }
  })
  vi.stubGlobal('fetch', fetchMock)
  render(
    <ToastProvider>
      <MemoryRouter initialEntries={[`/admin/users/${ID}`]}>
        <Routes>
          <Route path="/admin/*" element={<AdminLayout />} />
        </Routes>
      </MemoryRouter>
    </ToastProvider>
  )
  return fetchMock
}
const posts = (fetchMock) => fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST')
const type = (value) => fireEvent.change(screen.getByLabelText(/Type the login/), { target: { value } })

describe('admin user actions', () => {
  it('shows no action buttons for a protected account', async () => {
    mount({ ...BASE, protected: true })
    await screen.findByText('Login')
    expect(screen.queryByRole('button', { name: /Suspend|Unsuspend|Delete/ })).toBeNull()
    expect(screen.queryByText('Actions')).toBeNull()
  })

  it('suspend: the dialog names the user id and effect, and the button enables only on the exact login', async () => {
    const fetchMock = mount(BASE, { [`POST /api/admin/users/${ID}/suspend`]: [200, { user: { ...BASE, suspended_at: OLD }, changed: true }] })
    fireEvent.click(await screen.findByRole('button', { name: 'Suspend' }))
    const dialog = screen.getByRole('dialog')
    expect(dialog).toHaveTextContent(ID)
    expect(dialog).toHaveTextContent(/cannot sign in/)
    expect(screen.getAllByRole('button', { name: 'Suspend' }).at(-1)).toHaveAttribute('aria-disabled', 'true')
    for (const wrong of ['', 'Ada', 'ad', 'ada ', 'adaa']) {
      type(wrong)
      expect(screen.getAllByRole('button', { name: 'Suspend' }).at(-1)).toHaveAttribute('aria-disabled', 'true')
      fireEvent.click(screen.getAllByRole('button', { name: 'Suspend' }).at(-1))
    }
    expect(posts(fetchMock)).toHaveLength(0)
    type('ada')
    const enabled = screen.getAllByRole('button', { name: 'Suspend' }).at(-1)
    expect(enabled).not.toHaveAttribute('aria-disabled')
    fireEvent.change(screen.getByLabelText('Reason (optional)'), { target: { value: 'spam' } })
    fireEvent.click(enabled)
    await waitFor(() => expect(posts(fetchMock)).toHaveLength(1))
    expect(JSON.parse(posts(fetchMock)[0][1].body)).toEqual({ confirm_login: 'ada', reason: 'spam' })
    expect(await screen.findByText('Suspended ada.')).toBeInTheDocument()
  })

  it('shows the server message of a refusal (409, 403, 429) inside the dialog and keeps it open', async () => {
    const path = `POST /api/admin/users/${ID}/suspend`
    for (const [status, message] of [[403, 'This account cannot be suspended.'], [429, 'Admin limit reached: at most 30 of these actions per hour.'], [409, 'A deletion of this user is running. Try again in a few minutes.']]) {
      const fetchMock = mount(BASE, { [path]: [status, { error: message }] })
      fireEvent.click(await screen.findByRole('button', { name: 'Suspend' }))
      type('ada')
      fireEvent.click(screen.getAllByRole('button', { name: 'Suspend' }).at(-1))
      expect((await screen.findAllByText(message)).length).toBeGreaterThan(0)
      expect(screen.getByRole('dialog')).toBeInTheDocument()
      expect(posts(fetchMock)).toHaveLength(1)
      cleanup()
    }
  })

  it('suspend with an old sign-in opens the sign-in pop-up, then suspends once by itself and a toast says so (#552)', async () => {
    const path = `POST /api/admin/users/${ID}/suspend`
    let calls = 0
    const fetchMock = mount(BASE, {})
    const base = fetchMock.getMockImplementation()
    fetchMock.mockImplementation(async (url, init = {}) => {
      if (`${init.method ?? 'GET'} ${url}` !== path) return base(url, init)
      calls += 1
      return calls === 1
        ? { ok: false, status: 403, json: async () => ({ error: 'Sign in again: admin changes on the web need a sign-in from the last 7 days.', code: 'sign_in_again' }) }
        : { ok: true, status: 200, json: async () => ({ user: { ...BASE, suspended_at: OLD }, changed: true }) }
    })
    const popup = { closed: false }
    vi.stubGlobal('open', vi.fn(() => popup))
    fireEvent.click(await screen.findByRole('button', { name: 'Suspend' }))
    type('ada')
    fireEvent.click(screen.getAllByRole('button', { name: 'Suspend' }).at(-1))
    fireEvent.click(await screen.findByRole('button', { name: 'Sign in with GitHub' }))
    expect(document.body.textContent).not.toMatch(/Sign in again: admin changes/)
    popup.closed = true
    expect(await screen.findByText('Suspended ada.')).toBeInTheDocument()
    expect(posts(fetchMock)).toHaveLength(2)
    expect(JSON.parse(posts(fetchMock)[1][1].body)).toEqual({ confirm_login: 'ada' })
  })

  it('unsuspend needs the exact login too', async () => {
    const fetchMock = mount({ ...BASE, suspended_at: OLD }, { [`POST /api/admin/users/${ID}/unsuspend`]: [200, { user: BASE, changed: true }] })
    fireEvent.click(await screen.findByRole('button', { name: 'Unsuspend' }))
    expect(screen.getByRole('dialog')).toHaveTextContent(ID)
    type('nope')
    fireEvent.click(screen.getAllByRole('button', { name: 'Unsuspend' }).at(-1))
    expect(posts(fetchMock)).toHaveLength(0)
    type('ada')
    fireEvent.click(screen.getAllByRole('button', { name: 'Unsuspend' }).at(-1))
    await waitFor(() => expect(posts(fetchMock)).toHaveLength(1))
    expect(JSON.parse(posts(fetchMock)[0][1].body)).toEqual({ confirm_login: 'ada' })
  })

  it('delete is not offered until 10 minutes after the suspension, and a click does nothing before that', async () => {
    const fetchMock = mount({ ...BASE, suspended_at: new Date().toISOString() })
    const button = await screen.findByRole('button', { name: 'Delete user' })
    expect(button).toHaveAttribute('aria-disabled', 'true')
    fireEvent.click(button)
    expect(posts(fetchMock)).toHaveLength(0)
  })

  it('delete becomes available when the 10 minutes end, without a reload', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'], shouldAdvanceTime: true })
    try {
      mount({ ...BASE, suspended_at: new Date(Date.now() - 9 * 60 * 1000).toISOString() })
      const button = await screen.findByRole('button', { name: 'Delete user' })
      expect(button).toHaveAttribute('aria-disabled', 'true')
      await act(async () => {
        await vi.advanceTimersByTimeAsync(61 * 1000)
      })
      expect(screen.getByRole('button', { name: 'Delete user' })).not.toHaveAttribute('aria-disabled')
    } finally {
      vi.useRealTimers()
    }
  })

  it('keeps the dialog open while a request is pending, so a refusal is always shown', async () => {
    let release
    const gate = new Promise((resolve) => { release = resolve })
    const fetchMock = vi.fn(async (url, init = {}) => {
      if ((init.method ?? 'GET') === 'GET') return { ok: true, status: 200, json: async () => ({ user: BASE }) }
      await gate
      return { ok: false, status: 429, json: async () => ({ error: 'Admin limit reached: at most 30 of these actions per hour.' }) }
    })
    vi.stubGlobal('fetch', fetchMock)
    render(
      <ToastProvider>
        <MemoryRouter initialEntries={[`/admin/users/${ID}`]}>
          <Routes><Route path="/admin/*" element={<AdminLayout />} /></Routes>
        </MemoryRouter>
      </ToastProvider>
    )
    fireEvent.click(await screen.findByRole('button', { name: 'Suspend' }))
    type('ada')
    fireEvent.click(screen.getAllByRole('button', { name: 'Suspend' }).at(-1))
    const cancel = await screen.findByRole('button', { name: 'Cancel' })
    expect(cancel).toBeDisabled()
    fireEvent.click(cancel)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    release()
    expect(await screen.findByText('Admin limit reached: at most 30 of these actions per hour.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Cancel' })).not.toBeDisabled()
  })

  it('delete is two steps: the dry run shows the counts, and only the typed login sends the real call with the token', async () => {
    const path = `POST /api/admin/users/${ID}/delete`
    const fetchMock = mount({ ...BASE, suspended_at: OLD }, { [path]: [200, DRY] })
    fireEvent.click(await screen.findByRole('button', { name: 'Delete user' }))
    const dialog = await screen.findByRole('dialog')
    // Step 1 sent only the dry run. Nothing is deleted yet.
    expect(posts(fetchMock)).toHaveLength(1)
    expect(JSON.parse(posts(fetchMock)[0][1].body)).toEqual({ dry_run: true })
    expect(dialog).toHaveTextContent(ID)
    expect(dialog).toHaveTextContent(/cannot be undone/)
    expect(dialog).toHaveTextContent(/expires at/)
    for (const count of ['Drafts', 'Share links', 'API tokens', 'Connected apps', 'Image files']) expect(dialog).toHaveTextContent(count)
    // Without the typed login, no real call goes out.
    fireEvent.click(screen.getAllByRole('button', { name: 'Delete for good' }).at(-1))
    type('ad')
    fireEvent.click(screen.getAllByRole('button', { name: 'Delete for good' }).at(-1))
    expect(posts(fetchMock)).toHaveLength(1)
    // Cancel sends nothing either.
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(posts(fetchMock)).toHaveLength(1)
    // Second time: dry run again, then the real call.
    fireEvent.click(await screen.findByRole('button', { name: 'Delete user' }))
    await screen.findByRole('dialog')
    type('ada')
    fireEvent.click(screen.getAllByRole('button', { name: 'Delete for good' }).at(-1))
    await waitFor(() => expect(posts(fetchMock)).toHaveLength(3))
    expect(JSON.parse(posts(fetchMock)[2][1].body)).toEqual({ dry_run: false, confirm_token: 'TOKEN-1', confirm_login: 'ada' })
    // The token is never stored.
    expect(JSON.stringify({ ...localStorage })).not.toContain('TOKEN-1')
    expect(JSON.stringify({ ...sessionStorage })).not.toContain('TOKEN-1')
  })

  it('shows a 409 from the dry run on the page, with no dialog', async () => {
    const message = 'Wait until 2026-11-26T12:10:00.000Z: a user must be suspended for 10 minutes before deletion.'
    mount({ ...BASE, suspended_at: OLD }, { [`POST /api/admin/users/${ID}/delete`]: [409, { error: message }] })
    fireEvent.click(await screen.findByRole('button', { name: 'Delete user' }))
    expect(await screen.findByText(message)).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('shows a 409 "content changed" from the real delete in the dialog', async () => {
    const message = 'The content changed. Run the dry run again.'
    const fetchMock = vi.fn(async (url, init = {}) => {
      const key = `${init.method ?? 'GET'} ${url}`
      if (key === `GET /api/admin/users/${ID}`) return { ok: true, status: 200, json: async () => ({ user: { ...BASE, suspended_at: OLD } }) }
      const dry = JSON.parse(init.body).dry_run
      return { ok: dry, status: dry ? 200 : 409, json: async () => (dry ? DRY : { error: message }) }
    })
    vi.stubGlobal('fetch', fetchMock)
    render(
      <ToastProvider>
        <MemoryRouter initialEntries={[`/admin/users/${ID}`]}>
          <Routes><Route path="/admin/*" element={<AdminLayout />} /></Routes>
        </MemoryRouter>
      </ToastProvider>
    )
    fireEvent.click(await screen.findByRole('button', { name: 'Delete user' }))
    await screen.findByRole('dialog')
    type('ada')
    fireEvent.click(screen.getAllByRole('button', { name: 'Delete for good' }).at(-1))
    expect(await screen.findByText(message)).toBeInTheDocument()
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })
})
