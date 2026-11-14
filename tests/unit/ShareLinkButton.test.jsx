import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const { createShareTokenMock } = vi.hoisted(() => ({ createShareTokenMock: vi.fn() }))

vi.mock('../../src/utils/api', () => ({
  draftsApi: {
    createShareToken: (...args) => createShareTokenMock(...args)
  }
}))

import ShareLinkButton from '../../src/components/ShareLinkButton.jsx'

const TOKEN = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'

// Called after userEvent.setup(), which installs its own clipboard, so this one is the one used.
function mockClipboard() {
  const writeText = vi.fn().mockResolvedValue(undefined)
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText, readText: vi.fn().mockResolvedValue('') }
  })
  return writeText
}

describe('ShareLinkButton', () => {
  beforeEach(() => {
    createShareTokenMock.mockReset()
  })

  afterEach(() => {
    cleanup()
  })

  it('opens a menu with the four lifetimes, one hour marked as the default', async () => {
    const user = userEvent.setup()
    render(<ShareLinkButton draftId="draft-1" />)
    expect(screen.queryByRole('button', { name: /7 days/i })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Share' }))

    for (const label of ['15 minutes', '1 hour (default)', '1 day', '7 days']) {
      expect(screen.getByRole('button', { name: label })).toBeInTheDocument()
    }
  })

  it('closes the menu on Escape and on a click outside it', async () => {
    const user = userEvent.setup()
    render(
      <div>
        <ShareLinkButton draftId="draft-1" />
        <p>elsewhere</p>
      </div>
    )
    const share = screen.getByRole('button', { name: 'Share' })

    await user.click(share)
    expect(share).toHaveAttribute('aria-expanded', 'true')
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('button', { name: '1 day' })).not.toBeInTheDocument()

    await user.click(share)
    expect(screen.getByRole('button', { name: '1 day' })).toBeInTheDocument()
    await user.click(screen.getByText('elsewhere'))
    expect(screen.queryByRole('button', { name: '1 day' })).not.toBeInTheDocument()
    expect(share).toHaveAttribute('aria-expanded', 'false')
  })

  it('creates a reusable link for the chosen lifetime, copies it, and says when it stops', async () => {
    createShareTokenMock.mockResolvedValue(TOKEN)
    const user = userEvent.setup()
    const writeText = mockClipboard()

    render(<ShareLinkButton draftId="draft-1" />)
    await user.click(screen.getByRole('button', { name: 'Share' }))
    await user.click(screen.getByRole('button', { name: '7 days' }))

    await waitFor(() => expect(createShareTokenMock).toHaveBeenCalledTimes(1))
    expect(createShareTokenMock).toHaveBeenCalledWith('draft-1', { expires_in: 7 * 24 * 60 * 60, one_time: false })
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/x-thread-preview/${TOKEN}`))
    expect(await screen.findByText('Link copied. It stops working in 7 days.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '7 days' })).not.toBeInTheDocument()
  })

  it('shows an error when the link cannot be created', async () => {
    createShareTokenMock.mockRejectedValue(new Error('rpc broke'))
    const user = userEvent.setup()
    const writeText = mockClipboard()
    render(<ShareLinkButton draftId="draft-1" />)
    await user.click(screen.getByRole('button', { name: 'Share' }))
    await user.click(screen.getByRole('button', { name: '1 hour (default)' }))

    expect(await screen.findByText(/rpc broke/i)).toBeInTheDocument()
    expect(writeText).not.toHaveBeenCalled()
  })
})
