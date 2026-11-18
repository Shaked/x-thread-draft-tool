import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import TokensPage from '../../src/pages/TokensPage.jsx'
import { grantsApi, tokensApi } from '../../src/utils/api'

// Pins what the API tokens page does. Written by role and text only, so the same test runs on the old and the
// redesigned markup (settings-menu.md Task 3, M12).
vi.mock('../../src/utils/api', () => ({
  tokensApi: { list: vi.fn(), create: vi.fn(), revoke: vi.fn() },
  grantsApi: { list: vi.fn(), revoke: vi.fn() },
  authApi: { logout: vi.fn() }
}))
vi.mock('../../src/utils/draftCache', () => ({ clearCachedDrafts: vi.fn().mockResolvedValue(undefined) }))

const SECRET = 'xt_pat_TESTSECRET123456'
const ACTIVE = { id: 'tok1', name: 'Laptop agent', prefix: 'xt_pat_TEST', created_at: '2026-11-01T10:00:00Z', created_via: 'web', last_used_at: null, expires_at: '2026-12-01T10:00:00Z', revoked_at: null }
const REVOKED = { id: 'tok2', name: 'Old agent', prefix: 'xt_pat_OLDX', created_at: '2026-10-01T10:00:00Z', created_via: 'api', last_used_at: '2026-10-02T10:00:00Z', expires_at: '2026-11-01T10:00:00Z', revoked_at: '2026-10-15T10:00:00Z' }
const GRANT = { id: 'g1', client_name: 'Claude Desktop', kind: 'oauth', redirect_host: 'claude.ai', resource: 'https://x.test/api/mcp', scope: 'drafts', created_at: '2026-11-02T10:00:00Z', last_used_at: null, revoked_at: null }

function renderPage() {
  return render(
    <MemoryRouter>
      <TokensPage />
    </MemoryRouter>
  )
}

describe('TokensPage', () => {
  let writeText
  let user
  beforeEach(() => {
    vi.clearAllMocks()
    tokensApi.list.mockResolvedValue({ tokens: [] })
    grantsApi.list.mockResolvedValue({ grants: [] })
    writeText = vi.fn().mockResolvedValue(undefined)
    user = userEvent.setup()
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    vi.spyOn(window, 'confirm').mockReturnValue(true)
  })
  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('create shows the token once, Copy writes it, and a reload of the list does not show it again', async () => {
    tokensApi.create.mockResolvedValue({ id: 'tok3', name: 'Claude agent', prefix: 'xt_pat_TEST', token: SECRET, expires_in_days: 7 })
    renderPage()
    await screen.findByText(/No tokens yet/)

    await user.type(screen.getByLabelText('Token name'), 'Claude agent')
    await user.click(screen.getByRole('button', { name: 'Create token' }))

    expect(tokensApi.create).toHaveBeenCalledWith({ name: 'Claude agent', expires_in_days: 7 })
    expect(await screen.findByText(SECRET)).toBeInTheDocument()
    expect(screen.getByText(/Copy this token now/)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Copy' }))
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(SECRET))

    // A new visit (a reload of the page) lists the token without its secret.
    cleanup()
    tokensApi.list.mockResolvedValue({ tokens: [{ ...ACTIVE, id: 'tok3', name: 'Claude agent', prefix: 'xt_pat_TEST' }] })
    renderPage()
    expect(await screen.findByText('Claude agent')).toBeInTheDocument()
    expect(screen.queryByText(SECRET)).toBeNull()
    expect(screen.queryByText(/Copy this token now/)).toBeNull()
  })

  it('when Copy fails, the token box says to select the token above and copy it', async () => {
    writeText.mockRejectedValueOnce(new Error('denied'))
    tokensApi.create.mockResolvedValue({ id: 'tok3', name: 'Claude agent', prefix: 'xt_pat_TEST', token: SECRET, expires_in_days: 7 })
    renderPage()
    await user.type(await screen.findByLabelText('Token name'), 'Claude agent')
    await user.click(screen.getByRole('button', { name: 'Create token' }))
    await user.click(await screen.findByRole('button', { name: 'Copy' }))

    expect(await screen.findByText('Select the token above and copy it.')).toBeInTheDocument()
    expect(screen.getByText(SECRET)).toBeInTheDocument()
  })

  it('Revoke asks for confirmation and calls tokensApi.revoke with the token id', async () => {
    tokensApi.list.mockResolvedValue({ tokens: [ACTIVE] })
    renderPage()
    await user.click(await screen.findByRole('button', { name: 'Revoke' }))

    expect(window.confirm).toHaveBeenCalledWith('Revoke this token? Agents using it will stop working.')
    await waitFor(() => expect(tokensApi.revoke).toHaveBeenCalledWith('tok1'))
    expect(tokensApi.list).toHaveBeenCalledTimes(2)
  })

  it('cancelling the Revoke confirmation calls nothing', async () => {
    window.confirm.mockReturnValue(false)
    tokensApi.list.mockResolvedValue({ tokens: [ACTIVE] })
    renderPage()
    await user.click(await screen.findByRole('button', { name: 'Revoke' }))

    expect(window.confirm).toHaveBeenCalledTimes(1)
    expect(tokensApi.revoke).not.toHaveBeenCalled()
  })

  it('an empty token list and an empty connected-apps list show their empty texts', async () => {
    renderPage()
    expect(await screen.findByText(/No tokens yet/)).toBeInTheDocument()
    expect(await screen.findByText(/No apps are connected/)).toBeInTheDocument()
  })

  it('a revoked token shows no Revoke button, and an active one does', async () => {
    tokensApi.list.mockResolvedValue({ tokens: [ACTIVE, REVOKED] })
    renderPage()
    expect(await screen.findByText('Old agent')).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: 'Revoke' })).toHaveLength(1)
    const oldRow = screen.getByText('Old agent').closest('li')
    expect(within(oldRow).queryByRole('button', { name: 'Revoke' })).toBeNull()
    expect(within(oldRow).getByText(/revoked/)).toBeInTheDocument()
  })

  it('revoking a connected app asks for confirmation, revokes it and shows the status text', async () => {
    grantsApi.list.mockResolvedValueOnce({ grants: [GRANT] })
    grantsApi.list.mockResolvedValue({ grants: [{ ...GRANT, revoked_at: '2026-11-18T08:00:00Z' }] })
    renderPage()
    await user.click(await screen.findByRole('button', { name: 'Revoke access for Claude Desktop' }))

    expect(window.confirm).toHaveBeenCalledWith('Revoke access for Claude Desktop? It stops working right away.')
    await waitFor(() => expect(grantsApi.revoke).toHaveBeenCalledWith('g1'))
    expect(await screen.findByText('Access for Claude Desktop was revoked.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Revoke access for Claude Desktop' })).toBeNull()
  })

  it('cancelling the connected-app revoke calls nothing and shows no status text', async () => {
    window.confirm.mockReturnValue(false)
    grantsApi.list.mockResolvedValue({ grants: [GRANT] })
    renderPage()
    await user.click(await screen.findByRole('button', { name: 'Revoke access for Claude Desktop' }))

    expect(grantsApi.revoke).not.toHaveBeenCalled()
    expect(screen.queryByText(/was revoked/)).toBeNull()
  })

  it('lists the four connect rows, each with a copy button', async () => {
    renderPage()
    expect(await screen.findByText('Connect an AI app')).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: 'Copy address' })).toHaveLength(2)
    expect(screen.getAllByRole('button', { name: 'Copy command' })).toHaveLength(2)
  })
})
