import { useState, useEffect, useCallback, useRef } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { draftsApi, authApi } from '../utils/api'
import { normalizeImages } from '../utils/images'
import { set as idbSet, del as idbDel } from 'idb-keyval'
import ThreadComposer from '../components/ThreadComposer'
import AgentLinkButton from '../components/AgentLinkButton'
import XThreadLinkButton from '../components/XThreadLinkButton'
import ShareLinkButton from '../components/ShareLinkButton'
import ExportOptions from '../components/ExportOptions'
import { useToast } from '../ui/Toast'
import { useConfirm } from '../ui/Dialog'
import Badge from '../ui/Badge'
import Banner from '../ui/Banner'
import Button from '../ui/Button'
import Input from '../ui/Input'
import PageHeader from '../ui/PageHeader'
import Stack from '../ui/Stack'

// A post saved before ids were required has none. An object without a string id gets a new one, so
// the next save is accepted. Anything else is returned as it is, so the server still refuses it.
const withPostId = post =>
  post !== null && typeof post === 'object' && !Array.isArray(post) && typeof post.id !== 'string'
    ? { ...post, id: crypto.randomUUID() }
    : post

// The draft as the editor holds it: images normalized for backward compatibility.
const normalizeDraft = data => ({
  ...data,
  posts: data.posts?.map(post => ({
    ...withPostId(post),
    images: normalizeImages(post.images || [])
  })) || []
})

// The text the user wrote, one post per paragraph, for copying after a conflict.
const plainText = draft => [draft.title, ...draft.posts.map(post => post.text)].filter(Boolean).join('\n\n')

