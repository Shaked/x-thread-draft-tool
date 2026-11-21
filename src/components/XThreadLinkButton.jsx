import { useState } from 'react'
import { draftsApi } from '../utils/api'
import Button from '../ui/Button'
import { useToast } from '../ui/Toast'

/** X Thread: a one-time preview link for the thread, copied to the clipboard. The toast confirms it. */
export default function XThreadLinkButton({ draftId }) {
  const [busy, setBusy] = useState(false)
  const toast = useToast()

  const handleCreate = async () => {
    if (busy) return
    setBusy(true)
    try {
      const token = await draftsApi.createShareToken(draftId)
      if (!token) throw new Error('No token returned')

      const appOrigin = window.location.origin.replace(/\/$/, '')
      const url = `${appOrigin}/x-thread-preview/${token}`
      await navigator.clipboard.writeText(url)

      toast({ message: 'One-time X-thread link copied. It works once, within 1 hour.', tone: 'success' })
    } catch (err) {
      console.error('X thread link error:', err)
      toast({ message: err.message || 'Failed to create link', tone: 'danger' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Button
      variant="secondary"
      icon="x"
      loading={busy}
      onClick={handleCreate}
      title="Copy one-time X-thread preview link"
      ariaLabel="Copy one-time X thread link"
    >
      X Thread
    </Button>
  )
}
