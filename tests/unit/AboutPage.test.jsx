import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import AboutPage from '../../src/pages/AboutPage.jsx'
import { localBuildInfo } from '../../src/utils/version'

vi.mock('../../src/utils/version', async (importOriginal) => ({ ...(await importOriginal()), localBuildInfo: vi.fn() }))
vi.mock('../../src/utils/draftCache', () => ({ clearCachedDrafts: vi.fn().mockResolvedValue(undefined) }))

const BUILD = { commit: 'aaaaaaa1111111111111111111111111111111111', deployed_at: '2026-11-17T10:00:00Z' }
const SERVER = { commit: 'bbbbbbb2222222222222222222222222222222222', commit_short: 'bbbbbbb', deployed_at: '2026-11-18T08:00:00Z', environment: 'production', schema: '008_revoked_sessions' }

function renderPage() {
  return render(
    <MemoryRouter>
      <AboutPage />
    </MemoryRouter>
  )
}

describe('AboutPage', () => {
  let fetchMock
  beforeEach(() => {
    localBuildInfo.mockReturnValue(BUILD)
    fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => SERVER })
    vi.stubGlobal('fetch', fetchMock)
  })
  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('renders the app build and the server version, fetching the server once', async () => {
    renderPage()
    expect(screen.getByRole('heading', { name: 'About', level: 1 })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'This app' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Server' })).toBeInTheDocument()
    expect(screen.getByText('aaaaaaa')).toBeInTheDocument()
    expect(await screen.findByText('bbbbbbb')).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledWith('/api/version', expect.anything())
    expect(screen.getAllByRole('button', { name: 'Copy commit and deploy time' })).toHaveLength(2)
    expect(screen.getByRole('button', { name: 'Reload' })).toBeInTheDocument()
  })

  it('shows the reload hint only when the commits differ, and reloads', async () => {
    const user = userEvent.setup()
    const reload = vi.fn()
    const original = window.location
    Object.defineProperty(window, 'location', { value: { ...original, reload }, writable: true })
    renderPage()
    await user.click(await screen.findByRole('button', { name: 'Reload' }))
    expect(screen.getByText('A newer version is live. Reload to update.')).toBeInTheDocument()
    expect(reload).toHaveBeenCalledTimes(1)
    Object.defineProperty(window, 'location', { value: original, writable: true })
  })

  it('shows no reload hint when both commits are the same', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ ...SERVER, commit: BUILD.commit }) })
    renderPage()
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    await screen.findAllByText('aaaaaaa')
    expect(screen.queryByRole('button', { name: 'Reload' })).toBeNull()
    expect(screen.queryByText('A newer version is live. Reload to update.')).toBeNull()
  })

  it('reads unknown for a null commit and deploy time, and shows no hint', async () => {
    localBuildInfo.mockReturnValue(null)
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ commit: null, commit_short: null, deployed_at: null, environment: 'local', schema: null }) })
    renderPage()
    expect(await screen.findAllByText('unknown')).not.toHaveLength(0)
    expect(screen.queryByRole('button', { name: 'Reload' })).toBeNull()
  })

  it('shows no hint when the build has a commit but the server answer has none', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ ...SERVER, commit: null, commit_short: null }) })
    renderPage()
    await waitFor(() => expect(screen.queryByText('Loading…')).toBeNull())
    expect(screen.queryByRole('button', { name: 'Reload' })).toBeNull()
    expect(screen.queryByText('A newer version is live. Reload to update.')).toBeNull()
  })

  it('shows no hint when the server has a commit but the build has none', async () => {
    localBuildInfo.mockReturnValue({ ...BUILD, commit: null })
    renderPage()
    expect(await screen.findByText('bbbbbbb')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Reload' })).toBeNull()
    expect(screen.queryByText('A newer version is live. Reload to update.')).toBeNull()
  })

  it('shows the error state when the server cannot be reached', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'))
    renderPage()
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not reach the server')
    expect(screen.getByRole('heading', { name: 'This app' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Reload' })).toBeNull()
  })

  it('credits Rare UI with a link to https://rareui.com in English and in Hebrew', async () => {
    const { container } = renderPage()
    await screen.findByText('bbbbbbb')
    expect(screen.getByRole('heading', { name: 'Credits' })).toBeInTheDocument()
    const links = screen.getAllByRole('link', { name: 'Rare UI (rareui.com)' })
    expect(links).toHaveLength(2)
    for (const link of links) {
      expect(link).toHaveAttribute('href', 'https://rareui.com')
      expect(link).toHaveAttribute('target', '_blank')
      expect(link).toHaveAttribute('rel', 'noreferrer')
    }
    const en = container.querySelector('p[lang="en"]')
    const he = container.querySelector('p[lang="he"]')
    expect(en).toHaveAttribute('lang', 'en')
    expect(en).toHaveAttribute('dir', 'ltr')
    expect(en).toContainElement(links[0])
    expect(en).toHaveTextContent('MIT + Commons Clause License Condition v1.0 + Attribution')
    expect(he).toHaveAttribute('dir', 'rtl')
    expect(he).toContainElement(links[1])
    expect(he).toHaveTextContent('לפי הרישיון שלו')
  })
})