export default function DraftEditor({ user }) {
  const { id } = useParams()
  const navigate = useNavigate()
  const toast = useToast()
  const ask = useConfirm()

  const [draft, setDraft] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [saving, setSaving] = useState(false)
  const [synced, setSynced] = useState(true)
  // True after a save gets 401: the session ended. The text stays in the editor for the user to copy.
  const [signedOut, setSignedOut] = useState(false)
  // Set after a save gets 412: another app changed the draft. { version, theirs } until the user chooses.
  const [conflict, setConflict] = useState(null)
  // After "Show their changes": my text, for copying.
  const [copyText, setCopyText] = useState(null)

  const saveTimeoutRef = useRef(null)
  const lastSavedRef = useRef(null)
  // The version the editor last read or saved. Every save sends it as If-Match.
  const versionRef = useRef(undefined)
  // Mirrors `conflict`, so a save started in the same tick sees it at once. No save runs while it is set.
  const conflictRef = useRef(false)

  const loadDraft = async () => {
    try {
      setLoading(true)
      setError(null)

      // The server returns a draft only to its owner: 401 when signed out, 404 for anyone else.
      const data = await draftsApi.get(id)

      const normalizedData = normalizeDraft(data)

      setDraft(normalizedData)
      lastSavedRef.current = JSON.stringify(normalizedData)
      versionRef.current = data.version

      // Save to IndexedDB for offline access
      await idbSet(`draft-${id}`, data)
    } catch (err) {
      console.error('Error loading draft:', err)
      // A copy kept in this browser must never show for a draft the server refuses.
      if (err.status === 401 || err.status === 404) {
        await idbDel(`draft-${id}`).catch(() => {})
      }
      setError({ status: err.status, message: err.message || 'Failed to load draft' })
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the spinner resets when the draft id changes
    loadDraft()
  }, [id, user])

  const saveDraft = useCallback(
    async (draftToSave, immediate = false, keepalive = false) => {
      // No save while another app's change is waiting for the user's choice.
      if (!user || conflictRef.current) return false

      const saveFn = async () => {
        try {
          setSaving(true)
          setSynced(false)

          const saved = await draftsApi.update(
            id,
            { title: draftToSave.title, posts: draftToSave.posts },
            versionRef.current,
            { keepalive }
          )
          versionRef.current = saved?.version ?? versionRef.current

          lastSavedRef.current = JSON.stringify(draftToSave)
          setSynced(true)
          setSignedOut(false)

          // Update IndexedDB
          await idbSet(`draft-${id}`, draftToSave)
          return true
        } catch (err) {
          console.error('Save error:', err)
          if (err.status === 412) {
            // Nothing was written. Stop saving and let the user choose (see the banner).
            conflictRef.current = true
            setConflict({ version: err.version ?? err.draft?.version, theirs: err.draft })
            setSynced(true)
            return false
          }
          // Still save to IndexedDB even if server fails, except when signed out (sign-out clears this cache)
          if (err.status === 401) setSignedOut(true)
          else await idbSet(`draft-${id}`, draftToSave)
          return false
        } finally {
          setSaving(false)
        }
      }

      if (immediate) {
        if (saveTimeoutRef.current) {
          clearTimeout(saveTimeoutRef.current)
        }
        return saveFn()
      } else {
        // Debounce
        if (saveTimeoutRef.current) {
          clearTimeout(saveTimeoutRef.current)
        }
        saveTimeoutRef.current = setTimeout(saveFn, 1000)
      }
    },
    [id, user]
  )

  useEffect(() => {
    if (!draft) return

    // Auto-save on changes
    const currentState = JSON.stringify(draft)
    if (currentState !== lastSavedRef.current) {
      saveDraft(draft, false)
    }
  }, [draft, saveDraft])

  useEffect(() => {
    // Save before unload, but only real unsaved edits: an untouched draft must not overwrite a newer version.
    const handleBeforeUnload = () => {
      if (draft && JSON.stringify(draft) !== lastSavedRef.current) {
        saveDraft(draft, true, true)
      }
    }

    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload)
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current)
      }
    }
  }, [draft, saveDraft])

  // "Show their changes": keep my text for copying, then show the draft the other app saved.
  const showTheirs = () => {
    if (!conflict?.theirs) return
    setCopyText(plainText(draft))
    const theirs = normalizeDraft(conflict.theirs)
    versionRef.current = conflict.version
    lastSavedRef.current = JSON.stringify(theirs)
    setDraft(theirs)
    conflictRef.current = false
    setConflict(null)
    idbSet(`draft-${id}`, theirs).catch(() => {})
  }

  // "Keep mine": save my text as a new version on top of theirs.
  const keepMine = () => {
    if (!Number.isInteger(conflict?.version)) return
    versionRef.current = conflict.version
    conflictRef.current = false
    setConflict(null)
    saveDraft(draft, true)
  }

  const copyMyText = async () => {
    try {
      await navigator.clipboard.writeText(copyText)
      toast({ message: 'Copied', tone: 'success' })
    } catch {
      toast({ message: 'Could not copy. Select the text and copy it.', tone: 'danger' })
    }
  }

  const handleTitleChange = (newTitle) => {
    setDraft({ ...draft, title: newTitle })
  }

  const handlePostsChange = (newPosts) => {
    setDraft({ ...draft, posts: newPosts })
  }

  const handlePublish = async () => {
    const confirmed = await ask({
      title: 'Publish this draft?',
      body: 'Mark this draft as published? This will delete all uploaded images and move the draft to your Published list.',
      confirmLabel: 'Publish',
      tone: 'primary'
    })

    if (!confirmed) return

    try {
      setSaving(true)

      // Publish reads the saved posts on the server, so flush the pending autosave first.
      const saved = await saveDraft(draft, true)
      if (!saved) throw new Error('Could not save your latest edits. Try again.')

      // The server deletes the draft's images, clears them from posts and marks it published.
      await draftsApi.publish(id)

      toast({ message: 'Draft published successfully!', tone: 'success' })
      navigate('/')
    } catch (err) {
      console.error('Publish error:', err)
      toast({ message: 'Failed to publish: ' + err.message, tone: 'danger' })
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="draft-editor loading-screen">
        <div className="loading">Loading draft...</div>
      </div>
    )
  }

  if (error) return <LoadError error={error} />

  if (!draft) {
    return (
      <div className="draft-editor error-screen">
        <div className="error">
          <h2>Draft Not Found</h2>
          <Link to="/" className="btn btn-primary">
            Back to Home
          </Link>
        </div>
      </div>
    )
  }

  // The save status word and its tone: the same texts as before, announced when they change.
  const saveStatus = signedOut || conflict
    ? { tone: 'danger', text: 'Not saved' }
    : !synced || saving
      ? { tone: 'warning', text: 'Saving…' }
      : { tone: 'success', text: 'Saved' }

  return (
    <div className="draft-editor">
      <PageHeader
        sticky
        back={{ to: '/', label: '← Back' }}
        titleSlot={
          <h1>
            <Input value={draft.title} onChange={handleTitleChange} ariaLabel="Draft title" placeholder="Untitled Draft" />
          </h1>
        }
        status={
          <Badge tone={saveStatus.tone} live>
            {saveStatus.text}
          </Badge>
        }
        actions={
          <>
            <ShareLinkButton draftId={id} />
            <AgentLinkButton draftId={id} />
            <XThreadLinkButton draftId={id} />
            <ExportOptions draft={draft} />
            {!draft.is_published && (
              <Button variant="primary" icon="publish" onClick={handlePublish} disabled={saving} ariaLabel="Publish">
                Publish
              </Button>
            )}
          </>
        }
      />

      <div className="editor-content">
        <div className="main-panel">
          <Stack gap={4}>
            {signedOut && (
              <Banner
                tone="danger"
                role="alert"
                actions={
                  <Button variant="secondary" onClick={() => authApi.login()}>
                    Sign in with GitHub
                  </Button>
                }
              >
                You are signed out. Your text is still here: copy it, then sign in again.
              </Banner>
            )}

            <ThreadComposer posts={draft.posts} onPostsChange={handlePostsChange} />

            {conflict && (
              <Banner
                tone="warning"
                role="alert"
                actions={
                  <>
                    <Button variant="secondary" onClick={showTheirs}>
                      Show their changes
                    </Button>
                    <Button variant="primary" onClick={keepMine}>
                      Keep mine
                    </Button>
                  </>
                }
              >
                This draft changed in another app while you were editing. Autosave is paused until you choose.
              </Banner>
            )}

            {copyText !== null && (
              <Banner
                tone="info"
                role="status"
                actions={
                  <>
                    <Button variant="secondary" onClick={copyMyText}>
                      Copy
                    </Button>
                    <Button variant="ghost" onClick={() => setCopyText(null)}>
                      Dismiss
                    </Button>
                  </>
                }
              >
                <p>Your text is below. Copy what you need.</p>
                <textarea readOnly rows={8} value={copyText} aria-label="Your text" />
              </Banner>
            )}

            {!draft.is_published && (
              <Banner tone="info" role="none">
                Images upload automatically. Changes save as you type.
              </Banner>
            )}

            {draft.is_published && (
              <Banner tone="success" role="none">
                📤 This draft has been published
              </Banner>
            )}
          </Stack>
        </div>
      </div>
    </div>
  )
}

// The screen for a draft that did not load. Kept out of DraftEditor so the editor's complexity stays within the lint limit.
function LoadError({ error }) {
  if (error.status === 401) {
    return (
      <div className="draft-editor error-screen">
        <div className="error">
          <h2>Sign in to open this draft</h2>
          <p>Drafts are private. Sign in with the account that owns this draft.</p>
          <button className="btn btn-primary" onClick={() => authApi.login()}>
            Sign in with GitHub
          </button>
        </div>
      </div>
    )
  }

  if (error.status === 404) {
    return (
      <div className="draft-editor error-screen">
        <div className="error">
          <h2>Draft not found</h2>
          <Link to="/" className="btn btn-primary">
            Back to Home
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="draft-editor error-screen">
      <div className="error">
        <h2>Error</h2>
        <p>{error.message}</p>
        <Link to="/" className="btn btn-primary">
          Back to Home
        </Link>
      </div>
    </div>
  )
}
