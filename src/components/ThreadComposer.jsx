import { useCallback } from 'react'
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import {
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
  useSortable,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import PostBox from './PostBox'

function SortablePost({ post, index, totalPosts, onUpdate, onRemove, readOnly }) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: post.id })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    zIndex: isDragging ? 10 : 'auto',
    position: 'relative',
  }

  return (
    <div ref={setNodeRef} style={style} {...attributes}>
      <PostBox
        post={post}
        index={index}
        totalPosts={totalPosts}
        onChange={onUpdate}
        onRemove={onRemove}
        readOnly={readOnly}
        dragHandleProps={!readOnly ? listeners : undefined}
      />
    </div>
  )
}

export default function ThreadComposer({ posts, onPostsChange, readOnly = false }) {
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 8 },
    }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 200, tolerance: 5 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  )

  const addPost = useCallback(() => {
    const newPost = {
      id: crypto.randomUUID(),
      text: '',
      images: [],
      embeddedTweet: null
    }
    onPostsChange([...posts, newPost])
  }, [posts, onPostsChange])

  const insertPostAt = useCallback((index) => {
    const newPost = {
      id: crypto.randomUUID(),
      text: '',
      images: [],
      embeddedTweet: null
    }
    const newPosts = [...posts]
    newPosts.splice(index, 0, newPost)
    onPostsChange(newPosts)
  }, [posts, onPostsChange])

  const removePost = useCallback((id) => {
    if (posts.length > 1) {
      onPostsChange(posts.filter(post => post.id !== id))
    }
  }, [posts, onPostsChange])

  const updatePost = useCallback((index, updatedPost) => {
    const newPosts = [...posts]
    newPosts[index] = updatedPost
    onPostsChange(newPosts)
  }, [posts, onPostsChange])

  const handleDragEnd = useCallback((event) => {
    const { active, over } = event
    if (!over || active.id === over.id) return

    const oldIndex = posts.findIndex(p => p.id === active.id)
    const newIndex = posts.findIndex(p => p.id === over.id)
    if (oldIndex === -1 || newIndex === -1) return

    const newPosts = [...posts]
    const [moved] = newPosts.splice(oldIndex, 1)
    newPosts.splice(newIndex, 0, moved)
    onPostsChange(newPosts)
  }, [posts, onPostsChange])

  return (
    <div className="thread-composer">
      {!readOnly && (
        <div className="composer-header">
          <h2>Compose Thread</h2>
        </div>
      )}

      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={handleDragEnd}
      >
        <SortableContext
          items={posts.map(p => p.id)}
          strategy={verticalListSortingStrategy}
        >
          <div className="posts-list">
            {posts.map((post, index) => (
              <div key={post.id}>
                {!readOnly && (
                  <button
                    onClick={() => insertPostAt(index)}
                    className="insert-post-btn"
                    title="Insert post here"
                  >
                    <span className="insert-icon">+</span>
                    <span className="insert-label">Insert post here</span>
                  </button>
                )}
                <SortablePost
                  post={post}
                  index={index}
                  totalPosts={posts.length}
                  onUpdate={(updatedPost) => updatePost(index, updatedPost)}
                  onRemove={() => removePost(post.id)}
                  readOnly={readOnly}
                />
              </div>
            ))}
          </div>
        </SortableContext>
      </DndContext>

      {!readOnly && (
        <button onClick={addPost} className="btn btn-primary add-post-btn">
          + Add Post
        </button>
      )}
    </div>
  )
}
