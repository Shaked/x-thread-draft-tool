import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import AppBar from '../../src/components/AppBar.jsx'
import { authApi } from '../../src/utils/api'
import { setBarHidden } from '../../src/utils/barPref.js'

vi.mock('../../src/utils/api', () => ({
  authApi: { logout: vi.fn() }
}))

function renderBar() {
  return render(
    <AppBar>
      <button type="button">Page action</button>
    </AppBar>
  )
}

describe('AppBar', () => {
  beforeEach(() => {
    localStorage.clear()
    authApi.logout.mockResolvedValue({})
  })

  afterEach(() => {
    cleanup()
    // The page-level fallback is module state: reset it so each test starts shown.
    setBarHidden(false)
    localStorage.clear()
    vi.clearAllMocks()
    vi.unstubAllGlobals()
  })

  it('renders the page actions and a Sign out button', () => {
    renderBar()
    expect(screen.getByRole('button', { name: 'Page action' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeVisible()
  })

  it('names the hide control and links it to the actions', () => {
    renderBar()
    const toggle = screen.getByRole('button', { name: 'Hide toolbar' })
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    expect(toggle).toHaveAttribute('aria-controls', 'app-bar-actions')
    expect(document.getElementById('app-bar-actions')).not.toBeNull()
  })

  it('hides on click, keeps focus on the control, and saves the choice', async () => {
    const user = userEvent.setup()
    const { container } = renderBar()
    const toggle = screen.getByRole('button', { name: 'Hide toolbar' })

    await user.click(toggle)

    const shown = screen.getByRole('button', { name: 'Show toolbar' })
    expect(shown).toBe(toggle)
    expect(shown).toHaveAttribute('aria-expanded', 'false')
    expect(container.querySelector('.app-bar')).toHaveClass('is-hidden')
    expect(localStorage.getItem('xt-bar')).toBe('hidden')
    expect(document.documentElement.dataset.bar).toBe('hidden')
    expect(toggle).toHaveFocus()
  })

  it('brings the bar back from the keyboard with Enter', async () => {
    const user = userEvent.setup()
    renderBar()
    const toggle = screen.getByRole('button', { name: 'Hide toolbar' })
    toggle.focus()

    await user.keyboard('{Enter}')
    expect(screen.getByRole('button', { name: 'Show toolbar' })).toBe(toggle)

    await user.keyboard('{Enter}')
    expect(screen.getByRole('button', { name: 'Hide toolbar' })).toBe(toggle)
    expect(localStorage.getItem('xt-bar')).toBe('shown')
  })

  it('starts hidden when the saved choice is hidden', () => {
    localStorage.setItem('xt-bar', 'hidden')
    renderBar()
    expect(screen.getByRole('button', { name: 'Show toolbar' })).toHaveAttribute('aria-expanded', 'false')
  })

  it('removes the page attribute on unmount', () => {
    const { unmount } = renderBar()
    expect(document.documentElement.dataset.bar).toBe('shown')
    unmount()
    expect(document.documentElement.dataset.bar).toBeUndefined()
  })

  it('signs out through authApi.logout and then leaves for the home page', async () => {
    const assign = vi.fn()
    vi.stubGlobal('location', { ...window.location, assign })
    const user = userEvent.setup()
    renderBar()

    await user.click(screen.getByRole('button', { name: 'Sign out' }))

    await waitFor(() => expect(assign).toHaveBeenCalledWith('/'))
    expect(authApi.logout).toHaveBeenCalledTimes(1)
  })
})
