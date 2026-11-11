import { useState, useRef, useEffect, lazy, Suspense } from 'react'
import ImageUpload from './ImageUpload'

const EmojiPicker = lazy(() => import('./EmojiPicker'))
const TweetEmbed = lazy(() => import('./TweetEmbed'))

const MAX_CHARS = 280
const IMAGE_URL_REGEX = /https?:\/\/[^\s]+?\.(jpg|jpeg|png|gif|webp|bmp|svg)(\?[^\s]*)?/gi

export default function PostBox({ post, index, totalPosts, onChange, onRemove, readOnly = false, dragHandleProps }) {
  const [showEmojiPicker, setShowEmojiPicker] = useState(false)
  const [showEmbedInput, setShowEmbedInput] = useState(false)
  const [detectingUrls, setDetectingUrls] = useState(false)
  const [currentImageIndex, setCurrentImageIndex] = useState(0)
  const [embedVisible, setEmbedVisible] = useState(false)
  const embedShown = embedVisible || typeof IntersectionObserver === 'undefined'
  const textareaRef = useRef(null)
  const imageUploadRef = useRef(null)
  const urlDetectionTimeoutRef = useRef(null)
  const embedContainerRef = useRef(null)

  const text = post?.text || ''
  const images = post?.images || []
  // The stored index can point past the end after a removal; clamp it here rather than in an effect.
  const imageIndex = images.length > 0 ? Math.min(currentImageIndex, images.length - 1) : currentImageIndex
  const embeddedTweet = post?.embeddedTweet || null
  const charCount = text.length
  const isOverLimit = charCount > MAX_CHARS

  const detectRTL = (text) => {
    const rtlRegex = /[\u0591-\u07FF\u200F\u202B\u202E\uFB1D-\uFDFD\uFE70-\uFEFC]/
    return rtlRegex.test(text)
  }

  const isRTL = detectRTL(text)

  const handleTextChange = (e) => {
    if (readOnly) return
    const newText = e.target.value
    onChange({ ...post, text: newText })

    autoResizeTextarea()

    if (urlDetectionTimeoutRef.current) {
      clearTimeout(urlDetectionTimeoutRef.current)
    }
    urlDetectionTimeoutRef.current = setTimeout(() => {
      detectAndConvertImageUrls(newText)
    }, 500)
  }

  const autoResizeTextarea = () => {
    const textarea = textareaRef.current
    if (textarea) {
      textarea.style.height = 'auto'
      textarea.style.height = Math.max(textarea.scrollHeight, 120) + 'px'
    }
  }

  useEffect(() => {
    autoResizeTextarea()
  }, [text])

  const detectAndConvertImageUrls = async (text) => {
    if (readOnly || !imageUploadRef.current) return

    const matches = [...text.matchAll(IMAGE_URL_REGEX)]
    if (matches.length === 0) return

    const imageUrls = matches.map(match => match[0])
    const remainingSlots = 4 - images.length
    if (remainingSlots <= 0) return

    const urlsToConvert = imageUrls.slice(0, remainingSlots)
    if (urlsToConvert.length === 0) return

    setDetectingUrls(true)

    try {
      const convertedUrls = []
      for (const url of urlsToConvert) {
        const result = await imageUploadRef.current.addImageFromUrl(url)
        if (result) {
          convertedUrls.push(url)
        }
      }

      if (convertedUrls.length > 0) {
        let updatedText = text
        for (const url of convertedUrls) {
          updatedText = updatedText.replace(url, '').replace(/\s+/g, ' ').trim()
        }
        onChange({ ...post, text: updatedText })
      }
    } catch (error) {
      console.error('Error during URL detection:', error)
    } finally {
      setDetectingUrls(false)
    }
  }

  const handlePaste = async (e) => {
    if (readOnly || !imageUploadRef.current) return

    const items = e.clipboardData?.items
    if (!items) return

    for (const item of items) {
      if (item.type.startsWith('image/')) {
        e.preventDefault()
        const file = item.getAsFile()
        if (file) {
          await imageUploadRef.current.addFiles([file])
        }
      }
    }
  }

  useEffect(() => {
    return () => {
      if (urlDetectionTimeoutRef.current) {
        clearTimeout(urlDetectionTimeoutRef.current)
      }
    }
  }, [])

  useEffect(() => {
    if (!embeddedTweet || embedVisible) return
    const node = embedContainerRef.current
    if (!node) return

    // Without IntersectionObserver the embed is shown during render (see embedShown), so nothing to observe.
    if (typeof IntersectionObserver === 'undefined') return

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setEmbedVisible(true)
          observer.disconnect()
        }
      },
      { rootMargin: '200px' }
    )
    observer.observe(node)
    return () => observer.disconnect()
  }, [embeddedTweet, embedVisible])

  const handleEmojiSelect = (emoji) => {
    if (readOnly) return
    const textarea = textareaRef.current
    const start = textarea.selectionStart
    const end = textarea.selectionEnd
    const newText = text.substring(0, start) + emoji.native + text.substring(end)

    onChange({ ...post, text: newText })

    setTimeout(() => {
      textarea.selectionStart = textarea.selectionEnd = start + emoji.native.length
      textarea.focus()
    }, 0)

    setShowEmojiPicker(false)
  }

  const handleImagesChange = (newImages) => {
    if (readOnly) return
    onChange({ ...post, images: newImages })
  }

  const handleEmbedTweetChange = (url) => {
    if (readOnly) return
    onChange({ ...post, embeddedTweet: url })
  }

  const handleRemoveEmbed = () => {
    if (readOnly) return
    onChange({ ...post, embeddedTweet: null })
    setShowEmbedInput(false)
  }

  const nextImage = () => {
    setCurrentImageIndex((imageIndex + 1) % images.length)
  }

  const prevImage = () => {
    setCurrentImageIndex((imageIndex - 1 + images.length) % images.length)
  }

  const removeCurrentImage = () => {
    const newImages = images.filter((_, i) => i !== imageIndex)
    handleImagesChange(newImages)
    if (imageIndex >= newImages.length && newImages.length > 0) {
      setCurrentImageIndex(newImages.length - 1)
    } else if (newImages.length === 0) {
      setCurrentImageIndex(0)
    }
  }

  const handleCopyText = async () => {
    try {
      await navigator.clipboard.writeText(text)
      const button = document.activeElement
      if (button && button.classList.contains('copy-post-btn')) {
        const originalText = button.textContent
        button.textContent = '\u2713 Copied'
        button.classList.add('copied')
        setTimeout(() => {
          button.textContent = originalText
          button.classList.remove('copied')
        }, 2000)
      }
    } catch (err) {
      console.error('Failed to copy text:', err)
    }
  }

  return (
    <div className="post-box">
      <div className="post-header">
        {dragHandleProps && (
          <button
            className="drag-handle"
            title="Drag to reorder"
            aria-label={`Drag to reorder post ${index + 1}`}
            {...dragHandleProps}
          >
            ⠿
          </button>
        )}
        <span className="post-number">{index + 1}/{totalPosts}</span>
        <div className="post-header-actions">
          <button
            className="copy-post-btn"
            onClick={handleCopyText}
            title="Copy post text"
            disabled={!text}
          >
            Copy
          </button>
          <RemovePostButton
            readOnly={readOnly}
            onRemove={onRemove}
            totalPosts={totalPosts}
            index={index}
          />
        </div>
      </div>

      <div className="post-content">
        <textarea
          ref={textareaRef}
          value={text}
          onChange={handleTextChange}
          onPaste={handlePaste}
          aria-label={`Post ${index + 1} text`}
          placeholder={index === 0 ? "Start your thread..." : "Continue your thread..."}
          className={`post-textarea ${isOverLimit ? 'over-limit' : ''} ${isRTL ? 'rtl' : ''}`}
          dir={isRTL ? 'rtl' : 'ltr'}
          rows={6}
          readOnly={readOnly}
          style={{ overflow: 'hidden' }}
        />

        <div className="post-toolbar">
          <ToolbarActions
            readOnly={readOnly}
            showEmojiPicker={showEmojiPicker}
            setShowEmojiPicker={setShowEmojiPicker}
            onEmojiSelect={handleEmojiSelect}
            imageUploadRef={imageUploadRef}
            imageCount={images.length}
            showEmbedInput={showEmbedInput}
            setShowEmbedInput={setShowEmbedInput}
            embedActive={Boolean(showEmbedInput || embeddedTweet)}
          />

          <CharCounter count={charCount} max={MAX_CHARS} over={isOverLimit} />
        </div>

        <UrlDetectionStatus show={detectingUrls} />

        <EmbedInput
          readOnly={readOnly}
          show={showEmbedInput}
          value={embeddedTweet || ''}
          onChange={handleEmbedTweetChange}
        />

        {embeddedTweet && (
          <EmbedArea
            embeddedTweet={embeddedTweet}
            embedShown={embedShown}
            containerRef={embedContainerRef}
            readOnly={readOnly}
            onRemove={handleRemoveEmbed}
          />
        )}

        {!readOnly && (
          <ImageUpload
            ref={imageUploadRef}
            images={images}
            onChange={handleImagesChange}
            postId={post.id}
          />
        )}

        {images.length > 0 && (
          <ImageCarousel
            images={images}
            imageIndex={imageIndex}
            readOnly={readOnly}
            onRemoveCurrent={removeCurrentImage}
            onPrev={prevImage}
            onNext={nextImage}
            onSelect={setCurrentImageIndex}
          />
        )}
      </div>
    </div>
  )
}

