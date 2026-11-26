import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import App from '../../src/App.jsx'
import AdminLayout from '../../src/pages/admin/AdminLayout.jsx'
import { allowFlags, KIT_KEY, SKIN_KEY } from '../../src/utils/skin.js'

const flag = (name, value) => ({ name, value, values: ['default', 'rare'], default: 'default', meaning: '' })

// A fake of GET and POST /api/admin/flags that keeps the two values.
function flagsApi({ failPost = false } = {}) {
  const state = { look: 'default', components: 'default' }
  const view = () => ({ flags: [flag('look', state.look), flag('components', state.components)] })
  return vi.fn(async (url, init = {}) => {
    if (String(url) !== '/api/admin/flags') return { ok: false, status: 404, json: async () => ({}) }
    if (init.method === 'POST') {
      if (failPost) return { ok: false, status: 500, json: async () => ({ error: 'no' }) }
      const body = JSON.parse(init.body)
      state[body.name] = body.value
    }
    return { ok: true, json: async () => view() }
  })
}

function renderPage() {
  render(
    <MemoryRouter initialEntries={['/admin/flags']}>
      <Routes>
        <Route path="/admin/*" element={<AdminLayout />} />
      </Routes>
    </MemoryRouter>
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

  it('shows the current look and components as chosen by default', async () => {
    vi.stubGlobal('fetch', flagsApi())
    renderPage()
    expect((await screen.findByRole('radio', { name: 'Current (purple)' })).checked).toBe(true)
    expect(screen.getByRole('radio', { name: 'Current components' }).checked).toBe(true)
  })

  it('saves the Rare UI look on the account, copies it to this device and applies it', async () => {
    const fetchMock = flagsApi()
    vi.stubGlobal('fetch', fetchMock)
    const user = userEvent.setup()
    renderPage()
    await user.click(await screen.findByRole('radio', { name: 'Rare UI (black, orange)' }))
    await waitFor(() => expect(document.documentElement.dataset.skin).toBe('rare'))
    const post = fetchMock.mock.calls.find(([, init]) => init?.method === 'POST')
    expect(JSON.parse(post[1].body)).toEqual({ name: 'look', value: 'rare' })
    expect(post[1].headers['x-xt-admin']).toBe('1')
    expect(localStorage.getItem(SKIN_KEY)).toBe('rare')
    expect(screen.getByRole('radio', { name: 'Rare UI (black, orange)' }).checked).toBe(true)
  })

  it('saves the Rare UI components apart from the look', async () => {
    vi.stubGlobal('fetch', flagsApi())
    const user = userEvent.setup()
    renderPage()
    await user.click(await screen.findByRole('radio', { name: 'Rare UI components' }))
    await waitFor(() => expect(localStorage.getItem(KIT_KEY)).toBe('rare'))
    expect(document.documentElement.dataset.skin).toBe('default')
    expect(screen.getByRole('link', { name: 'Rare UI' })).toHaveAttribute('href', 'https://rareui.com')
  })

  it('changes nothing on this device when the account save fails', async () => {
    vi.stubGlobal('fetch', flagsApi({ failPost: true }))
    const user = userEvent.setup()
    renderPage()
    await user.click(await screen.findByRole('radio', { name: 'Rare UI (black, orange)' }))
    expect(await screen.findByText('Could not save the flag (no). Nothing changed.')).toBeInTheDocument()
    expect(localStorage.getItem(SKIN_KEY)).not.toBe('rare')
    expect(document.documentElement.dataset.skin).toBe('default')
  })

  it('a signed-in normal user gets the default look and /settings/flags goes to the drafts page, whatever is stored', async () => {
    localStorage.setItem(SKIN_KEY, 'rare')
    localStorage.setItem(KIT_KEY, 'rare')
    window.history.pushState({}, '', '/settings/flags')
    vi.stubGlobal('fetch', vi.fn(async (url) => (String(url) === '/api/auth/me' ? { ok: true, json: async () => ({ user: { login: 'bob', role: 'user' } }) } : { ok: true, json: async () => ({ drafts: [] }) })))
    render(<App />)
    await waitFor(() => expect(window.location.pathname).toBe('/'))
    expect(document.documentElement.dataset.skin).toBe('default')
    expect(document.body.textContent).not.toMatch(/Feature flags/)
    window.history.pushState({}, '', '/')
  })

  it('the admin gets the look saved on the account, over an older stored value', async () => {
    window.history.pushState({}, '', '/')
    vi.stubGlobal('fetch', vi.fn(async (url) => {
      if (String(url) === '/api/auth/me') return { ok: true, json: async () => ({ user: { login: 'shaked', role: 'admin', admin: true } }) }
      if (String(url) === '/api/admin/flags') return { ok: true, json: async () => ({ flags: [flag('look', 'rare'), flag('components', 'default')] }) }
      return { ok: true, json: async () => ({ drafts: [] }) }
    }))
    render(<App />)
    await waitFor(() => expect(document.documentElement.dataset.skin).toBe('rare'))
    expect(localStorage.getItem(SKIN_KEY)).toBe('rare')
  })

  it('applies the account values to this device when the page loads', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ flags: [flag('look', 'rare'), flag('components', 'rare')] }) })))
    renderPage()
    expect((await screen.findByRole('radio', { name: 'Rare UI (black, orange)' })).checked).toBe(true)
    expect(document.documentElement.dataset.skin).toBe('rare')
    expect(localStorage.getItem(KIT_KEY)).toBe('rare')
  })
})
