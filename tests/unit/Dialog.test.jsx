import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { MemoryRouter, useNavigate } from 'react-router-dom'
import Dialog, { ConfirmProvider, useConfirm } from '../../src/ui/Dialog.jsx'
import { ToastProvider, useToast } from '../../src/ui/Toast.jsx'
import { useOldLook } from './helpers/useOldLook.js'

function Host({ onResult }) {
  const confirm = useConfirm()
  return (
    <div id="root">
      <button onClick={async () => onResult(await confirm({ title: 'Delete?', body: 'Sure?', confirmLabel: 'Delete', tone: 'danger' }))}>Open</button>
    </div>
  )
}

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

function Stacked() {
  const [top, setTop] = useState(true)
  return (
    <div>
      <div id="root">page</div>
      <Dialog open title="Lower" onClose={() => {}} actions={[{ label: 'Lower action' }]} />
      {top && <Dialog open title="Upper" onClose={() => setTop(false)} actions={[{ label: 'Upper cancel', autoFocus: true }, { label: 'Upper go' }]} />}
    </div>
  )
}

describe('Dialog and useConfirm', () => {
  it('stacked dialogs: only the top one handles Tab, and the page stays locked until the last one closes', async () => {
    const user = userEvent.setup()
    render(<Stacked />)
    expect(screen.getByRole('button', { name: 'Upper cancel' })).toHaveFocus()
    await user.tab()
    expect(screen.getByRole('button', { name: 'Upper go' })).toHaveFocus()
    await user.keyboard('{Escape}')
    expect(screen.queryByText('Upper')).toBeNull()
    expect(document.getElementById('root')).toHaveAttribute('inert')
    expect(document.documentElement.classList.contains('dialog-open')).toBe(true)
  })


  it('traps focus, closes on Escape, makes #root inert and returns focus to the opener', async () => {
    const user = userEvent.setup()
    const onResult = vi.fn()
    render(
      <MemoryRouter>
        <ConfirmProvider>
          <Host onResult={onResult} />
        </ConfirmProvider>
      </MemoryRouter>
    )
    const opener = screen.getByRole('button', { name: 'Open' })
    await user.click(opener)
    expect(screen.getByRole('dialog', { name: 'Delete?' })).toHaveTextContent('Sure?')
    expect(document.getElementById('root')).toHaveAttribute('inert')
    // A destructive dialog focuses Cancel; Tab stays inside.
    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus()
    await user.tab()
    expect(screen.getByRole('button', { name: 'Delete' })).toHaveFocus()
    await user.tab()
    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus()
    await user.keyboard('{Escape}')
    expect(onResult).toHaveBeenCalledWith(false)
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(document.getElementById('root')).not.toHaveAttribute('inert')
    expect(opener).toHaveFocus()
  })

  it('resolves true for the confirm button', async () => {
    const user = userEvent.setup()
    const onResult = vi.fn()
    render(
      <MemoryRouter>
        <ConfirmProvider>
          <Host onResult={onResult} />
        </ConfirmProvider>
      </MemoryRouter>
    )
    await user.click(screen.getByRole('button', { name: 'Open' }))
    await user.click(screen.getByRole('button', { name: 'Delete' }))
    expect(onResult).toHaveBeenCalledWith(true)
  })

  it('answers false and closes when the route changes while it is open', async () => {
    const user = userEvent.setup()
    const onResult = vi.fn()
    function Leave() {
      const navigate = useNavigate()
      return <button onClick={() => navigate('/elsewhere')}>Leave</button>
    }
    render(
      <MemoryRouter>
        <ConfirmProvider>
          <Host onResult={onResult} />
          <Leave />
        </ConfirmProvider>
      </MemoryRouter>
    )
    await user.click(screen.getByRole('button', { name: 'Open' }))
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    // The page behind is inert, so the route change comes from outside (browser Back), here through the router.
    document.getElementById('root').removeAttribute('inert')
    await user.click(screen.getByRole('button', { name: 'Leave' }))
    expect(onResult).toHaveBeenCalledWith(false)
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('ignores Escape when it is not dismissible', async () => {
    const user = userEvent.setup()
    function Fixed() {
      const [open, setOpen] = useState(true)
      return <Dialog open={open} onClose={() => setOpen(false)} title="Stay" dismissible={false} actions={[{ label: 'OK', onClick: () => setOpen(false) }]} />
    }
    render(<Fixed />)
    await user.keyboard('{Escape}')
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })
})

describe('Toast', () => {
  function Fire() {
    const toast = useToast()
    return (
      <>
        <button onClick={() => toast({ message: 'Thread copied!', tone: 'success' })}>ok</button>
        <button onClick={() => toast({ message: 'Failed to copy', tone: 'danger' })}>bad</button>
      </>
    )
  }

  it('hides a success toast after 4 s; a danger toast stays until closed', async () => {
    // The old toast's timing; the Rare UI toast (default) has its own tests in rare-toast.test.jsx and loads late here.
    useOldLook()
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    render(
      <ToastProvider>
        <Fire />
      </ToastProvider>
    )
    expect(screen.queryByRole('status')).toBeNull()
    await user.click(screen.getByRole('button', { name: 'ok' }))
    expect(screen.getByRole('status')).toHaveTextContent('Thread copied!')
    await act(async () => {
      await vi.advanceTimersByTimeAsync(4100)
    })
    expect(screen.queryByRole('status')).toBeNull()
    await user.click(screen.getByRole('button', { name: 'bad' }))
    expect(screen.getByRole('alert')).toHaveTextContent('Failed to copy')
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10000)
    })
    expect(screen.getByRole('alert')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Close message' }))
    expect(screen.queryByRole('alert')).toBeNull()
  })
})
