import { useState } from 'react'
import { draftsApi } from '../utils/api'
import Menu from '../ui/Menu'
import { useToast } from '../ui/Toast'

// The lifetimes the Share menu offers. One hour is the default.
const LIFETIMES = [
  { label: '15 minutes', seconds: 15 * 60 },
  { label: '1 hour', seconds: 60 * 60, isDefault: true },
  { label: '1 day', seconds: 24 * 60 * 60 },
  { label: '7 days', seconds: 7 * 24 * 60 * 60 }
]

/** Share: a menu of link lifetimes. The chosen reusable read link is copied to the clipboard and a toast says when it stops. */
export default function ShareLinkButton({ draftId }) {
  const [busy, setBusy] = useState(false)
  const toast = useToast()

  const share = async (lifetime) => {
    if (busy) return
    setBusy(true)
    try {
      const token = await draftsApi.createShareToken(draftId, { expires_in: lifetime.seconds, one_time: false })
      if (!token) throw new Error('No token returned')

      const appOrigin = window.location.origin.replace(/\/$/, '')
      await navigator.clipboard.writeText(`${appOrigin}/x-thread-preview/${token}`)

      toast({ message: `Link copied. It stops working in ${lifetime.label}.`, tone: 'success' })
    } catch (err) {
      console.error('Share link error:', err)
      toast({ message: err.message || 'Failed to create link', tone: 'danger' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Menu
      title="Link valid for"
      trigger={{ label: 'Share', icon: 'share', variant: 'secondary', loading: busy, title: 'Share a link that stops working after a set time' }}
      items={LIFETIMES.map((lifetime) => ({
        label: lifetime.isDefault ? `${lifetime.label} (default)` : lifetime.label,
        onSelect: () => share(lifetime)
      }))}
    />
  )
}
