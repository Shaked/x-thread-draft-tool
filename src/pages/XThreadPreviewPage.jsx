import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'

export default function XThreadPreviewPage() {
  const { token } = useParams()
  const [error, setError] = useState(null)

  useEffect(() => {
    let cancelled = false

    const load = async () => {
      try {
        const supabaseUrl = import.meta.env.VITE_SUPABASE_URL?.replace(/\/$/, '')
        if (!supabaseUrl) throw new Error('Missing VITE_SUPABASE_URL')
        if (!token) throw new Error('Missing token')

        const res = await fetch(`${supabaseUrl}/functions/v1/share/${token}?format=html`, {
          method: 'GET',
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
