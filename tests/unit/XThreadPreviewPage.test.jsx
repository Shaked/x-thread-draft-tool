import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import XThreadPreviewPage from '../../src/pages/XThreadPreviewPage.jsx'

afterEach(() => vi.restoreAllMocks())

describe('XThreadPreviewPage', () => {
  it('shows the share HTML in a sandboxed iframe and never calls document.write', async () => {
    const write = vi.spyOn(document, 'write')
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<p>hello</p>', { status: 200 })))
    render(
      <MemoryRouter initialEntries={['/x-thread-preview/tok']}>
        <Routes><Route path="/x-thread-preview/:token" element={<XThreadPreviewPage />} /></Routes>
      </MemoryRouter>
    )
    const frame = await screen.findByTitle('Thread preview')
    const sandbox = frame.getAttribute('sandbox')
    expect(sandbox).not.toBeNull()
    expect(sandbox).not.toContain('allow-same-origin')
    expect(sandbox).not.toContain('allow-scripts')
    expect(frame.getAttribute('srcdoc')).toBe('<p>hello</p>')
    expect(write).not.toHaveBeenCalled()
  })
})
