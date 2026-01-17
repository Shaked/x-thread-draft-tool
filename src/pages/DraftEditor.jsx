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

  // Save scroll position and focused element to sessionStorage
  useEffect(() => {
    const saveState = () => {
      try {
        const scrollPos = window.scrollY
        sessionStorage.setItem(`draft-${id}-scroll`, scrollPos.toString())
        console.log('[Save] Saved scroll position:', scrollPos)

        // Save focused post index if any textarea is focused
        const activeElement = document.activeElement
        if (activeElement && activeElement.classList.contains('post-textarea')) {
          const postBox = activeElement.closest('.post-box')
          if (postBox) {
            const postIndex = Array.from(document.querySelectorAll('.post-box')).indexOf(postBox)
            sessionStorage.setItem(`draft-${id}-focused`, postIndex.toString())
            console.log('[Save] Saved focused post index:', postIndex)
          }
        }
      } catch (e) {
        console.error('Failed to save state:', e)
      }
    }

    // Save on scroll
    window.addEventListener('scroll', saveState, { passive: true })

    // Save on focus changes
    document.addEventListener('focusin', saveState, { passive: true })

    // Save before unload/visibility change
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        saveState()
      }
    }
    document.addEventListener('visibilitychange', handleVisibilityChange)
    window.addEventListener('beforeunload', saveState)

    // Save periodically (every 2 seconds)
    const interval = setInterval(saveState, 2000)

    return () => {
      window.removeEventListener('scroll', saveState)
      document.removeEventListener('focusin', saveState)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      window.removeEventListener('beforeunload', saveState)
      clearInterval(interval)
    }
  }, [id])

  // Restore scroll position and focus after draft loads
  useEffect(() => {
    if (!draft || loading) return

    const restoreState = () => {
      try {
        // Restore scroll position
        const savedScroll = sessionStorage.getItem(`draft-${id}-scroll`)
        if (savedScroll) {
          const scrollPos = parseInt(savedScroll, 10)
          console.log('[Restore] Attempting to restore scroll to:', scrollPos)
          window.scrollTo({ top: scrollPos, behavior: 'instant' })

          // Force another scroll after a small delay (in case content hasn't fully rendered)
          setTimeout(() => {
            window.scrollTo({ top: scrollPos, behavior: 'instant' })
            console.log('[Restore] Second attempt scroll to:', scrollPos)
          }, 100)

          setTimeout(() => {
            window.scrollTo({ top: scrollPos, behavior: 'instant' })
            console.log('[Restore] Third attempt scroll to:', scrollPos)
          }, 300)
        }

        // Restore focused textarea
        const savedFocus = sessionStorage.getItem(`draft-${id}-focused`)
        if (savedFocus) {
          setTimeout(() => {
            const focusIndex = parseInt(savedFocus, 10)
            const postBoxes = document.querySelectorAll('.post-box')
            console.log('[Restore] Found', postBoxes.length, 'post boxes, trying to focus index', focusIndex)
            if (postBoxes[focusIndex]) {
              const textarea = postBoxes[focusIndex].querySelector('.post-textarea')
              if (textarea) {
                textarea.focus()
                // Move cursor to end
                textarea.selectionStart = textarea.selectionEnd = textarea.value.length
                console.log('[Restore] Focused textarea at index', focusIndex)

                // Scroll to focused element
                textarea.scrollIntoView({ behavior: 'smooth', block: 'center' })
              }
            }
          }, 400)
        }
      } catch (e) {
        console.error('Failed to restore state:', e)
      }
    }

    // Try restoration multiple times with increasing delays
    const timer1 = setTimeout(restoreState, 50)
    const timer2 = setTimeout(restoreState, 200)
    const timer3 = setTimeout(restoreState, 500)

    return () => {
      clearTimeout(timer1)
      clearTimeout(timer2)
      clearTimeout(timer3)
    }
  }, [draft, loading, id])

  // Restore scroll position when app becomes visible again (iOS app switching)
  useEffect(() => {
    if (!draft || loading) return

    const restoreScrollOnVisible = (event) => {
      // For visibilitychange, only restore when becoming visible
      // For pageshow and focus, always restore
      if (event.type === 'visibilitychange' && document.visibilityState !== 'visible') {
        return
      }

      try {
        const savedScroll = sessionStorage.getItem(`draft-${id}-scroll`)
        if (savedScroll) {
          const scrollPos = parseInt(savedScroll, 10)
          console.log(`[${event.type}] Restoring scroll to:`, scrollPos)

          // Immediate restoration
          window.scrollTo({ top: scrollPos, behavior: 'instant' })

          // Multiple attempts to ensure it sticks (especially important for iOS)
          requestAnimationFrame(() => {
            window.scrollTo({ top: scrollPos, behavior: 'instant' })
          })

          setTimeout(() => {
            window.scrollTo({ top: scrollPos, behavior: 'instant' })
            console.log(`[${event.type}] Delayed scroll to:`, scrollPos)
          }, 50)

          setTimeout(() => {
            window.scrollTo({ top: scrollPos, behavior: 'instant' })
            console.log(`[${event.type}] Final scroll to:`, scrollPos)
          }, 200)
        }
      } catch (e) {
        console.error('Failed to restore scroll on visibility change:', e)
      }
    }

    // Listen for page visibility changes (iOS app switching)
    document.addEventListener('visibilitychange', restoreScrollOnVisible)

    // Also listen for pageshow event (iOS back-forward cache)
    window.addEventListener('pageshow', restoreScrollOnVisible)

    // Listen for focus event (when app comes to foreground)
    window.addEventListener('focus', restoreScrollOnVisible)

    return () => {
      document.removeEventListener('visibilitychange', restoreScrollOnVisible)
      window.removeEventListener('pageshow', restoreScrollOnVisible)
      window.removeEventListener('focus', restoreScrollOnVisible)
    }
  }, [draft, loading, id])

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
