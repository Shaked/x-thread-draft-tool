import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import AdminLayout from '../../src/pages/admin/AdminLayout.jsx'

const ID = '11111111-1111-4111-8111-111111111111'
const USER = {
  id: ID, login: 'ada', name: '<i>Ada</i>', created_at: '2026-11-01T10:00:00.000Z', last_sign_in_at: null, last_active_at: null,
  suspended_at: null, suspended_reason: null, protected: false, drafts: 3, published_drafts: 1, posts: 9, images: 2,
  api_tokens_active: 1, api_tokens_total: 2, share_links_active: 0, mcp_calls_24h: 4, mcp_calls_7d: 20,
  image_files: null, image_bytes: null, image_files_truncated: null,
  api_tokens: [{ id: 't1', created_via: 'web', created_at: '2026-11-02T10:00:00.000Z', last_used_at: null, expires_at: null, revoked_at: null }],
  connected_apps: [{ id: 'g1', kind: 'claude', redirect_host: 'claude.ai', resource: 'mcp', created_at: '2026-11-03T10:00:00.000Z', last_used_at: null, revoked_at: null }]
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

function mount(status, body) {
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: status === 200, status, json: async () => body })))
  render(
    <MemoryRouter initialEntries={[`/admin/users/${ID}`]}>
      <Routes>
        <Route path="/admin/*" element={<AdminLayout />} />
      </Routes>
    </MemoryRouter>
  )
}

describe('admin user details', () => {
  it('shows fields, tokens and apps; null shows unknown; text stays text; no token secrets', async () => {
    mount(200, { user: { ...USER, token_hash: 'HASH123', prefix: 'xt_PREFIX' } })
    expect((await screen.findAllByText('<i>Ada</i>')).length).toBeGreaterThan(0)
    expect(document.querySelector('i')).toBeNull()
    expect(screen.getByRole('link', { name: 'ada' })).toHaveAttribute('href', 'https://github.com/ada')
    expect(screen.getAllByText('unknown').length).toBeGreaterThan(3)
    expect(screen.getByText('Created via web')).toBeInTheDocument()
    expect(screen.getByText('claude · claude.ai')).toBeInTheDocument()
    expect(document.body.textContent).not.toMatch(/HASH123|xt_PREFIX/)
  })

  it('says when the user does not exist', async () => {
    mount(404, { error: 'User not found' })
    expect(await screen.findByText('User not found.')).toBeInTheDocument()
  })
})
