import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { ToastProvider } from '../../src/ui/Toast.jsx'
import ExportOptions from '../../src/components/ExportOptions.jsx'
import { exportAsNumberedText } from '../../src/utils/exportFormats.js'

const posts = [
  { id: 'p1', text: 'First post', images: [], embeddedTweet: null },
  { id: 'p2', text: 'Second post', images: [], embeddedTweet: null }
]

function renderExport(list) {
  return render(
    <ToastProvider>
      <ExportOptions draft={{ title: 'T', posts: list }} />
    </ToastProvider>
  )
}

// Called after userEvent.setup(), which installs its own clipboard, so this one is the one used.
function mockClipboard() {
  const writeText = vi.fn().mockResolvedValue(undefined)
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText, readText: vi.fn().mockResolvedValue('') }
  })
  return writeText
}

describe('ExportOptions', () => {
  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('keeps the menu closed until Export is clicked, then shows the four actions', async () => {
    const user = userEvent.setup()
    renderExport(posts)
    expect(screen.queryByRole('menuitem', { name: 'Copy thread' })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Export' }))

    for (const label of ['Copy thread', 'Copy with numbers', 'Download Markdown', 'Download JSON']) {
      expect(screen.getByRole('menuitem', { name: label })).toBeInTheDocument()
    }
  })

  it('copies the numbered thread, alerts, and closes the menu', async () => {
    const user = userEvent.setup()
    const writeText = mockClipboard()
    renderExport(posts)

    await user.click(screen.getByRole('button', { name: 'Export' }))
    await user.click(screen.getByRole('menuitem', { name: 'Copy with numbers' }))

    await waitFor(() => expect(writeText).toHaveBeenCalledWith(exportAsNumberedText(posts)))
    expect(await screen.findByRole('status')).toHaveTextContent('Thread copied with numbers!')
    expect(screen.queryByRole('menuitem', { name: 'Copy with numbers' })).not.toBeInTheDocument()
  })

  it('closes the menu on Escape', async () => {
    const user = userEvent.setup()
    renderExport(posts)
    const exportButton = screen.getByRole('button', { name: 'Export' })

    await user.click(exportButton)
    expect(exportButton).toHaveAttribute('aria-expanded', 'true')
    await user.keyboard('{Escape}')

    expect(screen.queryByRole('menuitem', { name: 'Copy thread' })).not.toBeInTheDocument()
    expect(exportButton).toHaveAttribute('aria-expanded', 'false')
  })

  it('is disabled when the thread has no posts', () => {
    renderExport([])
    expect(screen.getByRole('button', { name: 'Export' })).toBeDisabled()
  })
})
