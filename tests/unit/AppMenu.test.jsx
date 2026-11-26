import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, RouterProvider, createMemoryRouter } from 'react-router-dom'
import AppMenu from '../../src/components/AppMenu.jsx'
import { authApi } from '../../src/utils/api'
import { CurrentUserContext } from '../../src/utils/currentUser'

vi.mock('../../src/utils/api', () => ({ authApi: { logout: vi.fn() } }))
vi.mock('../../src/utils/draftCache', () => ({ clearCachedDrafts: vi.fn().mockResolvedValue(undefined) }))

function renderMenu(user = { login: 'bob', admin: false }) {
  return render(
    <CurrentUserContext.Provider value={user}>
      <MemoryRouter>
        <div id="root">
          <AppMenu />
        </div>
      </MemoryRouter>
    </CurrentUserContext.Provider>
  )
}

describe('AppMenu', () => {
  beforeEach(() => {
    localStorage.clear()
    authApi.logout.mockResolvedValue({})
  })
  afterEach(() => {
    cleanup()
    document.documentElement.classList.remove('dialog-open')
  })

  it('is closed on load and opens on click with aria-expanded and an inert page', async () => {
    const user = userEvent.setup()
    renderMenu()
    const button = screen.getByRole('button', { name: 'Menu' })
    expect(button).toHaveAttribute('aria-expanded', 'false')
    expect(document.getElementById('app-menu')).toBeNull()
    expect(document.getElementById('root')).not.toHaveAttribute('inert')
    await user.click(button)
    expect(button).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(document.getElementById('root')).toHaveAttribute('inert')
    expect(screen.getByRole('link', { name: 'Drafts' })).toHaveFocus()
  })

  it('closes on Escape, returns focus to the button and lifts inert', async () => {
    const user = userEvent.setup()
    renderMenu()
    const button = screen.getByRole('button', { name: 'Menu' })
    await user.click(button)
    await user.keyboard('{Escape}')
    expect(document.getElementById('app-menu')).toBeNull()
    expect(document.getElementById('root')).not.toHaveAttribute('inert')
    expect(button).toHaveFocus()
  })

  it('lists API tokens and Connected apps under Settings', async () => {
    const user = userEvent.setup()
    renderMenu()
    await user.click(screen.getByRole('button', { name: 'Menu' }))
    expect(screen.getByRole('link', { name: 'API tokens' })).toHaveAttribute('href', '/settings/tokens')
    expect(screen.getByRole('link', { name: 'Connected apps' })).toHaveAttribute('href', '/settings/apps')
  })

  it('lists the changelog under Settings, after API tokens, for the admin', async () => {
    const user = userEvent.setup()
    renderMenu({ login: 'owner', admin: true })
    await user.click(screen.getByRole('button', { name: 'Menu' }))
    expect(screen.getByRole('link', { name: 'Changelog' })).toHaveAttribute('href', '/admin/changelog')
  })

  it('shows the Admin badge and the Admin section only for role admin (#282)', async () => {
    const user = userEvent.setup()
    const { unmount } = renderMenu({ login: 'owner', admin: true, role: 'admin' })
    expect(screen.getByRole('status', { name: 'You are the admin' })).toHaveTextContent('Admin')
    await user.click(screen.getByRole('button', { name: 'Menu' }))
    expect(screen.getByRole('heading', { name: 'Admin', level: 3 })).toBeInTheDocument()
    unmount()

    cleanup()
    const normal = renderMenu({ login: 'bob', role: 'user' })
    expect(screen.queryByText('Admin')).toBeNull()
    expect(screen.queryByRole('status', { name: 'You are the admin' })).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Menu' }))
    expect(screen.queryByRole('heading', { name: 'Admin' })).toBeNull()
    expect(normal.container.textContent).not.toMatch(/\bAdmin\b/)
  })

  it('has no changelog link for a normal user (#368)', async () => {
    const user = userEvent.setup()
    renderMenu({ login: 'bob' })
    await user.click(screen.getByRole('button', { name: 'Menu' }))
    expect(screen.queryByRole('link', { name: 'Changelog' })).toBeNull()
  })

  it('closes when the close button, a drawer link or the scrim is used', async () => {
    const user = userEvent.setup()
    renderMenu()
    const open = () => user.click(screen.getByRole('button', { name: 'Menu' }))
    await open()
    await user.click(screen.getByRole('button', { name: 'Close menu' }))
    expect(document.getElementById('app-menu')).toBeNull()
    await open()
    await user.click(screen.getByRole('link', { name: 'API tokens' }))
    expect(document.getElementById('app-menu')).toBeNull()
    await open()
    await user.click(document.querySelector('.ui-dialog__scrim'))
    expect(document.getElementById('app-menu')).toBeNull()
  })

  it('closes on a route change and stays closed when going back', async () => {
    const user = userEvent.setup()
    const router = createMemoryRouter(
      [{ path: '*', element: <div id="root"><AppMenu /></div> }],
      { initialEntries: ['/a'] }
    )
    render(<RouterProvider router={router} />)
    await user.click(screen.getByRole('button', { name: 'Menu' }))
    expect(document.getElementById('app-menu')).not.toBeNull()
    // Navigate through the router, not a click, so no pointerdown closes the menu first.
    await act(async () => router.navigate('/b'))
    expect(document.getElementById('app-menu')).toBeNull()
    expect(document.getElementById('root')).not.toHaveAttribute('inert')
    expect(document.documentElement.classList.contains('dialog-open')).toBe(false)
    await act(async () => router.navigate(-1))
    expect(router.state.location.pathname).toBe('/a')
    expect(document.getElementById('app-menu')).toBeNull()
    expect(document.getElementById('root')).not.toHaveAttribute('inert')
    expect(document.documentElement.classList.contains('dialog-open')).toBe(false)
  })

  it('shows Theme and signs out through authApi.logout', async () => {
    const user = userEvent.setup()
    const assign = vi.fn()
    const original = window.location
    Object.defineProperty(window, 'location', { value: { ...original, assign }, writable: true })
    renderMenu()
    await user.click(screen.getByRole('button', { name: 'Menu' }))
    expect(screen.getByRole('radio', { name: 'Dark' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Sign out' }))
    expect(authApi.logout).toHaveBeenCalledTimes(1)
    await vi.waitFor(() => expect(assign).toHaveBeenCalledWith('/'))
    Object.defineProperty(window, 'location', { value: original, writable: true })
  })
})
