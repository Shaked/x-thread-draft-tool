import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { draftsApi } from '../utils/api'
import ThemeSetting from './ThemeSetting'
import AppBar from './AppBar'

export default function DraftList({ user }) {
  const [activeTab, setActiveTab] = useState('drafts') // 'drafts' or 'published'
  const [drafts, setDrafts] = useState([])
  const [published, setPublished] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const navigate = useNavigate()


  const loadDrafts = async () => {
    if (!user) return

    try {
      setLoading(true)
      setError(null)

      const [draftsData, publishedData] = await Promise.all([
        draftsApi.list(false),
        draftsApi.list(true)
      ])

      setDrafts(draftsData || [])
      setPublished(publishedData || [])
    } catch (err) {
      console.error('Error loading drafts:', err)
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the spinner resets when the signed-in user changes
    loadDrafts()
  }, [user])

  const createNewDraft = async () => {
    try {
      const draft = await draftsApi.create({
        title: `Draft ${new Date().toLocaleDateString()}`,
        posts: [{ id: crypto.randomUUID(), text: '', images: [], embeddedTweet: null }]
      })

      navigate(`/draft/${draft.id}`)
    } catch (err) {
      console.error('Error creating draft:', err)
      alert('Failed to create draft: ' + err.message)
    }
  }

  const duplicateDraft = async (draft) => {
    try {
      const sourcePosts = Array.isArray(draft.posts) ? draft.posts : []
      const duplicatedPosts = sourcePosts.map((post) => ({
        ...post,
        id: crypto.randomUUID()
      }))

      const copy = await draftsApi.create({
        title: `${draft.title || 'Untitled'} (copy)`,
        posts: duplicatedPosts.length
          ? duplicatedPosts
          : [{ id: crypto.randomUUID(), text: '', images: [], embeddedTweet: null }]
      })

      navigate(`/draft/${copy.id}`)
    } catch (err) {
      console.error('Error duplicating draft:', err)
      alert('Failed to duplicate draft: ' + err.message)
    }
  }

  const deleteDraft = async (id) => {
    if (!confirm('Are you sure you want to delete this draft?')) return

    try {
      await draftsApi.remove(id)

      // Refresh lists
      loadDrafts()
    } catch (err) {
      console.error('Error deleting draft:', err)
      alert('Failed to delete draft: ' + err.message)
    }
  }

  const formatDate = (dateString) => {
    const date = new Date(dateString)
    return date.toLocaleString()
  }

  const getPostCount = (draft) => {
    return Array.isArray(draft.posts) ? draft.posts.length : 0
  }

  const currentList = activeTab === 'drafts' ? drafts : published

  return (
    <div className="draft-list-page">
      <div className="draft-list-header">
        <h1>Your Threads</h1>
        <ThemeSetting />
        <AppBar>
          {!(activeTab === 'drafts' && !loading && !error && drafts.length === 0) && (
            <button className="new-draft-btn" onClick={createNewDraft}>
              New draft
            </button>
          )}
        </AppBar>
        <button className="tab" onClick={() => navigate('/settings/tokens')}>
          API tokens
        </button>
      </div>

      <div className="draft-tabs">
        <button
          className={`tab ${activeTab === 'drafts' ? 'active' : ''}`}
          onClick={() => setActiveTab('drafts')}
        >
          Drafts ({drafts.length})
        </button>
        <button
          className={`tab ${activeTab === 'published' ? 'active' : ''}`}
          onClick={() => setActiveTab('published')}
        >
          Published ({published.length})
        </button>
      </div>

      {loading ? (
        <div className="loading" role="status" aria-live="polite">Loading your threads…</div>
      ) : error ? (
        <div className="error" role="alert">Could not load your threads: {error}</div>
      ) : currentList.length === 0 ? (
        <div className="empty-state">
          {activeTab === 'drafts' ? (
            <>
              <p>No drafts yet. Create your first thread to get started.</p>
              <button className="new-draft-btn" onClick={createNewDraft}>
                Create your first draft
              </button>
            </>
          ) : (
            <p>No published threads yet.</p>
          )}
        </div>
      ) : (
        <div className="draft-list">
          {currentList.map((draft) => (
            <div key={draft.id} className="draft-item">
              <div
                className="draft-info"
                onClick={() => navigate(`/draft/${draft.id}`)}
              >
                <h3>{draft.title}</h3>
                <div className="draft-meta">
                  <span>{getPostCount(draft)} {getPostCount(draft) === 1 ? 'post' : 'posts'}</span>
                  <span>•</span>
                  <span>
                    {activeTab === 'published'
                      ? `Published ${formatDate(draft.published_at)}`
                      : `Updated ${formatDate(draft.updated_at)}`}
                  </span>
                </div>
              </div>
              <div className="draft-actions">
                <button
                  className="duplicate-btn"
                  onClick={(e) => {
                    e.stopPropagation()
                    duplicateDraft(draft)
                  }}
                >
                  Duplicate
                </button>
                <button
                  className="delete-btn"
                  onClick={(e) => {
                    e.stopPropagation()
                    deleteDraft(draft.id)
                  }}
                >
                  Delete draft
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
