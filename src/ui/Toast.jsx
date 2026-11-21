import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import Button from './Button'
import './Toast.css'

const TOAST_MS = 4000
const ToastContext = createContext(null)

// Shows one toast at a time at the bottom of the screen, above the phone bar. It goes away after 4 s; a danger
// toast stays until it is closed. The two live regions are mounted empty at start (the toast inside gets its role when it shows), so the first message is announced.
// The provider sits above the routes, so a toast survives a navigation.
export function ToastProvider({ children }) {
  const [current, setCurrent] = useState(null)
  const timer = useRef(null)
  const counter = useRef(0)

  const hide = useCallback(() => {
    clearTimeout(timer.current)
    setCurrent(null)
  }, [])

  const toast = useCallback(
    ({ message, tone = 'neutral' }) => {
      clearTimeout(timer.current)
      counter.current += 1
      setCurrent({ id: counter.current, message, tone })
      if (tone !== 'danger') timer.current = setTimeout(() => setCurrent(null), TOAST_MS)
    },
    []
  )
  useEffect(() => () => clearTimeout(timer.current), [])

  const value = useMemo(() => toast, [toast])
  const danger = current?.tone === 'danger'
  return (
    <ToastContext.Provider value={value}>
      {children}
      {createPortal(
        <div className="ui-toast-region">
          <div aria-live="polite">
            {current && !danger && (
              <p key={current.id} role="status" className={`ui-toast ui-toast--${current.tone}`} dir="auto">
                {current.message}
              </p>
            )}
          </div>
          <div aria-live="assertive">
            {current && danger && (
              <div key={current.id} role="alert" className="ui-toast ui-toast--danger">
                <p className="ui-toast__message" dir="auto">
                  {current.message}
                </p>
                <Button variant="ghost" size="sm" ariaLabel="Close message" onClick={hide}>
                  Close
                </Button>
              </div>
            )}
          </div>
        </div>,
        document.body
      )}
    </ToastContext.Provider>
  )
}

export function useToast() {
  const toast = useContext(ToastContext)
  if (!toast) throw new Error('useToast needs a ToastProvider')
  return toast
}
