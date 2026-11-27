import { useCallback, useEffect, useRef, useState } from 'react'
import { compressImage } from '../utils/compressImage'
import Banner from '../ui/Banner'
import UploadArea from '../components/UploadArea'
import Page from '../ui/Page'
import Stack from '../ui/Stack'

const MAX_FILE_SIZE = 5 * 1024 * 1024 // as the editor: 5 MB before the resize
const DEAD = 'This link has expired or was already used. Ask for a new one.'

// The page of a one-time upload link (#418). It works without signing in: the token after # is the credential.
// A fragment never reaches a server or a log, so the token goes only in the Authorization header of its own calls.
// It shows the post number, the free slots and the thumbnails of this page's own uploads. Never the draft title or text.
const tokenOfHash = () => decodeURIComponent(window.location.hash.replace(/^#/, ''))

async function call(token, path, init = {}) {
  const res = await fetch(`/api${path}`, { ...init, headers: { ...init.headers, authorization: `Bearer ${token}` }, referrerPolicy: 'no-referrer' })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw Object.assign(new Error(res.status === 410 ? DEAD : body.error || 'The upload failed. Try again.'), { status: res.status })
  return body
}

export default function UploadPage() {
  const [token] = useState(tokenOfHash)
  const [info, setInfo] = useState(null)
  const [dead, setDead] = useState(token === '')
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  const [thumbs, setThumbs] = useState([])
  const remaining = info?.remaining ?? 0
  const thumbsRef = useRef(thumbs)
  useEffect(() => {
    thumbsRef.current = thumbs
  }, [thumbs])

  useEffect(() => {
    if (!token) return
    call(token, '/upload-links')
      .then(setInfo)
      .catch(() => setDead(true))
  }, [token])

  useEffect(() => () => thumbsRef.current.forEach((src) => URL.revokeObjectURL(src)), [])

  const addFiles = useCallback(
    async (files) => {
      const list = Array.from(files)
      if (busy || dead || list.length === 0) return
      setError(null)
      if (list.length > remaining) return setError(`You can add ${remaining} more ${remaining === 1 ? 'image' : 'images'}.`)
      if (list.some((file) => !file.type.startsWith('image/'))) return setError('Only image files are allowed.')
      if (list.some((file) => file.size > MAX_FILE_SIZE)) return setError('Image size must be less than 5MB.')
      setBusy(true)
      let left = remaining
      try {
        for (const file of list) {
          const small = await compressImage(file)
          const sent = await call(token, '/upload-links/images', { method: 'POST', headers: { 'content-type': small.type }, body: small })
          left = sent.remaining
          setThumbs((all) => [...all, URL.createObjectURL(small)])
          setInfo((current) => ({ ...current, remaining: left }))
        }
      } catch (err) {
        if (err.status === 410) setDead(true)
        else setError(err.message || 'The upload failed. Try again.')
      } finally {
        setBusy(false)
      }
    },
    [busy, dead, remaining, token]
  )

  useEffect(() => {
    const onPaste = (event) => {
      const files = Array.from(event.clipboardData?.files ?? []).filter((file) => file.type.startsWith('image/'))
      if (files.length) addFiles(files)
    }
    document.addEventListener('paste', onPaste)
    return () => document.removeEventListener('paste', onPaste)
  }, [addFiles])

  if (dead && thumbs.length === 0) {
    return (
      <Page width="narrow">
        <Banner tone="danger" role="alert">{DEAD}</Banner>
      </Page>
    )
  }

  const finished = info !== null && remaining === 0
  return (
    <Page width="narrow">
      <Stack gap={4}>
        <h1>{info ? `Add up to ${info.remaining + thumbs.length} ${info.remaining + thumbs.length === 1 ? 'image' : 'images'} to post ${info.post}` : 'Add images'}</h1>
        {finished || dead ? <Banner tone="success">Done. You can go back to the chat and say it is done.</Banner> : null}
        <UploadArea busy={busy} remaining={remaining} thumbs={thumbs} onFiles={addFiles} />
        {error && <Banner tone="danger" role="alert">{error}</Banner>}
      </Stack>
    </Page>
  )
}
