import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const { rpcMock } = vi.hoisted(() => ({ rpcMock: vi.fn() }))

vi.mock('../../src/utils/supabase', () => ({
  supabase: {
    rpc: (...args) => rpcMock(...args)
  }
}))

import XThreadLinkButton from '../../src/components/XThreadLinkButton.jsx'

const TOKEN = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
const SUPABASE_URL = 'https://project.supabase.co'

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
    rpcMock.mockReset()
    import.meta.env.VITE_SUPABASE_URL = SUPABASE_URL
  })

  afterEach(() => {
    cleanup()
  })

  it('renders the X-thread label by default', () => {
    render(<XThreadLinkButton draftId="draft-1" />)
    expect(screen.getByRole('button', { name: /x thread/i })).toBeInTheDocument()
  })

  it('creates a token, copies the html-render link, and shows the copied tooltip', async () => {
    rpcMock.mockResolvedValue({ data: TOKEN, error: null })
    const user = userEvent.setup()
    const writeText = setupClipboard()

    render(<XThreadLinkButton draftId="draft-1" />)
    await user.click(screen.getByRole('button', { name: /x thread/i }))

    await waitFor(() => expect(rpcMock).toHaveBeenCalledTimes(1))
    expect(rpcMock).toHaveBeenCalledWith('create_share_token', { p_draft_id: 'draft-1' })

    const expectedUrl = `${window.location.origin}/x-thread-preview/${TOKEN}`
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(expectedUrl))

    expect(await screen.findByText(/one-time x-thread link copied/i)).toBeInTheDocument()
  })

  it('strips a trailing slash from the configured Supabase URL', async () => {
    import.meta.env.VITE_SUPABASE_URL = `${SUPABASE_URL}/`
    rpcMock.mockResolvedValue({ data: TOKEN, error: null })
    const user = userEvent.setup()
    const writeText = setupClipboard()

    render(<XThreadLinkButton draftId="draft-1" />)
    await user.click(screen.getByRole('button', { name: /x thread/i }))

    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith(
        `${window.location.origin}/x-thread-preview/${TOKEN}`
      )
    )
  })

  it('surfaces an error tooltip when the RPC fails', async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: 'rpc broke' } })
    const user = userEvent.setup()
    const writeText = setupClipboard()

    render(<XThreadLinkButton draftId="draft-1" />)
    await user.click(screen.getByRole('button', { name: /x thread/i }))

    expect(await screen.findByText(/rpc broke/i)).toBeInTheDocument()
    expect(writeText).not.toHaveBeenCalled()
  })

  it('surfaces an error when no token is returned', async () => {
    rpcMock.mockResolvedValue({ data: null, error: null })
    const user = userEvent.setup()
    setupClipboard()

    render(<XThreadLinkButton draftId="draft-1" />)
    await user.click(screen.getByRole('button', { name: /x thread/i }))

    expect(await screen.findByText(/no token returned/i)).toBeInTheDocument()
  })

  it('does not double-fire while the request is in flight', async () => {
    let resolveRpc
    rpcMock.mockReturnValue(
      new Promise((resolve) => {
        resolveRpc = resolve
      })
    )
    const user = userEvent.setup()
    const writeText = setupClipboard()

    render(<XThreadLinkButton draftId="draft-1" />)
    const btn = screen.getByRole('button', { name: /x thread/i })
    await user.click(btn)
    await user.click(btn)
    await user.click(btn)

    expect(rpcMock).toHaveBeenCalledTimes(1)
    resolveRpc({ data: TOKEN, error: null })
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1))
  })
})
