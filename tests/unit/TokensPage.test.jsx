import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import TokensPage from '../../src/pages/TokensPage.jsx'
import { tokensApi } from '../../src/utils/api'
import { ConfirmProvider } from '../../src/ui/Dialog.jsx'

// Pins what the API tokens page does. Written by role and text only, so the same test runs on the old and the
// redesigned markup (settings-menu.md Task 3, M12).
vi.mock('../../src/utils/api', () => ({
  tokensApi: { list: vi.fn(), create: vi.fn(), revoke: vi.fn() },
  authApi: { logout: vi.fn() }
}))
vi.mock('../../src/utils/draftCache', () => ({ clearCachedDrafts: vi.fn().mockResolvedValue(undefined) }))

const SECRET = 'xt_pat_TESTSECRET123456'
const ACTIVE = { id: 'tok1', name: 'Laptop agent', prefix: 'xt_pat_TEST', created_at: '2026-11-01T10:00:00Z', created_via: 'web', last_used_at: null, expires_at: '2026-12-01T10:00:00Z', revoked_at: null }
const REVOKED = { id: 'tok2', name: 'Old agent', prefix: 'xt_pat_OLDX', created_at: '2026-10-01T10:00:00Z', created_via: 'api', last_used_at: '2026-10-02T10:00:00Z', expires_at: '2026-11-01T10:00:00Z', revoked_at: '2026-10-15T10:00:00Z' }

function renderPage() {
  return render(
    <ConfirmProvider>
      <MemoryRouter>
        <TokensPage />
      </MemoryRouter>
    </ConfirmProvider>
  )
}

describe('TokensPage', () => {
  let writeText
  let user
  beforeEach(() => {
    vi.clearAllMocks()
    tokensApi.list.mockResolvedValue({ tokens: [] })
    writeText = vi.fn().mockResolvedValue(undefined)
    user = userEvent.setup()
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
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

    expect(await screen.findByRole('dialog')).toHaveTextContent('Revoke this token? Agents using it will stop working.')
    expect(tokensApi.revoke).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Revoke token' }))
    await waitFor(() => expect(tokensApi.revoke).toHaveBeenCalledWith('tok1'))
    expect(tokensApi.list).toHaveBeenCalledTimes(2)
  })

  it('cancelling the Revoke confirmation calls nothing', async () => {
    tokensApi.list.mockResolvedValue({ tokens: [ACTIVE] })
    renderPage()
    await user.click(await screen.findByRole('button', { name: 'Revoke' }))
    await user.click(await screen.findByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(tokensApi.revoke).not.toHaveBeenCalled()
  })

  it('an empty token list shows its empty text, and the page links to Connected apps', async () => {
    renderPage()
    expect(await screen.findByText(/No tokens yet/)).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'API tokens', level: 1 })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Connected apps' })).toHaveAttribute('href', '/settings/apps')
    expect(screen.queryByRole('heading', { name: 'Connect an AI app' })).toBeNull()
  })

  it('a token past its expiry shows Expired, not Active', async () => {
    tokensApi.list.mockResolvedValue({ tokens: [{ ...ACTIVE, id: 'tok4', name: 'Stale agent', expires_at: '2020-01-01T00:00:00Z' }] })
    renderPage()
    const row = (await screen.findByText('Stale agent')).closest('li')
    expect(within(row).getByText('Expired')).toBeInTheDocument()
    expect(within(row).queryByText('Active')).toBeNull()
  })

  it('a revoked token shows no Revoke button, and an active one does', async () => {
    tokensApi.list.mockResolvedValue({ tokens: [ACTIVE, REVOKED] })
    renderPage()
    expect(await screen.findByText('Old agent')).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: 'Revoke' })).toHaveLength(1)
    const oldRow = screen.getByText('Old agent').closest('li')
    expect(within(oldRow).queryByRole('button', { name: 'Revoke' })).toBeNull()
    expect(within(oldRow).getByText('Revoked')).toBeInTheDocument()
  })
})
