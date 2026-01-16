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
          <button onClick={addPost} className="btn btn-primary">
            + Add Post
          </button>
        </div>
      )}

      <div className="posts-list">
        {posts.map((post, index) => (
          <PostBox
            key={post.id}
            post={post}
            index={index}
            totalPosts={posts.length}
            onChange={(updatedPost) => updatePost(index, updatedPost)}
            onRemove={() => removePost(post.id)}
            readOnly={readOnly}
          />
        ))}
      </div>
    </div>
  )
}
