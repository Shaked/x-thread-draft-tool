import { useState, useRef } from 'react'
import EmojiPicker from './EmojiPicker'
import ImageUpload from './ImageUpload'
import TweetEmbed from './TweetEmbed'

const MAX_CHARS = 280

export default function PostBox({ post, index, totalPosts, onChange, onRemove, readOnly = false }) {
  const [showEmojiPicker, setShowEmojiPicker] = useState(false)
  const textareaRef = useRef(null)

  const text = post?.text || ''
  const images = post?.images || []
  const embeddedTweet = post?.embeddedTweet || null
  const charCount = text.length
  const isOverLimit = charCount > MAX_CHARS

  const handleTextChange = (e) => {
    if (readOnly) return
    onChange({
      ...post,
      text: e.target.value
    })
  }

  const handleEmojiSelect = (emoji) => {
    if (readOnly) return
    const textarea = textareaRef.current
    const start = textarea.selectionStart
    const end = textarea.selectionEnd
    const newText = text.substring(0, start) + emoji.native + text.substring(end)

    onChange({
      ...post,
      text: newText
    })

    // Set cursor position after emoji
    setTimeout(() => {
      textarea.selectionStart = textarea.selectionEnd = start + emoji.native.length
      textarea.focus()
    }, 0)

    setShowEmojiPicker(false)
  }

  const handleImagesChange = (newImages) => {
    if (readOnly) return
    onChange({
      ...post,
      images: newImages,
      embeddedTweet: null // Clear embedded tweet if images are added
    })
  }

  const handleEmbedTweetChange = (url) => {
    if (readOnly) return
    onChange({
      ...post,
      embeddedTweet: url,
      images: [] // Clear images if tweet is embedded
    })
  }

  const handleRemoveEmbed = () => {
    if (readOnly) return
    onChange({
      ...post,
      embeddedTweet: null
    })
  }

  return (
    <div className="post-box">
      <div className="post-header">
        <span className="post-number">{index + 1}/{totalPosts}</span>
        {!readOnly && onRemove && totalPosts > 1 && (
          <button
            className="remove-post-btn"
            onClick={onRemove}
            title="Remove post"
          >
            ×
          </button>
        )}
      </div>

      <div className="post-content">
        <textarea
          ref={textareaRef}
          value={text}
          onChange={handleTextChange}
          placeholder={index === 0 ? "Start your thread..." : "Continue your thread..."}
          className={`post-textarea ${isOverLimit ? 'over-limit' : ''}`}
          rows={4}
          readOnly={readOnly}
        />

        <div className="post-footer">
          <div className="post-controls">
            {!readOnly && (
              <>
                <button
                  className="emoji-btn"
                  onClick={() => setShowEmojiPicker(!showEmojiPicker)}
                  title="Add emoji"
                >
                  😀
                </button>
                {showEmojiPicker && (
                  <EmojiPicker
                    onSelect={handleEmojiSelect}
                    onClose={() => setShowEmojiPicker(false)}
                  />
                )}
              </>
            )}
          </div>

          <div className={`char-counter ${isOverLimit ? 'over-limit' : ''}`}>
            {charCount}/{MAX_CHARS}
          </div>
        </div>

        {!readOnly && !embeddedTweet && (
          <ImageUpload
            images={images}
            onChange={handleImagesChange}
            postId={post.id}
          />
        )}

        {!readOnly && !images.length && (
          <div className="embed-input">
            <input
              type="text"
              placeholder="Paste tweet URL to embed..."
              value={embeddedTweet || ''}
              onChange={(e) => handleEmbedTweetChange(e.target.value)}
              className="embed-url-input"
            />
          </div>
        )}

        {embeddedTweet && (
          <div className="embedded-tweet-container">
            <TweetEmbed url={embeddedTweet} />
            {!readOnly && (
              <button
                className="remove-embed-btn"
                onClick={handleRemoveEmbed}
              >
                Remove embed
              </button>
            )}
          </div>
        )}

        {images.length > 0 && (
          <div className="image-preview-grid">
            {images.map((url, idx) => (
              <div key={idx} className="image-preview-item">
                <img src={url} alt={`Preview ${idx + 1}`} />
                {!readOnly && (
                  <button
                    className="remove-image-btn"
                    onClick={() => handleImagesChange(images.filter((_, i) => i !== idx))}
                  >
                    ×
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
