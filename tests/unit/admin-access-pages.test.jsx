// #485: every admin page (listed from the source) as signed out, as a normal user and as the admin.
// Signed out and a normal user land where an unknown path lands, and see no admin text. The admin gets the real page.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import App from '../../src/App.jsx'
import { adminPages } from '../helpers/admin-pages.js'

const NIL = '00000000-0000-4000-8000-000000000000'
const CALLERS = {
  'signed out': { user: null },
  'normal user': { user: { id: 'u1', login: 'bob', role: 'user' } },
  admin: { user: { id: 'u2', login: 'shaked', role: 'admin', admin: true } }
}

function stub(me) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url) => {
      const path = String(url).split('?')[0]
      if (path === '/api/auth/me') return { ok: true, json: async () => me }
      if (path === '/api/drafts') return { ok: true, json: async () => ({ drafts: [], next_cursor: null }) }
      return { ok: false, status: 404, json: async () => ({}) }
    })
  )
}

async function visit(path, me) {
  window.history.pushState({}, '', path)
  stub(me)
  render(<App />)
  await screen.findByText(/./)
  await waitFor(() => expect(document.querySelector('.loading')).toBeNull())
  return window.location.pathname
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  window.history.pushState({}, '', '/')
})

describe('the admin pages by caller', () => {
  for (const page of adminPages()) {
    const url = page.replace(':id', NIL)
    for (const name of ['signed out', 'normal user']) {
      it(`${page} as ${name} lands where an unknown path lands`, async () => {
        const unknown = await visit('/zz-no-such-page', CALLERS[name])
        cleanup()
        expect(await visit(url, CALLERS[name])).toBe(unknown)
        expect(screen.queryByRole('navigation', { name: 'Admin pages' })).toBeNull()
        expect(document.body.textContent).not.toMatch(/Audit log|Feature flags|Statistics|Changelog/)
      })
    }
    it(`${page} as admin opens the admin area`, async () => {
      const at = await visit(url, CALLERS.admin)
      expect(at).toBe(page === '/changelog' ? '/admin/changelog' : url)
      expect(await screen.findByRole('navigation', { name: 'Admin pages' })).toBeInTheDocument()
    })
  }
})
