import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import Tabs from '../../src/ui/Tabs.jsx'

const TABS = [
  { id: 'drafts', label: 'Drafts', count: 3 },
  { id: 'published', label: 'Published', count: 0 }
]

afterEach(cleanup)

describe('Tabs', () => {
  it('names each tab with its count and marks only the selected one', () => {
    render(<Tabs label="Threads" tabs={TABS} value="drafts" onChange={() => {}} />)
    expect(screen.getByRole('tablist', { name: 'Threads' })).toBeInTheDocument()
    const drafts = screen.getByRole('tab', { name: 'Drafts (3)' })
    const published = screen.getByRole('tab', { name: 'Published (0)' })
    expect(drafts).toHaveAttribute('aria-selected', 'true')
    expect(published).toHaveAttribute('aria-selected', 'false')
    expect(drafts).toHaveAttribute('tabindex', '0')
    expect(published).toHaveAttribute('tabindex', '-1')
  })

  it('selects a tab on click and moves with the arrow, Home and End keys', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<Tabs label="Threads" tabs={TABS} value="drafts" onChange={onChange} />)
    const drafts = screen.getByRole('tab', { name: 'Drafts (3)' })
    drafts.focus()

    await user.keyboard('{ArrowRight}')
    expect(onChange).toHaveBeenLastCalledWith('published')
    expect(screen.getByRole('tab', { name: 'Published (0)' })).toHaveFocus()

    await user.keyboard('{ArrowRight}')
    expect(onChange).toHaveBeenLastCalledWith('drafts')
    expect(drafts).toHaveFocus()

    await user.keyboard('{End}')
    expect(onChange).toHaveBeenLastCalledWith('published')

    await user.keyboard('{Home}')
    expect(onChange).toHaveBeenLastCalledWith('drafts')

    await user.click(screen.getByRole('tab', { name: 'Published (0)' }))
    expect(onChange).toHaveBeenLastCalledWith('published')
  })
})
