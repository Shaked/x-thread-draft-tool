import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import Dialog, { ConfirmProvider, useConfirm } from '../../src/ui/Dialog.jsx'
import { ToastProvider, useToast } from '../../src/ui/Toast.jsx'

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

describe('Dialog and useConfirm', () => {
  it('traps focus, closes on Escape, makes #root inert and returns focus to the opener', async () => {
    const user = userEvent.setup()
    const onResult = vi.fn()
    render(
      <ConfirmProvider>
        <Host onResult={onResult} />
      </ConfirmProvider>
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
      <ConfirmProvider>
        <Host onResult={onResult} />
      </ConfirmProvider>
    )
    await user.click(screen.getByRole('button', { name: 'Open' }))
    await user.click(screen.getByRole('button', { name: 'Delete' }))
    expect(onResult).toHaveBeenCalledWith(true)
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
