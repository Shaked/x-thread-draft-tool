import { createContext, useCallback, useContext, useEffect, useId, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useLocation } from 'react-router-dom'
import Button from './Button'
import './Dialog.css'

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

// A modal dialog in a portal on <body>, outside #root. While it is open #root is inert (set through the DOM,
// React 18.2 has no `inert` prop) and the page does not scroll. Tab stays inside, Escape and the scrim close it
// (unless `dismissible` is false), and focus goes back to the element that was focused when it opened.
// `actions`: [{ label, variant, onClick, autoFocus, disabledReason, loading, disabled }]; the one with `autoFocus` gets focus first.
// `disabledReason` keeps the button focusable and shows the reason (see Button); `loading` ignores clicks.
// `placement`: 'center' (default) or 'sheet-start', a drawer on the inline start edge (the app menu).
// Focus goes to the first element inside `[data-autofocus]` when there is one (a link or a button), else the first control.
// `returnTo`: a ref to the element that focus returns to on close (optional).
export default function Dialog({ open, onClose, title, description, children, actions = [], dismissible = true, placement = 'center', id, returnTo }) {
  const panel = useRef(null)
  const titleId = useId()
  const descriptionId = useId()
  // Latest values for the effect below, which must run only when the dialog opens or closes.
  const latest = useRef({ onClose, dismissible, returnTo })
  useEffect(() => {
    latest.current = { onClose, dismissible, returnTo }
  })

  useEffect(() => {
    if (!open) return undefined
    const root = document.getElementById('root')
    // Focus goes back to `returnTo` when given (a button that Safari does not focus on click), else to what had focus.
    const opener = latest.current.returnTo?.current ?? document.activeElement
    root?.setAttribute('inert', '')
    document.documentElement.classList.add('dialog-open')
    const box = panel.current
    const start = box?.querySelector('[data-autofocus] a, [data-autofocus] button') ?? box?.querySelector(FOCUSABLE) ?? box
    start?.focus()
    const onKey = (event) => {
      if (event.key === 'Escape' && latest.current.dismissible) {
        event.preventDefault()
        latest.current.onClose?.()
        return
      }
      if (event.key !== 'Tab' || !box) return
      const items = [...box.querySelectorAll(FOCUSABLE)]
      if (items.length === 0) {
        event.preventDefault()
        return
      }
      const at = items.indexOf(document.activeElement)
      const next = event.shiftKey ? (at <= 0 ? items.length - 1 : at - 1) : at < 0 || at === items.length - 1 ? 0 : at + 1
      event.preventDefault()
      items[next].focus()
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
      root?.removeAttribute('inert')
      document.documentElement.classList.remove('dialog-open')
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus()
    }
  }, [open])

  if (!open) return null
  return createPortal(
    <div className={placement === 'sheet-start' ? 'ui-dialog ui-dialog--sheet-start' : 'ui-dialog'}>
      <div className="ui-dialog__scrim" onClick={dismissible ? onClose : undefined} />
      <div
        ref={panel}
        id={id}
        className="ui-dialog__panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        tabIndex={-1}
      >
        <h2 id={titleId} className="ui-dialog__title" dir="auto">
          {title}
        </h2>
        {description && (
          <p id={descriptionId} className="ui-dialog__description" dir="auto">
            {description}
          </p>
        )}
        {children}
        {actions.length > 0 && (
          <div className="ui-dialog__actions">
            {actions.map((action) => (
              <span key={action.label} className="ui-dialog__action" data-autofocus={action.autoFocus ? '' : undefined}>
                <Button variant={action.variant ?? 'secondary'} onClick={action.onClick} disabledReason={action.disabledReason} loading={action.loading} disabled={action.disabled}>
                  {action.label}
                </Button>
              </span>
            ))}
          </div>
        )}
      </div>
    </div>,
    document.body
  )
}

const ConfirmContext = createContext(null)

// Mounts the confirm dialog once. `confirm({ title, body, confirmLabel, tone }) → Promise<boolean>`:
// true for the confirm button, false for Cancel, Escape, the scrim or leaving the page (it sits inside the router). A destructive ('danger') dialog focuses Cancel.
export function ConfirmProvider({ children }) {
  const [request, setRequest] = useState(null)
  const confirm = useCallback(
    (options) =>
      new Promise((resolve) => {
        setRequest({ ...options, resolve })
      }),
    []
  )
  const answer = (value) => {
    request?.resolve(value)
    setRequest(null)
  }
  // A question belongs to the page that asked it: going there and back (browser Back) answers "no".
  const { pathname } = useLocation()
  const openedAt = useRef(pathname)
  useEffect(() => {
    if (openedAt.current === pathname) return
    openedAt.current = pathname
    setRequest((current) => {
      current?.resolve(false)
      return null
    })
  }, [pathname])
  const danger = request?.tone === 'danger'
  const value = useMemo(() => confirm, [confirm])
  return (
    <ConfirmContext.Provider value={value}>
      {children}
      <Dialog
        open={request !== null}
        onClose={() => answer(false)}
        title={request?.title}
        description={request?.body}
        actions={[
          { label: 'Cancel', variant: 'secondary', onClick: () => answer(false), autoFocus: danger },
          { label: request?.confirmLabel ?? 'OK', variant: danger ? 'danger' : 'primary', onClick: () => answer(true), autoFocus: !danger }
        ]}
      />
    </ConfirmContext.Provider>
  )
}

export function useConfirm() {
  const confirm = useContext(ConfirmContext)
  if (!confirm) throw new Error('useConfirm needs a ConfirmProvider')
  return confirm
}
