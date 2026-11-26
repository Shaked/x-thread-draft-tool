import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import App from '../../src/App.jsx'
import AdminLayout from '../../src/pages/admin/AdminLayout.jsx'
import { ToastProvider } from '../../src/ui/Toast'
import { allowFlags, KIT_KEY, SKIN_KEY } from '../../src/utils/skin.js'

const flag = (name, value) => ({ name, value, values: ['rare', 'default'], default: 'rare', meaning: '' })

// A fake of GET and POST /api/admin/flags that keeps the two values.
function flagsApi({ failPost = false, staleFirstPost = false, staleAlways = false } = {}) {
  let stale = staleFirstPost || staleAlways
  const state = { look: 'rare', components: 'rare' }
  const view = () => ({ flags: [flag('look', state.look), flag('components', state.components)] })
  return vi.fn(async (url, init = {}) => {
    if (String(url) !== '/api/admin/flags') return { ok: false, status: 404, json: async () => ({}) }
    if (init.method === 'POST') {
      if (stale) {
        stale = staleAlways
        return { ok: false, status: 403, json: async () => ({ error: 'Sign in again: admin changes on the web need a sign-in from the last 7 days.', code: 'sign_in_again' }) }
      }
      if (failPost) return { ok: false, status: 500, json: async () => ({ error: 'no' }) }
      const body = JSON.parse(init.body)
      state[body.name] = body.value
    }
    return { ok: true, json: async () => view() }
  })
}

function renderPage() {
  render(
    <ToastProvider>
      <MemoryRouter initialEntries={['/admin/flags']}>
        <Routes>
          <Route path="/admin/*" element={<AdminLayout />} />
        </Routes>
      </MemoryRouter>
    </ToastProvider>
  )
}

