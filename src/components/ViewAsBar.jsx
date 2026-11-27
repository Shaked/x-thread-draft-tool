import { useEffect, useState } from 'react'
import Banner from '../ui/Banner'
import Button from '../ui/Button'
import { adminApi } from '../utils/api'
import { useViewAs } from '../utils/viewAs'
import './ViewAsBar.css'

// A full page load, never a client navigation: none of the target's data may stay in React state.
const leave = (userId) => window.location.assign(`/admin/users/${encodeURIComponent(userId)}`)

// setTimeout runs at once for a delay above this (about 24.8 days), which here would reload the page in a loop.
const MAX_DELAY_MS = 2 ** 31 - 1

const timeOf = (iso) => new Date(iso).toISOString().slice(11, 16) + ' UTC'

// The one fixed bar shown on every page while the admin views as a user (#291). Cancel ends it on the server, then reloads.
// A timer does the same at `expires_at`: `me` is read only once at app load, so nothing else would notice the end.
export default function ViewAsBar() {
  const viewAs = useViewAs()
  const [busy, setBusy] = useState(false)
  const expiresAt = viewAs ? new Date(viewAs.expires_at).getTime() : null
  const userId = viewAs?.user_id

  useEffect(() => {
    if (expiresAt === null) return undefined
    const timer = setTimeout(() => leave(userId), Math.min(MAX_DELAY_MS, Math.max(0, expiresAt - Date.now())))
    return () => clearTimeout(timer)
  }, [expiresAt, userId])

  if (!viewAs) return null

  const cancel = async () => {
    setBusy(true)
    try {
      await adminApi.endViewAs()
    } catch (err) {
      // The server may have refused or not answered. The cookie also ends at its own expiry, so still leave.
      console.error('Could not end viewing:', err)
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
    </Banner>
  )
}
