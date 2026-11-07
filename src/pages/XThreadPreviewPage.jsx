import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'

export default function XThreadPreviewPage() {
  const { token } = useParams()
  const [error, setError] = useState(null)

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

        const html = await res.text()
        if (!res.ok) {
          throw new Error(`Preview link failed (${res.status})`)
        }

        if (cancelled) return
        document.open()
        document.write(html)
        document.close()
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
        <div className="loading">{error}</div>
      </div>
    )
  }

  return (
    <div className="app loading-screen">
      <div className="loading">Loading preview…</div>
    </div>
  )
}
