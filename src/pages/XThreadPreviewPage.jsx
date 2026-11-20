import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'

export default function XThreadPreviewPage() {
  const { token } = useParams()
  const [error, setError] = useState(null)
  const [html, setHtml] = useState(null)

  useEffect(() => {
    let cancelled = false

    const load = async () => {
      try {
        if (!token) throw new Error('Missing token')

        const res = await fetch(`/api/share/${encodeURIComponent(token)}?format=html`, {
          method: 'GET',
          credentials: 'same-origin',
          headers: { Accept: 'text/html' }
        })

        const text = await res.text()
        if (!res.ok) {
          throw new Error(`Preview link failed (${res.status})`)
        }

        if (cancelled) return
        setHtml(text)
      } catch (err) {
        if (!cancelled) setError(err.message || 'Failed to load preview')
      }
    }

    load()
    return () => {
      cancelled = true
    }
  }, [token])

  if (error) {
    return (
      <div className="app loading-screen">
        <div className="loading" role="alert">{error}</div>
      </div>
    )
  }

  if (html !== null) {
    // The share HTML is user content. A sandbox without allow-same-origin and allow-scripts keeps it
    // away from this origin's cookie and fetch.
    return (
      <iframe
        title="Thread preview"
        sandbox="allow-popups allow-popups-to-escape-sandbox"
        srcDoc={html}
        style={{ position: 'fixed', inset: 0, width: '100%', height: '100%', border: 0 }}
      />
    )
  }

  return (
    <div className="app loading-screen">
      <div className="loading" role="status" aria-live="polite">Loading preview…</div>
    </div>
  )
}
