import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import Menu from '../../src/ui/Menu.jsx'

function renderMenu(onSelect = vi.fn()) {
  render(
    <Menu
      title="Link valid for"
      trigger={{ label: 'Share', icon: 'share', variant: 'secondary' }}
      items={[
        { label: 'One', onSelect },
        { label: 'Two', onSelect },
        { label: 'Three', onSelect, tone: 'danger' }
      ]}
    />
  )
  return onSelect
}

describe('Menu', () => {
  afterEach(() => cleanup())

  it('opens with focus on the first item, and names the list by its title', async () => {
    const user = userEvent.setup()
    renderMenu()
    await user.click(screen.getByRole('button', { name: 'Share' }))
    expect(screen.getByRole('menu', { name: 'Link valid for' })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'One' })).toHaveFocus()
  })

  it('moves with the arrow keys, wrapping at both ends, and with Home and End', async () => {
    const user = userEvent.setup()
    renderMenu()
    await user.click(screen.getByRole('button', { name: 'Share' }))
    await user.keyboard('{ArrowUp}')
    expect(screen.getByRole('menuitem', { name: 'Three' })).toHaveFocus()
    await user.keyboard('{ArrowDown}')
    expect(screen.getByRole('menuitem', { name: 'One' })).toHaveFocus()
    await user.keyboard('{End}')
    expect(screen.getByRole('menuitem', { name: 'Three' })).toHaveFocus()
    await user.keyboard('{Home}')
    expect(screen.getByRole('menuitem', { name: 'One' })).toHaveFocus()
  })

  it('closes on Escape and gives focus back to the button', async () => {
    const user = userEvent.setup()
    renderMenu()
    const trigger = screen.getByRole('button', { name: 'Share' })
    await user.click(trigger)
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
  })

  it('runs the chosen item once and closes', async () => {
    const user = userEvent.setup()
    const onSelect = renderMenu()
    await user.click(screen.getByRole('button', { name: 'Share' }))
    await user.click(screen.getByRole('menuitem', { name: 'Two' }))
    expect(onSelect).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })
})
