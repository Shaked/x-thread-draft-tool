import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { draftsApi } from '../utils/api'
import { useToast } from '../ui/Toast'
import { useViewAsReason } from '../utils/viewAs'
import Banner from '../ui/Banner'
import Button from '../ui/Button'
import Card from '../ui/Card'
import DeleteButton from '../ui/DeleteButton'
import EmptyState from '../ui/EmptyState'
import { List, ListItem } from '../ui/List'
import Page from '../ui/Page'
import PageHeader from '../ui/PageHeader'
import Skeleton from '../ui/Skeleton'
import Stack from '../ui/Stack'
import Tabs from '../ui/Tabs'

const DELETE_CONFIRM = { title: 'Delete this draft?', body: 'Are you sure you want to delete this draft?', confirmLabel: 'Delete draft' }

const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' })

export default function DraftList({ user }) {
  const [activeTab, setActiveTab] = useState('drafts') // 'drafts' or 'published'
  const [drafts, setDrafts] = useState([])
  const [published, setPublished] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const navigate = useNavigate()
  const toast = useToast()
  const reason = useViewAsReason()

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
      toast({ message: 'Failed to create draft: ' + err.message, tone: 'danger' })
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
      toast({ message: 'Failed to duplicate draft: ' + err.message, tone: 'danger' })
    }
  }

  // Runs after the user said yes (DeleteButton asks first). True when the draft was deleted.
  const deleteDraft = async (id) => {
    try {
      await draftsApi.remove(id)

      // Refresh lists
      loadDrafts()
      return true
    } catch (err) {
      console.error('Error deleting draft:', err)
      toast({ message: 'Failed to delete draft: ' + err.message, tone: 'danger' })
      return false
    }
  }

  const formatDate = (dateString) => dateFormat.format(new Date(dateString))

  const getPostCount = (draft) => {
    return Array.isArray(draft.posts) ? draft.posts.length : 0
  }

  const currentList = activeTab === 'drafts' ? drafts : published
  const loaded = !loading && !error
  const showNewDraft = !(activeTab === 'drafts' && loaded && drafts.length === 0)

  return (
    <Page width="default">
      <PageHeader
        title="Your Threads"
        actions={showNewDraft ? <Button variant="primary" onClick={createNewDraft} disabledReason={reason}>New draft</Button> : null}
      />
      <Stack gap={4}>
        <Tabs
          label="Threads"
          tabs={[
            { id: 'drafts', label: 'Drafts', count: drafts.length },
            { id: 'published', label: 'Published', count: published.length }
          ]}
          value={activeTab}
          onChange={setActiveTab}
        />

        {loading ? (
          <Skeleton variant="row" lines={3} />
        ) : error ? (
          <Banner tone="danger" role="alert">Could not load your threads: {error}</Banner>
        ) : currentList.length === 0 ? (
          activeTab === 'drafts' ? (
            <EmptyState
              title="No drafts yet."
              description="Create your first thread to get started."
              action={<Button variant="primary" onClick={createNewDraft} disabledReason={reason}>Create your first draft</Button>}
            />
          ) : (
            <EmptyState title="No published threads yet." />
          )
        ) : (
          <Card padding="none">
            <List>
              {currentList.map((draft) => (
                <ListItem
                  key={draft.id}
                  title={draft.title}
                  to={`/draft/${draft.id}`}
                  meta={[
                    `${getPostCount(draft)} ${getPostCount(draft) === 1 ? 'post' : 'posts'}`,
                    activeTab === 'published'
                      ? `Published ${formatDate(draft.published_at)}`
                      : `Updated ${formatDate(draft.updated_at)}`
                  ]}
                  actions={
                    <>
                      <Button variant="ghost" size="sm" onClick={() => duplicateDraft(draft)} disabledReason={reason}>
                        Duplicate
                      </Button>
                      <DeleteButton label="Delete draft" disabledReason={reason} confirm={DELETE_CONFIRM} onConfirm={() => deleteDraft(draft.id)} />
                    </>
                  }
                />
              ))}
            </List>
          </Card>
        )}
      </Stack>
    </Page>
  )
}
