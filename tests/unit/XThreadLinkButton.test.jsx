import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const { createShareTokenMock } = vi.hoisted(() => ({ createShareTokenMock: vi.fn() }))

vi.mock('../../src/utils/api', () => ({
  draftsApi: {
    createShareToken: (...args) => createShareTokenMock(...args)
  }
}))

import XThreadLinkButton from '../../src/components/XThreadLinkButton.jsx'

const TOKEN = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'

function setupClipboard() {
  const writeText = vi.fn().mockResolvedValue(undefined)
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText, readText: vi.fn().mockResolvedValue('') }
  })
  return writeText
}

describe('XThreadLinkButton', () => {
  beforeEach(() => {
    createShareTokenMock.mockReset()
  })

  afterEach(() => {
    cleanup()
  })

  it('renders the X-thread label by default', () => {
    render(<XThreadLinkButton draftId="draft-1" />)
    expect(screen.getByRole('button', { name: /x thread/i })).toBeInTheDocument()
  })

  it('creates a token, copies the html-render link, and shows the copied tooltip', async () => {
    createShareTokenMock.mockResolvedValue(TOKEN)
    const user = userEvent.setup()
    const writeText = setupClipboard()

    render(<XThreadLinkButton draftId="draft-1" />)
    await user.click(screen.getByRole('button', { name: /x thread/i }))

    await waitFor(() => expect(createShareTokenMock).toHaveBeenCalledTimes(1))
    expect(createShareTokenMock).toHaveBeenCalledWith('draft-1')

    const expectedUrl = `${window.location.origin}/x-thread-preview/${TOKEN}`
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(expectedUrl))

    expect(await screen.findByText(/one-time x-thread link copied/i)).toBeInTheDocument()
  })

  it('surfaces an error tooltip when the API call fails', async () => {
    createShareTokenMock.mockRejectedValue(new Error('rpc broke'))
    const user = userEvent.setup()
    const writeText = setupClipboard()

    render(<XThreadLinkButton draftId="draft-1" />)
    await user.click(screen.getByRole('button', { name: /x thread/i }))

    expect(await screen.findByText(/rpc broke/i)).toBeInTheDocument()
    expect(writeText).not.toHaveBeenCalled()
  })

  it('surfaces an error when no token is returned', async () => {
    createShareTokenMock.mockResolvedValue(null)
    const user = userEvent.setup()
    setupClipboard()

    render(<XThreadLinkButton draftId="draft-1" />)
    await user.click(screen.getByRole('button', { name: /x thread/i }))

    expect(await screen.findByText(/no token returned/i)).toBeInTheDocument()
  })

  it('does not double-fire while the request is in flight', async () => {
    let resolveToken
    createShareTokenMock.mockReturnValue(
      new Promise((resolve) => {
        resolveToken = resolve
      })
    )
    const user = userEvent.setup()
    const writeText = setupClipboard()

    render(<XThreadLinkButton draftId="draft-1" />)
    const btn = screen.getByRole('button', { name: /x thread/i })
    await user.click(btn)
    await user.click(btn)
    await user.click(btn)

    expect(createShareTokenMock).toHaveBeenCalledTimes(1)
    resolveToken(TOKEN)
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1))
  })
})
