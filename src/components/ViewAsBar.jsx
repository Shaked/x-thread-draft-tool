import { useEffect, useState } from 'react'
import Banner from '../ui/Banner'
import Button from '../ui/Button'
import { adminApi } from '../utils/api'
import { useViewAs } from '../utils/viewAs'
import './ViewAsBar.css'

// A full page load, never a client navigation: none of the target's data may stay in React state.
const leave = (userId) => window.location.assign(`/admin/users/${encodeURIComponent(userId)}`)

// setTimeout runs at once for a delay above this (about 24.8 days), so a longer wait is made in steps.
const MAX_DELAY_MS = 2 ** 31 - 1
// The end time is the server's clock and the delay is this device's. A device clock that runs ahead must not reload the page
// again and again before Cancel can be used, so the timer never fires sooner than this.
const MIN_DELAY_MS = 15 * 1000

const timeOf = (iso) => {
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? 'soon' : date.toISOString().slice(11, 16) + ' UTC'
}

// The one fixed bar shown on every page while the admin views as a user (#291). Cancel ends it on the server, then reloads.
// A timer does the same at `expires_at`: `me` is read only once at app load, so nothing else would notice the end.
export default function ViewAsBar() {
  const viewAs = useViewAs()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const expiresAt = viewAs ? new Date(viewAs.expires_at).getTime() : null
  const userId = viewAs?.user_id

  useEffect(() => {
    if (expiresAt === null || Number.isNaN(expiresAt)) return undefined
    let timer
    const wait = () => {
      const remaining = expiresAt - Date.now()
      if (remaining > MAX_DELAY_MS) timer = setTimeout(wait, MAX_DELAY_MS)
      else timer = setTimeout(() => leave(userId), Math.max(MIN_DELAY_MS, remaining))
    }
    wait()
    return () => clearTimeout(timer)
  }, [expiresAt, userId])

  if (!viewAs) return null

  // The page is left only after the server ended viewing. On a failure it stays, with the reason, so Cancel can be tried again.
  const cancel = async () => {
    setBusy(true)
    setError(null)
    try {
      await adminApi.endViewAs()
    } catch (err) {
      setError(err.code === 'sign_in_cancelled' ? 'You did not sign in, so viewing did not end.' : err.message || 'The server did not answer. Try again.')
      setBusy(false)
      return
    }
    leave(userId)
  }

  return (
    <Banner
      tone="warning"
      sticky
      actions={<Button variant="secondary" size="sm" loading={busy} onClick={cancel}>Cancel</Button>}
    >
      <span className="view-as-bar__text">
        Viewing as <bdi dir="auto" className="view-as-bar__login">{viewAs.login}</bdi>
        <span className="view-as-bar__more"> · read-only · ends {timeOf(viewAs.expires_at)}</span>
      </span>
      {error && <span role="alert" className="view-as-bar__error"> {error}</span>}
    </Banner>
  )
}
