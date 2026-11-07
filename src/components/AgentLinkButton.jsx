import { useState } from 'react'
import { draftsApi } from '../utils/api'

export default function AgentLinkButton({ draftId }) {
  const [copied, setCopied] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  const handleCreate = async () => {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      const token = await draftsApi.createShareToken(draftId)
      if (!token) throw new Error('No token returned')

      const appOrigin = window.location.origin.replace(/\/$/, '')
      const url = `${appOrigin}/api/share/${token}.md`
      await navigator.clipboard.writeText(url)

      setCopied(true)
      setTimeout(() => setCopied(false), 2500)
    } catch (err) {
      console.error('Agent link error:', err)
      setError(err.message || 'Failed to create link')
      setTimeout(() => setError(null), 3500)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="share-button-container">
      <button
        className="share-btn icon-btn"
        onClick={handleCreate}
        disabled={busy}
        title="Copy one-time markdown link for agents"
        aria-label="Copy one-time agent link"
      >
        <span className="btn-icon">{copied ? '✓' : '🤖'}</span>
        <span className="btn-text">{copied ? 'Copied!' : busy ? '...' : 'Agent'}</span>
      </button>
      {copied && (
        <div className="share-tooltip">
          One-time markdown link copied. It works exactly once.
        </div>
      )}
      {error && (
        <div className="share-tooltip share-tooltip-error">
          {error}
        </div>
      )}
    </div>
  )
}