// The embedded tweet and its remove button. Split out of PostBox to keep it within the lint complexity limit.
function EmbedArea({ embeddedTweet, embedShown, containerRef, readOnly, onRemove }) {
  return (
    <div className="embedded-tweet-container" ref={containerRef}>
      {embedShown ? (
        <Suspense fallback={<div className="tweet-embed-loading">Loading tweet…</div>}>
          <TweetEmbed url={embeddedTweet} />
        </Suspense>
      ) : (
        <div className="tweet-embed-loading">Tweet will load when visible…</div>
      )}
      {!readOnly && (
        <button className="remove-embed-btn" onClick={onRemove}>
          Remove embed
        </button>
      )}
    </div>
  )
}

// The image carousel for a post's images. Split out of PostBox to keep it within the lint complexity limit.
function ImageCarousel({ images, imageIndex, readOnly, onRemoveCurrent, onPrev, onNext, onSelect }) {
  const img = images[imageIndex]
  const imageUrl = typeof img === 'string' ? img : img.url

  return (
    <div className="image-carousel">
      <div className="image-carousel-container">
        <img
          src={imageUrl}
          alt={`Preview ${imageIndex + 1}`}
          className="carousel-image"
          loading="lazy"
          decoding="async"
        />

        <div className="carousel-overlay">
          {!readOnly && (
            <button className="remove-image-btn" onClick={onRemoveCurrent} title="Remove image">
              Remove image
            </button>
          )}
        </div>

        {images.length > 1 && (
          <>
            <button className="carousel-nav carousel-prev" onClick={onPrev} title="Previous image" aria-label="Previous image">
              ‹
            </button>
            <button className="carousel-nav carousel-next" onClick={onNext} title="Next image" aria-label="Next image">
              ›
            </button>
          </>
        )}
      </div>

      {images.length > 1 && (
        <div className="carousel-indicators">
          {images.map((_, idx) => (
            <button
              key={idx}
              className={`carousel-indicator ${idx === imageIndex ? 'active' : ''}`}
              onClick={() => onSelect(idx)}
              title={`Image ${idx + 1}`}
            />
          ))}
          <span className="carousel-counter">
            {imageIndex + 1} / {images.length}
          </span>
        </div>
      )}
    </div>
  )
}

