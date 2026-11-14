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

export default function DraftEditor({ user }) {
  const { id } = useParams()
  const navigate = useNavigate()

  const [draft, setDraft] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [saving, setSaving] = useState(false)
  const [synced, setSynced] = useState(true)

  const saveTimeoutRef = useRef(null)
  const lastSavedRef = useRef(null)

  const loadDraft = async () => {
    try {
      setLoading(true)
      setError(null)

      // The server returns a draft only to its owner: 401 when signed out, 404 for anyone else.
      const data = await draftsApi.get(id)

      // Normalize images for backward compatibility
      const normalizedData = {
        ...data,
        posts: data.posts?.map(post => ({
          ...post,
          images: normalizeImages(post.images || [])
        })) || []
      }

      setDraft(normalizedData)
      lastSavedRef.current = JSON.stringify(normalizedData)

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
    async (draftToSave, immediate = false) => {
      if (!user) return

      const saveFn = async () => {
        try {
          setSaving(true)
          setSynced(false)

          await draftsApi.update(id, {
            title: draftToSave.title,
            posts: draftToSave.posts
          })

          lastSavedRef.current = JSON.stringify(draftToSave)
          setSynced(true)

          // Update IndexedDB
          await idbSet(`draft-${id}`, draftToSave)
          return true
        } catch (err) {
          console.error('Save error:', err)
          // Still save to IndexedDB even if server fails
          await idbSet(`draft-${id}`, draftToSave)
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
    // Save before unload
    const handleBeforeUnload = () => {
      if (draft) {
        saveDraft(draft, true)
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

  const handleTitleChange = (newTitle) => {
    setDraft({ ...draft, title: newTitle })
  }

  const handlePostsChange = (newPosts) => {
    setDraft({ ...draft, posts: newPosts })
  }

  const handlePublish = async () => {
    const confirmed = window.confirm(
      'Mark this draft as published? This will delete all uploaded images and move the draft to your Published list.'
    )

    if (!confirmed) return

    try {
      setSaving(true)

      // Publish reads the saved posts on the server, so flush the pending autosave first.
      const saved = await saveDraft(draft, true)
      if (!saved) throw new Error('Could not save your latest edits. Try again.')

      // The server deletes the draft's images, clears them from posts and marks it published.
      await draftsApi.publish(id)

      alert('Draft published successfully!')
      navigate('/')
    } catch (err) {
      console.error('Publish error:', err)
      alert('Failed to publish: ' + err.message)
    } finally {
      setSaving(false)
    }
  }

  const handleLogout = async () => {
    try {
      await authApi.logout()
    } catch (err) {
      console.error('Logout error:', err)
    }
    // Reload so the app re-reads the (now cleared) session.
    window.location.assign('/')
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

  return (
    <div className="draft-editor">
      <header className="editor-header">
        <Link to="/" className="back-link" aria-label="Back" title="Back">
          <span className="back-arrow">←</span>
          <span className="back-text">Back</span>
        </Link>

        <input
          type="text"
          value={draft.title}
          onChange={(e) => handleTitleChange(e.target.value)}
          className="draft-title-input"
          aria-label="Draft title"
          placeholder="Untitled Draft"
        />

        <span
          className={`sync-status ${!synced || saving ? 'syncing' : 'synced'}`}
          role="status"
          aria-live="polite"
        >
          {!synced || saving ? 'Saving…' : 'Saved'}
        </span>

        <div className="header-actions">
          <ShareLinkButton draftId={id} />

          <AgentLinkButton draftId={id} />

          <XThreadLinkButton draftId={id} />

          <ExportOptions draft={draft} />

          {!draft.is_published && (
            <button className="publish-btn icon-btn" onClick={handlePublish} disabled={saving} title="Publish" aria-label="Publish">
              <span className="btn-icon">📤</span>
              <span className="btn-text">Publish</span>
            </button>
          )}

          {user && (
            <button className="logout-btn icon-btn" onClick={handleLogout} title="Logout" aria-label="Logout">
              <span className="btn-icon">⏻</span>
              <span className="btn-text">Logout</span>
            </button>
          )}
        </div>
      </header>

      <div className="editor-content">
        <div className="main-panel">
          <ThreadComposer posts={draft.posts} onPostsChange={handlePostsChange} />

          {!draft.is_published && (
            <div className="editor-hint">
              <p>Images upload automatically. Changes save as you type.</p>
            </div>
          )}

          {draft.is_published && (
            <div className="published-badge">
              <p>📤 This draft has been published</p>
            </div>
          )}

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
