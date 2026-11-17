import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Link } from 'react-router-dom'
import AppMenu from '../../src/components/AppMenu.jsx'
import { authApi } from '../../src/utils/api'

vi.mock('../../src/utils/api', () => ({ authApi: { logout: vi.fn() } }))
vi.mock('../../src/utils/draftCache', () => ({ clearCachedDrafts: vi.fn().mockResolvedValue(undefined) }))

function renderMenu() {
  return render(
    <MemoryRouter>
      <div id="root">
        <AppMenu />
        <Link to="/elsewhere">Elsewhere</Link>
      </div>
    </MemoryRouter>
  )
}

describe('AppMenu', () => {
  beforeEach(() => {
    localStorage.clear()
    authApi.logout.mockResolvedValue({})
  })
  afterEach(() => {
    cleanup()
    document.documentElement.classList.remove('menu-open')
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

  it('closes when the close button, a drawer link or the scrim is used', async () => {
    const user = userEvent.setup()
    renderMenu()
    const open = () => user.click(screen.getByRole('button', { name: 'Menu' }))
    await open()
    await user.click(screen.getByRole('button', { name: 'Close menu' }))
    expect(document.getElementById('app-menu')).toBeNull()
    await open()
    await user.click(screen.getByRole('link', { name: 'API tokens and apps' }))
    expect(document.getElementById('app-menu')).toBeNull()
    await open()
    await user.click(document.querySelector('.app-menu-scrim'))
    expect(document.getElementById('app-menu')).toBeNull()
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
