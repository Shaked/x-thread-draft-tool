import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ThemePicker from '../../src/ui/ThemePicker.jsx'
import { KIT_KEY } from '../../src/utils/skin.js'

// The Rare UI components behind the "Components" feature flag (#406), through their src/ui wrappers.
const THEMES = [
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
  { value: 'system', label: 'Match device' }
]

describe('Rare UI components (feature flag)', () => {
  beforeEach(() => localStorage.clear())
  afterEach(() => {
    cleanup()
    localStorage.clear()
  })

  it('ThemePicker shows the segmented control with the flag off', () => {
    render(<ThemePicker legend="Theme" value="dark" options={THEMES} onChange={() => {}} />)
    expect(screen.getByRole('group', { name: 'Theme' })).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: 'Dark' })).toBeChecked()
  })

  it('ThemePicker shows Rare UI previews with the flag on; click and arrow keys choose', async () => {
    localStorage.setItem(KIT_KEY, 'rare')
    const onChange = vi.fn()
    const user = userEvent.setup()
    render(<ThemePicker legend="Theme" value="dark" options={THEMES} onChange={onChange} />)
    const group = await screen.findByRole('radiogroup', { name: 'Theme' })
    expect(within(group).getByRole('radio', { name: 'Dark' })).toHaveAttribute('aria-checked', 'true')
    expect(within(group).getByRole('radio', { name: 'Dark' })).toHaveAttribute('tabindex', '0')
    await user.click(within(group).getByRole('radio', { name: 'Match device' }))
    expect(onChange).toHaveBeenLastCalledWith('system')
    within(group).getByRole('radio', { name: 'Dark' }).focus()
    await user.keyboard('{ArrowLeft}')
    expect(onChange).toHaveBeenLastCalledWith('light')
    expect(within(group).getByRole('radio', { name: 'Light' })).toHaveFocus()
  })
})
