import { useEffect, useRef, useState } from 'react'
import { draftsApi } from '../utils/api'

// The lifetimes the Share menu offers. One hour is the default.
const LIFETIMES = [
  { label: '15 minutes', seconds: 15 * 60 },
  { label: '1 hour', seconds: 60 * 60, isDefault: true },
  { label: '1 day', seconds: 24 * 60 * 60 },
  { label: '7 days', seconds: 7 * 24 * 60 * 60 }
]

/** Share: a reusable read link with a chosen lifetime, copied to the clipboard. */
export default function ShareLinkButton({ draftId }) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(null)
  const [error, setError] = useState(null)
  const container = useRef(null)

  // The menu closes on Escape and on a click outside it.
  useEffect(() => {
    if (!open) return undefined
    const onKey = (event) => {
      if (event.key === 'Escape') setOpen(false)
    }
    const onPointer = (event) => {
      if (container.current && !container.current.contains(event.target)) setOpen(false)
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('pointerdown', onPointer)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('pointerdown', onPointer)
    }
  }, [open])

  const share = async (lifetime) => {
    if (busy) return
    setOpen(false)
    setBusy(true)
    setError(null)
    try {
      const token = await draftsApi.createShareToken(draftId, { expires_in: lifetime.seconds, one_time: false })
      if (!token) throw new Error('No token returned')

      const appOrigin = window.location.origin.replace(/\/$/, '')
      await navigator.clipboard.writeText(`${appOrigin}/x-thread-preview/${token}`)

      setCopied(lifetime.label)
      setTimeout(() => setCopied(null), 2500)
    } catch (err) {
      console.error('Share link error:', err)
      setError(err.message || 'Failed to create link')
      setTimeout(() => setError(null), 3500)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="share-button-container" ref={container}>
      <button
        className="share-btn icon-btn"
        onClick={() => setOpen(!open)}
        disabled={busy}
        aria-haspopup="dialog"
        aria-controls="share-menu"
        aria-expanded={open}
        title="Share a link that stops working after a set time"
        aria-label="Share"
      >
        <span className="btn-icon">{copied ? '✓' : '🔗'}</span>
        <span className="btn-text">{copied ? 'Copied!' : busy ? '...' : 'Share'}</span>
      </button>
      {open && (
        <div className="share-menu" id="share-menu" role="group" aria-label="Link valid for">
          <p className="share-menu-title">Link valid for</p>
          {LIFETIMES.map((lifetime) => (
            <button key={lifetime.label} className="share-menu-item" onClick={() => share(lifetime)}>
              {lifetime.label}
              {lifetime.isDefault ? ' (default)' : ''}
            </button>
          ))}
        </div>
      )}
      {copied && (
        <div className="share-tooltip" role="status" aria-live="polite">
          Link copied. It stops working in {copied}.
        </div>
      )}
      {error && (
        <div className="share-tooltip share-tooltip-error" role="alert">
          {error}
        </div>
      )}
    </div>
  )
}
