import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import FlagsPage from '../../src/pages/FlagsPage.jsx'
import { SKIN_KEY } from '../../src/utils/skin.js'

describe('FlagsPage', () => {
  beforeEach(() => {
    localStorage.clear()
    delete document.documentElement.dataset.skin
  })
  afterEach(() => {
    cleanup()
    localStorage.clear()
  })

  it('shows the current look as chosen by default', () => {
    render(
      <MemoryRouter>
        <FlagsPage />
      </MemoryRouter>
    )
    expect(screen.getByRole('heading', { name: 'Feature flags' })).toBeTruthy()
    expect(screen.getByRole('radio', { name: 'Current look (purple)' }).checked).toBe(true)
  })

  it('switches to the Rare UI look and remembers it', async () => {
    const user = userEvent.setup()
    render(
      <MemoryRouter>
        <FlagsPage />
      </MemoryRouter>
    )
    await user.click(screen.getByRole('radio', { name: 'Rare UI look (black and orange)' }))
    expect(document.documentElement.dataset.skin).toBe('rare')
    expect(localStorage.getItem(SKIN_KEY)).toBe('rare')
    expect(screen.getByRole('radio', { name: 'Rare UI look (black and orange)' }).checked).toBe(true)
  })
})
