import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import ViewAsBar from '../../src/components/ViewAsBar.jsx'
import AppMenu from '../../src/components/AppMenu.jsx'
import DraftList from '../../src/components/DraftList.jsx'
import ShareLinkButton from '../../src/components/ShareLinkButton.jsx'
import ExportOptions from '../../src/components/ExportOptions.jsx'
import TokensPage from '../../src/pages/TokensPage.jsx'
import { adminApi, draftsApi, tokensApi } from '../../src/utils/api'
import { CurrentUserContext } from '../../src/utils/currentUser'
import { ViewAsContext } from '../../src/utils/viewAs'
import { ToastProvider } from '../../src/ui/Toast.jsx'
import { ConfirmProvider } from '../../src/ui/Dialog.jsx'

vi.mock('../../src/utils/api', () => ({
  adminApi: { endViewAs: vi.fn() },
  draftsApi: { list: vi.fn(), create: vi.fn(), remove: vi.fn(), createShareToken: vi.fn() },
  tokensApi: { list: vi.fn(), create: vi.fn(), revoke: vi.fn() },
  authApi: { logout: vi.fn() }
}))
vi.mock('../../src/utils/draftCache', () => ({ clearCachedDrafts: vi.fn() }))

const VIEW_AS = { login: 'alice', user_id: 'u-1', expires_at: new Date(Date.now() + 30 * 60 * 1000).toISOString() }
const ADMIN = { id: 'admin-1', login: 'root', role: 'admin', view_as: VIEW_AS }

function wrap(ui, viewAs = VIEW_AS) {
  return render(
    <CurrentUserContext.Provider value={ADMIN}>
      <ViewAsContext.Provider value={viewAs}>
        <ToastProvider>
          <MemoryRouter>
            <ConfirmProvider>{ui}</ConfirmProvider>
          </MemoryRouter>
        </ToastProvider>
      </ViewAsContext.Provider>
    </CurrentUserContext.Provider>
  )
}

describe('ViewAsBar', () => {
  let assign
  beforeEach(() => {
    assign = vi.fn()
    Object.defineProperty(window, 'location', { value: { ...window.location, assign }, configurable: true, writable: true })
    adminApi.endViewAs.mockResolvedValue({ ok: true })
  })
  afterEach(() => {
    vi.useRealTimers()
    cleanup()
    vi.clearAllMocks()
  })

  it('shows only when view_as is set', () => {
    const { unmount } = wrap(<ViewAsBar />, null)
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    unmount()
    wrap(<ViewAsBar />)
    expect(screen.getByRole('status')).toHaveTextContent(/Viewing as alice · read-only · ends \d\d:\d\d UTC/)
  })

  it('Cancel calls the API, then does a full page load of the user page', async () => {
    wrap(<ViewAsBar />)
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(adminApi.endViewAs).toHaveBeenCalledTimes(1)
    expect(assign).toHaveBeenCalledWith('/admin/users/u-1')
  })

  it('at expires_at a timer does the same full page load', async () => {
    vi.useFakeTimers()
    wrap(<ViewAsBar />)
    expect(assign).not.toHaveBeenCalled()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30 * 60 * 1000 + 10)
    })
    expect(assign).toHaveBeenCalledWith('/admin/users/u-1')
  })
})

describe('controls while viewing as a user', () => {
  const REASON = 'Not available while viewing as alice'
  beforeEach(() => {
    draftsApi.list.mockResolvedValue([{ id: 'd1', title: 'Private draft', posts: [], updated_at: '2026-11-01T10:00:00Z' }])
    tokensApi.list.mockResolvedValue({ tokens: [] })
  })
  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
  })

  it('disables create, duplicate and delete on the draft list, and does not call the API', async () => {
    wrap(<DraftList user={ADMIN} />)
    await screen.findByText('Private draft')
    for (const name of ['New draft', 'Duplicate', 'Delete draft']) {
      const button = screen.getByRole('button', { name })
      expect(button).toHaveAttribute('aria-disabled', 'true')
      expect(button).toHaveAccessibleDescription(REASON)
      await userEvent.click(button)
    }
    expect(draftsApi.create).not.toHaveBeenCalled()
    expect(draftsApi.remove).not.toHaveBeenCalled()
  })

  it('disables Share and Export with the message', () => {
    wrap(<><ShareLinkButton draftId="d1" /><ExportOptions draft={{ title: 't', posts: [{ id: 'p', text: 'x' }] }} /></>)
    for (const name of ['Share', 'Export']) {
      expect(screen.getByRole('button', { name })).toHaveAccessibleDescription(REASON)
    }
  })

  it('disables Create token on the API tokens page', async () => {
    wrap(<TokensPage />)
    await screen.findByText(/No tokens yet/)
    expect(screen.getByRole('button', { name: 'Create token' })).toHaveAccessibleDescription(REASON)
  })

  it('keeps the admin menu while viewing', () => {
    wrap(<AppMenu user={ADMIN} />)
    expect(screen.getAllByText(/Admin/).length).toBeGreaterThan(0)
  })
})
