import { useState, useEffect, useCallback, useRef } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { draftsApi, authApi } from '../utils/api'
import { isOwner, normalizeImages } from '../utils/images'
import { set as idbSet, get as idbGet } from 'idb-keyval'
import ThreadComposer from '../components/ThreadComposer'
import ShareButton from '../components/ShareButton'
import AgentLinkButton from '../components/AgentLinkButton'
import XThreadLinkButton from '../components/XThreadLinkButton'
import ExportOptions from '../components/ExportOptions'

function EditorHeader({ draft, draftId, isEditMode, synced, saving, user, onTitleChange, onPublish, onLogout }) {
  return (
    <header className="editor-header">
      <Link to="/" className="back-link" aria-label="Back" title="Back">
        <span className="back-arrow">←</span>
        <span className="back-text">Back</span>
      </Link>

      {isEditMode ? (
        <input
          type="text"
          value={draft.title}
          onChange={(e) => onTitleChange(e.target.value)}
          className="draft-title-input"
          placeholder="Untitled Draft"
        />
      ) : (
        <h1 className="draft-title-display">{draft.title}</h1>
      )}

      <div className="header-actions">
        {!synced && <span className="sync-status syncing">Syncing...</span>}
        {synced && !saving && <span className="sync-status synced">✓ Saved</span>}

        <ShareButton draftId={draftId} />

        {isEditMode && <AgentLinkButton draftId={draftId} />}

        {isEditMode && <XThreadLinkButton draftId={draftId} />}

        {isEditMode && !draft.is_published && (
          <button className="publish-btn icon-btn" onClick={onPublish} disabled={saving} title="Publish" aria-label="Publish">
            <span className="btn-icon">📤</span>
            <span className="btn-text">Publish</span>
          </button>
        )}

        {user && (
          <button className="logout-btn icon-btn" onClick={onLogout} title="Logout" aria-label="Logout">
            <span className="btn-icon">⏻</span>
            <span className="btn-text">Logout</span>
          </button>
        )}
      </div>
    </header>
  )
}

function EditorMainPanel({ draft, isEditMode, user, onPostsChange }) {
  return (
      <div className="main-panel">
        <ThreadComposer
          posts={draft.posts}
          onPostsChange={onPostsChange}
          readOnly={!isEditMode}
        />

        {isEditMode && !draft.is_published && (
          <div className="editor-hint">
            <p>💡 Tip: Images are auto-uploaded. Drafts are auto-saved every second.</p>
          </div>
        )}

        {draft.is_published && (
          <div className="published-badge">
            <p>📤 This draft has been published</p>
          </div>
        )}

        {!isEditMode && user && (
          <div className="view-only-notice">
            <p>You are viewing this draft in read-only mode.</p>
          </div>
        )}
      </div>
  )
}

export default function DraftEditor({ user }) {
  const { id } = useParams()
  const navigate = useNavigate()

  const [draft, setDraft] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [saving, setSaving] = useState(false)
  const [synced, setSynced] = useState(true)
  const [isEditMode, setIsEditMode] = useState(false)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)

  const saveTimeoutRef = useRef(null)
  const lastSavedRef = useRef(null)

  // Collapse sidebar by default on smaller screens
  useEffect(() => {
    // Only window resizes and mount run this, so a manual expand is not undone by a re-run.
    const handleResize = () => {
      if (window.innerWidth < 1024) {
        setSidebarCollapsed(true)
      }
    }

    // Check on mount
    handleResize()

    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  const loadDraft = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)

      let data
      try {
        data = await draftsApi.get(id)
      } catch (fetchError) {
        // If not found and user is not logged in, check IndexedDB
        if (!user) {
          const localDraft = await idbGet(`draft-${id}`)
          if (localDraft) {
            // Normalize images for backward compatibility
            const normalizedDraft = {
              ...localDraft,
              posts: localDraft.posts?.map(post => ({
                ...post,
                images: normalizeImages(post.images || [])
              })) || []
            }
            setDraft(normalizedDraft)
            setIsEditMode(false)
            setLoading(false)
            return
          }
        }
        throw fetchError
      }

      // Normalize images for backward compatibility
      const normalizedData = {
        ...data,
        posts: data.posts?.map(post => ({
          ...post,
          images: normalizeImages(post.images || [])
        })) || []
      }

      setDraft(normalizedData)
      setIsEditMode(user && isOwner(data, user.id))
      lastSavedRef.current = JSON.stringify(normalizedData)

      // Save to IndexedDB for offline access
      await idbSet(`draft-${id}`, data)
    } catch (err) {
      console.error('Error loading draft:', err)
      setError(err.message || 'Failed to load draft')
    } finally {
      setLoading(false)
    }
  }, [id, user])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the spinner must reset when the draft id changes
    loadDraft()
  }, [loadDraft])

  const saveDraft = useCallback(
    async (draftToSave, immediate = false) => {
      if (!user || !isEditMode) return

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
    [id, user, isEditMode]
  )

  useEffect(() => {
    if (!draft || !isEditMode) return

    // Auto-save on changes
    const currentState = JSON.stringify(draft)
    if (currentState !== lastSavedRef.current) {
      saveDraft(draft, false)
    }
  }, [draft, isEditMode, saveDraft])

  useEffect(() => {
    // Save before unload
    const handleBeforeUnload = () => {
      if (draft && isEditMode) {
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
  }, [draft, isEditMode, saveDraft])

  const handleTitleChange = (newTitle) => {
    if (!isEditMode) return
    setDraft({ ...draft, title: newTitle })
  }

  const handlePostsChange = (newPosts) => {
    if (!isEditMode) return
    setDraft({ ...draft, posts: newPosts })
  }

  const handlePublish = async () => {
    if (!isEditMode) return

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

  if (error) {
    return (
      <div className="draft-editor error-screen">
        <div className="error">
          <h2>Error</h2>
          <p>{error}</p>
          <Link to="/" className="btn btn-primary">
            Back to Home
          </Link>
        </div>
      </div>
    )
  }

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
      <EditorHeader
        draft={draft}
        draftId={id}
        isEditMode={isEditMode}
        synced={synced}
        saving={saving}
        user={user}
        onTitleChange={handleTitleChange}
        onPublish={handlePublish}
        onLogout={handleLogout}
      />

      <div className={`editor-content ${sidebarCollapsed ? 'sidebar-collapsed' : ''}`}>
        <EditorMainPanel draft={draft} isEditMode={isEditMode} user={user} onPostsChange={handlePostsChange} />

        <button
          className="sidebar-toggle"
          onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
          title={sidebarCollapsed ? 'Show export panel' : 'Hide export panel'}
        >
          {sidebarCollapsed ? '◀' : '▶'}
        </button>

        <div className={`side-panel ${sidebarCollapsed ? 'collapsed' : ''}`}>
          <ExportOptions draft={draft} />
        </div>
      </div>
    </div>
  )
}
