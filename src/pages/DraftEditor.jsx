import { useState, useEffect, useCallback, useRef } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { supabase, isOwner, deleteAllDraftImages, normalizeImages } from '../utils/supabase'
import { set as idbSet, get as idbGet } from 'idb-keyval'
import ThreadComposer from '../components/ThreadComposer'
import ShareButton from '../components/ShareButton'
import ExportOptions from '../components/ExportOptions'

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
  const scrollPosRef = useRef(0)
  const focusedPostIndexRef = useRef(null)
  const cursorPosRef = useRef(null)

  // Prevent scroll position changes on visibility change
  useEffect(() => {
    if (!draft || loading) return

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        // Save current state to refs (in memory, faster than sessionStorage)
        scrollPosRef.current = window.scrollY

        // Save focused textarea index and cursor position
        const activeElement = document.activeElement
        if (activeElement && activeElement.classList?.contains('post-textarea')) {
          const postBox = activeElement.closest('.post-box')
          if (postBox) {
            const postBoxes = document.querySelectorAll('.post-box')
            const postIndex = Array.from(postBoxes).indexOf(postBox)
            focusedPostIndexRef.current = postIndex
            cursorPosRef.current = activeElement.selectionStart
          }
        } else {
          focusedPostIndexRef.current = null
          cursorPosRef.current = null
        }
      } else if (document.visibilityState === 'visible') {
        // Restore scroll position immediately
        if (scrollPosRef.current) {
          window.scrollTo(0, scrollPosRef.current)
        }

        // Restore focus and cursor position
        if (focusedPostIndexRef.current !== null) {
          // Use setTimeout to ensure DOM is ready
          setTimeout(() => {
            const postBoxes = document.querySelectorAll('.post-box')
            const postBox = postBoxes[focusedPostIndexRef.current]
            if (postBox) {
              const textarea = postBox.querySelector('.post-textarea')
              if (textarea) {
                textarea.focus()
                if (cursorPosRef.current !== null) {
                  textarea.setSelectionRange(cursorPosRef.current, cursorPosRef.current)
                }
              }
            }
          }, 0)
        }
      }
    }

    document.addEventListener('visibilitychange', handleVisibilityChange)
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange)
  }, [draft, loading])

  // Collapse sidebar by default on smaller screens
  useEffect(() => {
    const handleResize = () => {
      if (window.innerWidth < 1024 && !sidebarCollapsed) {
        setSidebarCollapsed(true)
      }
    }

    // Check on mount
    handleResize()

    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  useEffect(() => {
    loadDraft()
  }, [id, user])

  const loadDraft = async () => {
    try {
      setLoading(true)
      setError(null)

      // Try to load from Supabase first
      const { data, error: fetchError } = await supabase
        .from('drafts')
        .select('*')
        .eq('id', id)
        .single()

      if (fetchError) {
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
  }

  const saveDraft = useCallback(
    async (draftToSave, immediate = false) => {
      if (!user || !isEditMode) return

      const saveFn = async () => {
        try {
          setSaving(true)
          setSynced(false)

          const { error: updateError } = await supabase
            .from('drafts')
            .update({
              title: draftToSave.title,
              posts: draftToSave.posts,
              updated_at: new Date().toISOString()
            })
            .eq('id', id)

          if (updateError) throw updateError

          lastSavedRef.current = JSON.stringify(draftToSave)
          setSynced(true)

          // Update IndexedDB
          await idbSet(`draft-${id}`, draftToSave)
        } catch (err) {
          console.error('Save error:', err)
          // Still save to IndexedDB even if server fails
          await idbSet(`draft-${id}`, draftToSave)
        } finally {
          setSaving(false)
        }
      }

      if (immediate) {
        if (saveTimeoutRef.current) {
          clearTimeout(saveTimeoutRef.current)
        }
        await saveFn()
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

      // Delete all images
      await deleteAllDraftImages(draft.posts)

      // Clear images from posts
      const cleanedPosts = draft.posts.map(post => ({
        ...post,
        images: []
      }))

      // Update draft
      const { error: updateError } = await supabase
        .from('drafts')
        .update({
          posts: cleanedPosts,
          is_published: true,
          published_at: new Date().toISOString()
        })
        .eq('id', id)

      if (updateError) throw updateError

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
    await supabase.auth.signOut()
    navigate('/')
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
      <header className="editor-header">
        <div className="header-left">
          <Link to="/" className="back-link">
            ← Back
          </Link>
          {isEditMode ? (
            <input
              type="text"
              value={draft.title}
              onChange={(e) => handleTitleChange(e.target.value)}
              className="draft-title-input"
              placeholder="Untitled Draft"
            />
          ) : (
            <h1 className="draft-title-display">{draft.title}</h1>
          )}
        </div>

        <div className="header-right">
          {!synced && <span className="sync-status syncing">Syncing...</span>}
          {synced && !saving && <span className="sync-status synced">✓ Saved</span>}

          <ShareButton draftId={id} />

          {isEditMode && !draft.is_published && (
            <button className="publish-btn" onClick={handlePublish} disabled={saving}>
              📤 Publish
            </button>
          )}

          {user && (
            <button className="logout-btn" onClick={handleLogout}>
              Logout
            </button>
          )}
        </div>
      </header>

      <div className={`editor-content ${sidebarCollapsed ? 'sidebar-collapsed' : ''}`}>
        <div className="main-panel">
          <ThreadComposer
            posts={draft.posts}
            onPostsChange={handlePostsChange}
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
