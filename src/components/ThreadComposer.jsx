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
import Button from '../ui/Button'
import PostBox from './PostBox'
import './ThreadComposer.css'

function SortablePost({ post, index, totalPosts, onUpdate, onRemove, readOnly }) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: post.id })

  // dnd-kit's transform and transition are set on the node as CSS custom properties (ThreadComposer.css reads
  // them), so the wrapper has no style prop. React runs this ref again when they change.
  const setRef = useCallback((node) => {
    setNodeRef(node)
    if (node) {
      node.style.setProperty('--drag-transform', CSS.Transform.toString(transform) ?? 'none')
      node.style.setProperty('--drag-transition', transition ?? 'none')
    }
  }, [setNodeRef, transform, transition])

  return (
    <div ref={setRef} className={`thread-post${isDragging ? ' thread-post--dragging' : ''}`}>
      <PostBox
        post={post}
        index={index}
        totalPosts={totalPosts}
        onChange={onUpdate}
        onRemove={onRemove}
        readOnly={readOnly}
        dragHandleProps={!readOnly ? { ...attributes, ...listeners } : undefined}
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
        <div className="thread-composer__header">
          <h2 className="thread-composer__title">Compose thread</h2>
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
                  <div className="thread-insert">
                    <Button variant="ghost" icon="plus" fullWidth onClick={() => insertPostAt(index)}>
                      Insert post here
                    </Button>
                  </div>
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
        <div className="thread-add">
          <Button variant="secondary" icon="plus" fullWidth onClick={addPost}>
            Add post
          </Button>
        </div>
      )}
    </div>
  )
}
