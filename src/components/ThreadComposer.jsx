import { useCallback } from 'react'
import PostBox from './PostBox'

export default function ThreadComposer({ posts, onPostsChange, readOnly = false }) {
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

  return (
    <div className="thread-composer">
      {!readOnly && (
        <div className="composer-header">
          <h2>Compose Thread</h2>
        </div>
      )}

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
            <PostBox
              post={post}
              index={index}
              totalPosts={posts.length}
              onChange={(updatedPost) => updatePost(index, updatedPost)}
              onRemove={() => removePost(post.id)}
              readOnly={readOnly}
            />
          </div>
        ))}
      </div>

      {!readOnly && (
        <button onClick={addPost} className="btn btn-primary add-post-btn">
          + Add Post
        </button>
      )}
    </div>
  )
}
