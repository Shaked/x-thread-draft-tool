import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { PASTE_IN } from '../../src/utils/connectApps.js'
import AppsPage from '../../src/pages/AppsPage.jsx'
import { grantsApi } from '../../src/utils/api'

// Pins what the Connected apps page does (moved from the API tokens page, #281). Written by role and text only.
vi.mock('../../src/utils/api', () => ({
  grantsApi: { list: vi.fn(), revoke: vi.fn() },
  authApi: { logout: vi.fn() }
}))
vi.mock('../../src/utils/draftCache', () => ({ clearCachedDrafts: vi.fn().mockResolvedValue(undefined) }))

const GRANT = { id: 'g1', client_name: 'Claude Desktop', kind: 'oauth', redirect_host: 'claude.ai', resource: 'https://x.test/api/mcp', scope: 'drafts', created_at: '2026-11-02T10:00:00Z', last_used_at: null, revoked_at: null }

function renderPage() {
  return render(
    <MemoryRouter>
      <AppsPage />
    </MemoryRouter>
  )
}

describe('AppsPage', () => {
  let writeText
  let user
  beforeEach(() => {
    vi.clearAllMocks()
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

  it('shows the Connected apps heading and links to the API tokens page', async () => {
    renderPage()
    expect(await screen.findByRole('heading', { name: 'Connected apps', level: 1 })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'API tokens' })).toHaveAttribute('href', '/settings/tokens')
    expect(screen.queryByRole('heading', { name: 'Your API tokens' })).toBeNull()
  })

  it('an empty connected-apps list shows its empty text', async () => {
    renderPage()
    expect(await screen.findByText(/No apps are connected/)).toBeInTheDocument()
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

  it('Use with AI apps shows each paste-in text in its own block, and each Copy button writes its own text', async () => {
    renderPage()
    expect(await screen.findByRole('heading', { name: 'Use with AI apps' })).toBeInTheDocument()
    expect(screen.getByText(PASTE_IN.en).tagName).toBe('BLOCKQUOTE')
    expect(screen.getByText(PASTE_IN.he).tagName).toBe('BLOCKQUOTE')

    await user.click(screen.getByRole('button', { name: 'Copy English text' }))
    await waitFor(() => expect(writeText).toHaveBeenLastCalledWith(PASTE_IN.en))
    await user.click(screen.getByRole('button', { name: 'Copy Hebrew text' }))
    await waitFor(() => expect(writeText).toHaveBeenLastCalledWith(PASTE_IN.he))
    expect(writeText).toHaveBeenCalledTimes(2)
  })
})