describe('admin feature flags page', () => {
  beforeEach(() => {
    localStorage.clear()
    allowFlags(true)
    delete document.documentElement.dataset.skin
  })
  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
    localStorage.clear()
  })

  it('shows Rare UI as the chosen look and components by default, for the admin too', async () => {
    vi.stubGlobal('fetch', flagsApi())
    renderPage()
    expect((await screen.findByRole('radio', { name: 'Rare UI (everyone)' })).checked).toBe(true)
    expect(screen.getByRole('radio', { name: 'Rare UI components (everyone)' }).checked).toBe(true)
  })

  it('saves the old purple look on the account for this admin, copies it to this device and applies it', async () => {
    const fetchMock = flagsApi()
    vi.stubGlobal('fetch', fetchMock)
    const user = userEvent.setup()
    renderPage()
    await user.click(await screen.findByRole('radio', { name: 'Old look, purple (only you)' }))
    await waitFor(() => expect(document.documentElement.dataset.skin).toBe('default'))
    const post = fetchMock.mock.calls.find(([, init]) => init?.method === 'POST')
    expect(JSON.parse(post[1].body)).toEqual({ name: 'look', value: 'default' })
    expect(post[1].headers['x-xt-admin']).toBe('1')
    expect(localStorage.getItem(SKIN_KEY)).toBe('default')
    expect(screen.getByRole('radio', { name: 'Old look, purple (only you)' }).checked).toBe(true)
  })

  it('saves the old components for this admin apart from the look', async () => {
    vi.stubGlobal('fetch', flagsApi())
    const user = userEvent.setup()
    renderPage()
    await user.click(await screen.findByRole('radio', { name: 'Old components (only you)' }))
    await waitFor(() => expect(localStorage.getItem(KIT_KEY)).toBe('default'))
    expect(document.documentElement.dataset.skin).toBe('rare')
    expect(screen.getByRole('link', { name: 'Rare UI' })).toHaveAttribute('href', 'https://rareui.com')
  })

  it('an old sign-in opens the sign-in pop-up; signing in saves the flag once by itself and a toast says saved (#552)', async () => {
    const fetchMock = flagsApi({ staleFirstPost: true })
    vi.stubGlobal('fetch', fetchMock)
    const popup = { closed: false }
    const open = vi.fn(() => popup)
    vi.stubGlobal('open', open)
    const user = userEvent.setup()
    renderPage()
    await user.click(await screen.findByRole('radio', { name: 'Old look, purple (only you)' }))
    const dialog = await screen.findByRole('dialog', { name: 'Sign in again to save' })
    expect(document.body.textContent).not.toMatch(/Could not save the flag|Nothing changed/)
    await user.click(screen.getByRole('button', { name: 'Sign in with GitHub' }))
    expect(open).toHaveBeenCalledWith('/api/auth/login?popup=1', 'xt-signin', expect.any(String))
    popup.closed = true
    expect(await screen.findByText('Flag saved.')).toBeInTheDocument()
    expect(dialog).not.toBeInTheDocument()
    const posts = fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST')
    expect(posts).toHaveLength(2)
    expect(JSON.parse(posts[1][1].body)).toEqual({ name: 'look', value: 'default' })
    expect(localStorage.getItem(SKIN_KEY)).toBe('default')
    expect(document.body.textContent).not.toMatch(/Sign in again: admin changes/)
  })

  it('cancelling the sign-in pop-up saves nothing and shows a plain message, not the server text', async () => {
    const fetchMock = flagsApi({ staleFirstPost: true })
    vi.stubGlobal('fetch', fetchMock)
    const user = userEvent.setup()
    renderPage()
    await user.click(await screen.findByRole('radio', { name: 'Old look, purple (only you)' }))
    await user.click(await screen.findByRole('button', { name: 'Cancel' }))
    expect(await screen.findByText(/You did not sign in, so nothing changed/)).toBeInTheDocument()
    expect(document.body.textContent).not.toMatch(/last 7 days/)
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1)
    expect(localStorage.getItem(SKIN_KEY)).not.toBe('default')
  })

  it('closing the pop-up without signing in (the repeat is refused again) shows a plain message, never the server text', async () => {
    const fetchMock = flagsApi({ staleAlways: true })
    vi.stubGlobal('fetch', fetchMock)
    const popup = { closed: false }
    vi.stubGlobal('open', vi.fn(() => popup))
    const user = userEvent.setup()
    renderPage()
    await user.click(await screen.findByRole('radio', { name: 'Old look, purple (only you)' }))
    await user.click(await screen.findByRole('button', { name: 'Sign in with GitHub' }))
    popup.closed = true
    expect(await screen.findByText('You did not sign in, so nothing changed.')).toBeInTheDocument()
    expect(document.body.textContent).not.toMatch(/last 7 days|Could not save the flag/)
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(2)
  })

  it('a blocked pop-up keeps the dialog open with a plain notice', async () => {
    vi.stubGlobal('fetch', flagsApi({ staleFirstPost: true }))
    vi.stubGlobal('open', vi.fn(() => null))
    const user = userEvent.setup()
    renderPage()
    await user.click(await screen.findByRole('radio', { name: 'Old look, purple (only you)' }))
    await user.click(await screen.findByRole('button', { name: 'Sign in with GitHub' }))
    expect(await screen.findByText(/blocked the pop-up/)).toBeInTheDocument()
    expect(screen.getByRole('dialog', { name: 'Sign in again to save' })).toBeInTheDocument()
  })

  it('changes nothing on this device when the account save fails', async () => {
    vi.stubGlobal('fetch', flagsApi({ failPost: true }))
    const user = userEvent.setup()
    renderPage()
    await user.click(await screen.findByRole('radio', { name: 'Old look, purple (only you)' }))
    expect(await screen.findByText('Could not save the flag (no). Nothing changed.')).toBeInTheDocument()
    expect(localStorage.getItem(SKIN_KEY)).not.toBe('default')
    expect(document.documentElement.dataset.skin).toBe('rare')
  })

  it('a signed-in normal user gets Rare UI and /settings/flags goes to the drafts page, whatever is stored (#406)', async () => {
    localStorage.setItem(SKIN_KEY, 'default')
    localStorage.setItem(KIT_KEY, 'default')
    window.history.pushState({}, '', '/settings/flags')
    vi.stubGlobal('fetch', vi.fn(async (url) => (String(url) === '/api/auth/me' ? { ok: true, json: async () => ({ user: { login: 'bob', role: 'user' } }) } : { ok: true, json: async () => ({ drafts: [] }) })))
    render(<App />)
    await waitFor(() => expect(window.location.pathname).toBe('/'))
    expect(document.documentElement.dataset.skin).toBe('rare')
    expect(document.body.textContent).not.toMatch(/Feature flags/)
    window.history.pushState({}, '', '/')
  })

  it('the admin gets the old look saved on the account, over the device value', async () => {
    localStorage.setItem(SKIN_KEY, 'rare')
    window.history.pushState({}, '', '/')
    vi.stubGlobal('fetch', vi.fn(async (url) => {
      if (String(url) === '/api/auth/me') return { ok: true, json: async () => ({ user: { login: 'shaked', role: 'admin', admin: true } }) }
      if (String(url) === '/api/admin/flags') return { ok: true, json: async () => ({ flags: [flag('look', 'default'), flag('components', 'rare')] }) }
      return { ok: true, json: async () => ({ drafts: [] }) }
    }))
    render(<App />)
    await waitFor(() => expect(document.documentElement.dataset.skin).toBe('default'))
    expect(localStorage.getItem(SKIN_KEY)).toBe('default')
  })

  it('applies the account values to this device when the page loads', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ flags: [flag('look', 'default'), flag('components', 'default')] }) })))
    renderPage()
    expect((await screen.findByRole('radio', { name: 'Old look, purple (only you)' })).checked).toBe(true)
    expect(document.documentElement.dataset.skin).toBe('default')
    expect(localStorage.getItem(KIT_KEY)).toBe('default')
  })
})