// The post's toolbar buttons (emoji, image, embed). Not shown read-only. Split out of PostBox for the lint complexity limit.
function ToolbarActions({
  readOnly,
  showEmojiPicker,
  setShowEmojiPicker,
  onEmojiSelect,
  imageUploadRef,
  imageCount,
  showEmbedInput,
  setShowEmbedInput,
  embedActive
}) {
  if (readOnly) return null
  return (
    <div className="toolbar-actions">
      <button
        className="toolbar-btn"
        onClick={() => setShowEmojiPicker(!showEmojiPicker)}
        title="Add emoji"
        aria-label="Add emoji"
      >
        😀
      </button>
      {showEmojiPicker && (
        <Suspense fallback={<div className="emoji-picker-loading">Loading…</div>}>
          <EmojiPicker
            onSelect={onEmojiSelect}
            onClose={() => setShowEmojiPicker(false)}
          />
        </Suspense>
      )}

      <button
        className="toolbar-btn"
        onClick={() => imageUploadRef.current?.triggerFileSelect()}
        title="Add image"
        aria-label="Add image"
        disabled={imageCount >= 4}
      >
        📷
      </button>

      <button
        className={`toolbar-btn ${embedActive ? 'active' : ''}`}
        onClick={() => setShowEmbedInput(!showEmbedInput)}
        title="Embed tweet"
        aria-label="Embed tweet"
      >
        🔗
      </button>
    </div>
  )
}

// The tweet URL input shown when the embed button is on. Split out of PostBox for the lint complexity limit.
function EmbedInput({ readOnly, show, value, onChange }) {
  if (readOnly || !show) return null
  return (
    <div className="embed-input">
      <input
        type="text"
        placeholder="Paste tweet URL to embed..."
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="embed-url-input"
        aria-label="Tweet URL"
        autoFocus
      />
    </div>
  )
}

// The Remove button on a post when the thread has more than one post. Split out of PostBox for the lint complexity limit.
function RemovePostButton({ readOnly, onRemove, totalPosts, index }) {
  if (readOnly || !onRemove || totalPosts <= 1) return null
  return (
    <button
      className="remove-post-btn"
      onClick={onRemove}
      title="Remove post"
      aria-label={`Remove post ${index + 1}`}
    >
      Remove
    </button>
  )
}

// The character count under the post text. Split out of PostBox for the lint complexity limit.
function CharCounter({ count, max, over }) {
  return (
    <div className={`char-counter ${over ? 'over-limit' : ''}`}>
      {count}/{max}
      {over && ` (${count - max} over)`}
    </div>
  )
}

// Shown while pasted or typed image URLs are being converted. Split out of PostBox for the lint complexity limit.
function UrlDetectionStatus({ show }) {
  if (!show) return null
  return (
    <div className="url-detection-status" role="status" aria-live="polite">
      Detecting and converting image URLs...
    </div>
  )
}
