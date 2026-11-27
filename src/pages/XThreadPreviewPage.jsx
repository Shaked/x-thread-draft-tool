import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import Banner from '../ui/Banner'
import Button from '../ui/Button'
import Stack from '../ui/Stack'
import Page from '../ui/Page'
import Skeleton from '../ui/Skeleton'
import PreviewFrame from '../components/PreviewFrame'

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
      <Page width="narrow">
        <Stack gap={4}>
          <Banner tone="danger" role="alert">{error}</Banner>
          <Button variant="secondary" to="/">Back to Home</Button>
        </Stack>
      </Page>
    )
  }

  if (html !== null) return <PreviewFrame html={html} />

  return (
    <Page width="narrow">
      <Skeleton lines={3} />
    </Page>
  )
}
