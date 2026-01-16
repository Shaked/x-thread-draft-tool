import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../utils/supabase'

export default function DraftList({ user }) {
  const [activeTab, setActiveTab] = useState('drafts') // 'drafts' or 'published'
  const [drafts, setDrafts] = useState([])
  const [published, setPublished] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const navigate = useNavigate()

  useEffect(() => {
    loadDrafts()
  }, [user])

  const loadDrafts = async () => {
    if (!user) return

    try {
      setLoading(true)
      setError(null)

      // Load unpublished drafts
      const { data: draftsData, error: draftsError } = await supabase
        .from('drafts')
        .select('*')
        .eq('user_id', user.id)
        .eq('is_published', false)
        .order('updated_at', { ascending: false })

      if (draftsError) throw draftsError

      // Load published drafts
      const { data: publishedData, error: publishedError } = await supabase
        .from('drafts')
        .select('*')
        .eq('user_id', user.id)
        .eq('is_published', true)
        .order('published_at', { ascending: false })

      if (publishedError) throw publishedError

      setDrafts(draftsData || [])
      setPublished(publishedData || [])
    } catch (err) {
      console.error('Error loading drafts:', err)
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  const createNewDraft = async () => {
    try {
      const { data, error } = await supabase
        .from('drafts')
        .insert([
          {
            user_id: user.id,
            title: `Draft ${new Date().toLocaleDateString()}`,
            posts: [{ id: crypto.randomUUID(), text: '', images: [], embeddedTweet: null }]
          }
        ])
        .select()
        .single()

      if (error) throw error

      navigate(`/draft/${data.id}`)
    } catch (err) {
      console.error('Error creating draft:', err)
      alert('Failed to create draft: ' + err.message)
    }
  }

  const deleteDraft = async (id) => {
    if (!confirm('Are you sure you want to delete this draft?')) return

    try {
      const { error } = await supabase
        .from('drafts')
        .delete()
        .eq('id', id)

      if (error) throw error

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
        <button className="new-draft-btn" onClick={createNewDraft}>
          + New Draft
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
        <div className="loading">Loading...</div>
      ) : error ? (
        <div className="error">Error: {error}</div>
      ) : currentList.length === 0 ? (
        <div className="empty-state">
          {activeTab === 'drafts' ? (
            <>
              <p>No drafts yet. Start by creating your first thread!</p>
              <button className="new-draft-btn" onClick={createNewDraft}>
                Create First Draft
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
                  <span>{getPostCount(draft)} posts</span>
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
                  className="delete-btn"
                  onClick={(e) => {
                    e.stopPropagation()
                    deleteDraft(draft.id)
                  }}
                  title="Delete"
                >
                  🗑️
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
