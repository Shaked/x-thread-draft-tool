import { useState } from 'react'
import { draftsApi } from '../utils/api'
import Button from '../ui/Button'
import { useToast } from '../ui/Toast'

/** Agent link: a one-time markdown link for an agent, copied to the clipboard. The toast confirms it. */
export default function AgentLinkButton({ draftId }) {
  const [busy, setBusy] = useState(false)
  const toast = useToast()

  const handleCreate = async () => {
    if (busy) return
    setBusy(true)
    try {
      const token = await draftsApi.createShareToken(draftId)
      if (!token) throw new Error('No token returned')

      const appOrigin = window.location.origin.replace(/\/$/, '')
      const url = `${appOrigin}/api/share/${token}.md`
      await navigator.clipboard.writeText(url)

      toast({ message: 'One-time markdown link copied. It works once, within 1 hour.', tone: 'success' })
    } catch (err) {
      console.error('Agent link error:', err)
      toast({ message: err.message || 'Failed to create link', tone: 'danger' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Button
      variant="secondary"
      icon="agent"
      loading={busy}
      onClick={handleCreate}
      title="Copy one-time markdown link for agents"
      ariaLabel="Copy one-time agent link"
    >
      Agent link
    </Button>
  )
}
