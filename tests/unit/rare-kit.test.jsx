import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import DeleteButton from '../../src/ui/DeleteButton.jsx'
import { ConfirmProvider } from '../../src/ui/Dialog.jsx'
import ThemePicker from '../../src/ui/ThemePicker.jsx'
import { KIT_KEY } from '../../src/utils/skin.js'

// The Rare UI components behind the "Components" feature flag (#406), through their src/ui wrappers.
const THEMES = [
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
  { value: 'system', label: 'Match device' }
]

const CONFIRM = { title: 'Delete this draft?', body: 'Are you sure you want to delete this draft?', confirmLabel: 'Delete draft' }

function renderDelete(onConfirm) {
  return render(
    <MemoryRouter>
      <ConfirmProvider>
        <DeleteButton label="Delete draft" confirm={CONFIRM} onConfirm={onConfirm} />
      </ConfirmProvider>
    </MemoryRouter>
  )
}

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

  it('DeleteButton asks with the dialog with the flag off', async () => {
    const onConfirm = vi.fn()
    const user = userEvent.setup()
    renderDelete(onConfirm)
    await user.click(screen.getByRole('button', { name: 'Delete draft' }))
    const dialog = screen.getByRole('dialog', { name: 'Delete this draft?' })
    await user.click(within(dialog).getByRole('button', { name: 'Delete draft' }))
    expect(onConfirm).toHaveBeenCalledTimes(1)
  })

  it('DeleteButton opens the Rare UI panel with the flag on: Cancel first, Escape keeps, yes deletes', async () => {
    localStorage.setItem(KIT_KEY, 'rare')
    const onConfirm = vi.fn()
    const user = userEvent.setup()
    renderDelete(onConfirm)
    const trigger = await screen.findByRole('button', { name: 'Delete draft', expanded: false })
    await user.click(trigger)
    let panel = screen.getByRole('group', { name: 'Delete this draft?' })
    expect(panel).toHaveAccessibleDescription('Are you sure you want to delete this draft?')
    expect(within(panel).getByRole('button', { name: 'Cancel' })).toHaveFocus()
    await user.keyboard('{Escape}')
    expect(onConfirm).not.toHaveBeenCalled()
    expect(trigger).toHaveFocus()
    await user.click(trigger)
    panel = screen.getByRole('group', { name: 'Delete this draft?' })
    await user.click(within(panel).getByRole('button', { name: 'Delete draft' }))
    expect(onConfirm).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('dialog')).toBeNull()
    await act(async () => {})
  })
})
