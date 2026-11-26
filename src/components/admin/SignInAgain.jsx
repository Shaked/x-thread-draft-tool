import { useCallback, useEffect, useRef, useState } from 'react'
import Banner from '../../ui/Banner'
import Dialog from '../../ui/Dialog'
import { setAdminSignInHandler } from '../../utils/api'

const POPUP_FEATURES = 'popup,width=520,height=720'

// The sign-in pop-up of the admin area (#552). An admin change whose browser sign-in is older than 7 days is refused by the
// server with the code `sign_in_again`; adminApi then calls the handler this component registers. The dialog asks for one click,
// which opens GitHub sign-in in a pop-up (a pop-up needs a click), and the answer is true when the pop-up has closed after
// signing in. adminApi repeats the change once itself; if the person closed the pop-up without signing in, that repeat is refused
// again and nothing is saved.
export default function SignInAgain({ children }) {
  const [asking, setAsking] = useState(false)
  const [notice, setNotice] = useState('')
  const resolver = useRef(null)
  const popup = useRef(null)
  const watcher = useRef(null)

  const finish = useCallback((value) => {
    clearInterval(watcher.current)
    window.removeEventListener('message', onMessage.current)
    resolver.current?.(value)
    resolver.current = null
    setAsking(false)
    setNotice('')
  }, [])
  const onMessage = useRef((event) => {
    if (event.origin === window.location.origin && event.data?.type === 'xt-signed-in') finish(true)
  })

  useEffect(
    () =>
      setAdminSignInHandler(
        () =>
          new Promise((resolve) => {
            resolver.current?.(false)
            resolver.current = resolve
            setAsking(true)
          })
      ),
    []
  )
  useEffect(
    () => () => {
      clearInterval(watcher.current)
      window.removeEventListener('message', onMessage.current)
      resolver.current?.(false)
    },
    []
  )

  const open = () => {
    const win = window.open('/api/auth/login?popup=1', 'xt-signin', POPUP_FEATURES)
    if (!win) {
      setNotice('The browser blocked the pop-up. Allow pop-ups for this site and click again.')
      return
    }
    popup.current = win
    setNotice('')
    window.addEventListener('message', onMessage.current)
    clearInterval(watcher.current)
    // The pop-up closes itself after signing in. Closed by hand, the repeat of the change is refused and nothing is saved.
    watcher.current = setInterval(() => {
      if (popup.current?.closed) finish(true)
    }, 400)
  }

  return (
    <>
      {children}
      {asking && (
        <Dialog
          open
          onClose={() => finish(false)}
          title="Sign in again to save"
          description="For safety, admin changes need a sign-in from the last 7 days. Sign in with GitHub in the pop-up, and your change is saved by itself."
          actions={[
            { label: 'Cancel', variant: 'secondary', onClick: () => finish(false) },
            { label: 'Sign in with GitHub', variant: 'primary', onClick: open, autoFocus: true }
          ]}
        >
          {notice && <Banner tone="danger" role="alert">{notice}</Banner>}
        </Dialog>
      )}
    </>
  )
}
