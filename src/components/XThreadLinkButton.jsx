import { useState } from 'react'
import { supabase } from '../utils/supabase'

export default function XThreadLinkButton({ draftId }) {
  const [copied, setCopied] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  const handleCreate = async () => {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      const { data, error: rpcError } = await supabase.rpc('create_share_token', {
        p_draft_id: draftId
      })
      if (rpcError) throw rpcError

      const token = typeof data === 'string' ? data : data?.token
      if (!token) throw new Error('No token returned')

      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL.replace(/\/$/, '')
      const url = `${supabaseUrl}/functions/v1/share/${token}.html`
      await navigator.clipboard.writeText(url)

      setCopied(true)
      setTimeout(() => setCopied(false), 2500)
    } catch (err) {
      console.error('X thread link error:', err)
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
        title="Copy one-time X-thread preview link"
        aria-label="Copy one-time X thread link"
      >
        <span className="btn-icon">{copied ? '✓' : '𝕏'}</span>
        <span className="btn-text">{copied ? 'Copied!' : busy ? '...' : 'X Thread'}</span>
      </button>
      {copied && (
        <div className="share-tooltip">
          One-time X-thread link copied. It works exactly once.
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
