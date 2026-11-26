import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ToastProvider, useToast } from '../../src/ui/Toast.jsx'
import { KIT_KEY } from '../../src/utils/skin.js'

// The toast behind the "Components" feature flag (#406, Rare UI toast), through the provider in src/ui/Toast.jsx.
// The Rare stack loads in its own chunk, so the flag-on tests wait for it before they press the button.
function Ask({ message, tone }) {
  const toast = useToast()
  return (
    <button type="button" onClick={() => toast({ message, tone })}>
      Ask
    </button>
  )
}

const renderWith = (props) => render(<ToastProvider><Ask {...props} /></ToastProvider>)
// The stack's section is mounted with the Rare chunk; its list (data-sonner-toaster) exists only while a message shows.
const stack = () => document.querySelector('section[aria-label^="Notifications"]')
const card = () => document.querySelector('.ui-rare-toast')

describe('Toast (Rare UI, feature flag)', () => {
  beforeAll(() => {
    // jsdom has no pointer capture; sonner calls it when a press starts on a toast (browsers have it).
    Element.prototype.setPointerCapture ??= () => {}
    Element.prototype.releasePointerCapture ??= () => {}
  })
  beforeEach(() => localStorage.clear())
  afterEach(() => {
    cleanup()
    localStorage.clear()
    vi.useRealTimers()
  })

  it('shows the message as today with the flag off, and no Rare UI stack', async () => {
    const user = userEvent.setup()
    renderWith({ message: 'Thread copied!', tone: 'success' })
    await user.click(screen.getByRole('button', { name: 'Ask' }))
    expect(screen.getByRole('status')).toHaveTextContent('Thread copied!')
    expect(stack()).toBeNull()
    expect(card()).toBeNull()
  })

  it('shows a success message as a visible status card, with the flag on', async () => {
    localStorage.setItem(KIT_KEY, 'rare')
    const user = userEvent.setup()
    renderWith({ message: 'Thread copied!', tone: 'success' })
    await waitFor(() => expect(stack()).not.toBeNull())
    await user.click(screen.getByRole('button', { name: 'Ask' }))
    await waitFor(() => expect(card()).not.toBeNull())
    // What a sighted user sees: the text is on screen (not in an sr-only span), with a check mark and no close button.
    const text = card().querySelector('p')
    expect(text.closest('.sr-only')).toBeNull()
    expect(text).toHaveTextContent('Thread copied!')
    expect(card().querySelector('svg path')).not.toBeNull()
    expect(card().querySelector('button')).toBeNull()
    expect(card()).toHaveAttribute('role', 'status')
    expect(document.querySelector('[role="alert"]')).toBeNull()
  })

  it('keeps a danger message until its 44 px close button is pressed, with the flag on', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    localStorage.setItem(KIT_KEY, 'rare')
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    renderWith({ message: 'Failed to copy to clipboard', tone: 'danger' })
    await waitFor(() => expect(stack()).not.toBeNull())
    await user.click(screen.getByRole('button', { name: 'Ask' }))
    await waitFor(() => expect(card()).not.toBeNull())
    expect(card()).toHaveAttribute('role', 'alert')
    expect(card().querySelector('p')).toHaveTextContent('Failed to copy to clipboard')
    const close = screen.getByRole('button', { name: 'Close message' })
    // The close control is a visible glyph (not sr-only) on a 44 px token box, and it is not hidden on touch screens.
    expect(close.closest('.sr-only')).toBeNull()
    expect(close.querySelector('path')).not.toBeNull()
    expect(close.className).toContain('size-(--hit-min)')
    expect(close.className).not.toContain('hidden')
    act(() => vi.advanceTimersByTime(10000))
    expect(card()).not.toBeNull()
    await user.click(close)
    await waitFor(() => expect(card()).toBeNull())
  })

  it('clears a toast that showed the old way while the Rare chunk loaded, once a Rare toast takes over', async () => {
    const user = userEvent.setup()
    function Two() {
      const toast = useToast()
      return (
        <>
          <button type="button" onClick={() => toast({ message: 'Old failure', tone: 'danger' })}>
            Fail
          </button>
          <button type="button" onClick={() => toast({ message: 'All good', tone: 'success' })}>
            Pass
          </button>
        </>
      )
    }
    render(
      <ToastProvider>
        <Two />
      </ToastProvider>
    )
    // The flag is switched on after the provider mounted, so the first toast shows the old way while the chunk loads.
    localStorage.setItem(KIT_KEY, 'rare')
    await user.click(screen.getByRole('button', { name: 'Fail' }))
    expect(document.querySelector('.ui-toast--danger')).not.toBeNull()
    await waitFor(() => expect(stack()).not.toBeNull())
    await user.click(screen.getByRole('button', { name: 'Pass' }))
    await waitFor(() => expect(card()).not.toBeNull())
    expect(document.querySelector('.ui-toast--danger')).toBeNull()
    expect(screen.queryByText('Old failure')).toBeNull()
  })
})
