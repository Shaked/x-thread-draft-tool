import { useState, useRef, useEffect, lazy, Suspense } from 'react'
import ImageUpload from './ImageUpload'

const EmojiPicker = lazy(() => import('./EmojiPicker'))
const TweetEmbed = lazy(() => import('./TweetEmbed'))

const MAX_CHARS = 280
const IMAGE_URL_REGEX = /https?:\/\/[^\s]+?\.(jpg|jpeg|png|gif|webp|bmp|svg)(\?[^\s]*)?/gi

function PostToolbar({ readOnly, showEmojiPicker, setShowEmojiPicker, onEmojiSelect, imageUploadRef, imageCount, showEmbedInput, setShowEmbedInput, embeddedTweet }) {
  if (readOnly) return null
  return (
    <div className="toolbar-actions">
      <button
        className="toolbar-btn"
        onClick={() => setShowEmojiPicker(!showEmojiPicker)}
        title="Add emoji"
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
        disabled={imageCount >= 4}
      >
        📷
      </button>

      <button
        className={`toolbar-btn ${showEmbedInput || embeddedTweet ? 'active' : ''}`}
        onClick={() => setShowEmbedInput(!showEmbedInput)}
        title="Embed tweet"
      >
        🔗
      </button>
    </div>
  )
}

function EmbedArea({ readOnly, showEmbedInput, embeddedTweet, embedVisible, containerRef, onEmbedChange, onRemoveEmbed }) {
  return (
    <>
    {!readOnly && showEmbedInput && (
      <div className="embed-input">
        <input
          type="text"
          placeholder="Paste tweet URL to embed..."
          value={embeddedTweet || ''}
          onChange={(e) => onEmbedChange(e.target.value)}
          className="embed-url-input"
          autoFocus
        />
      </div>
    )}

    {embeddedTweet && (
      <div className="embedded-tweet-container" ref={containerRef}>
        {embedVisible ? (
          <Suspense fallback={<div className="tweet-embed-loading">Loading tweet…</div>}>
            <TweetEmbed url={embeddedTweet} />
          </Suspense>
        ) : (
          <div className="tweet-embed-loading">Tweet will load when visible…</div>
        )}
        {!readOnly && (
          <button
            className="remove-embed-btn"
            onClick={onRemoveEmbed}
          >
            Remove embed
          </button>
        )}
      </div>
    )}
    </>
  )
}

function ImageCarousel({ images, imageIndex, readOnly, onSelect, onPrev, onNext, onRemove }) {
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
            <button
              className="remove-image-btn"
              onClick={onRemove}
              title="Remove image"
            >
              ×
            </button>
          )}
        </div>

        {images.length > 1 && (
          <>
            <button className="carousel-nav carousel-prev" onClick={onPrev} title="Previous image">
              ‹
            </button>
            <button className="carousel-nav carousel-next" onClick={onNext} title="Next image">
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

export default function PostBox({ post, index, totalPosts, onChange, onRemove, readOnly = false, dragHandleProps }) {
  const [showEmojiPicker, setShowEmojiPicker] = useState(false)
  const [showEmbedInput, setShowEmbedInput] = useState(false)
  const [detectingUrls, setDetectingUrls] = useState(false)
  const [currentImageIndex, setCurrentImageIndex] = useState(0)
  const [embedVisible, setEmbedVisible] = useState(false)
  const textareaRef = useRef(null)
  const imageUploadRef = useRef(null)
  const urlDetectionTimeoutRef = useRef(null)
  const embedContainerRef = useRef(null)

  const text = post?.text || ''
  const images = post?.images || []
  // Keep the visible index inside the list when images are removed (derived, no effect).
  const imageIndex = Math.min(currentImageIndex, Math.max(images.length - 1, 0))
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

    if (typeof IntersectionObserver === 'undefined') {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- fallback when IntersectionObserver is missing; runs once per embed
      setEmbedVisible(true)
      return
    }

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
    setCurrentImageIndex((prev) => (prev + 1) % images.length)
  }

  const prevImage = () => {
    setCurrentImageIndex((prev) => (prev - 1 + images.length) % images.length)
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
      </div>

      <div className="post-content">
        <textarea
          ref={textareaRef}
          value={text}
          onChange={handleTextChange}
          onPaste={handlePaste}
          placeholder={index === 0 ? "Start your thread..." : "Continue your thread..."}
          className={`post-textarea ${isOverLimit ? 'over-limit' : ''} ${isRTL ? 'rtl' : ''}`}
          dir={isRTL ? 'rtl' : 'ltr'}
          rows={6}
          readOnly={readOnly}
          style={{ overflow: 'hidden' }}
        />

        <div className="post-toolbar">
          <PostToolbar
            readOnly={readOnly}
            showEmojiPicker={showEmojiPicker}
            setShowEmojiPicker={setShowEmojiPicker}
            onEmojiSelect={handleEmojiSelect}
            imageUploadRef={imageUploadRef}
            imageCount={images.length}
            showEmbedInput={showEmbedInput}
            setShowEmbedInput={setShowEmbedInput}
            embeddedTweet={embeddedTweet}
          />
          <div className={`char-counter ${isOverLimit ? 'over-limit' : ''}`}>
            {charCount}/{MAX_CHARS}
          </div>
        </div>

        {detectingUrls && (
          <div className="url-detection-status">
            Detecting and converting image URLs...
          </div>
        )}

        <EmbedArea
          readOnly={readOnly}
          showEmbedInput={showEmbedInput}
          embeddedTweet={embeddedTweet}
          embedVisible={embedVisible}
          containerRef={embedContainerRef}
          onEmbedChange={handleEmbedTweetChange}
          onRemoveEmbed={handleRemoveEmbed}
        />

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
            onSelect={setCurrentImageIndex}
            onPrev={prevImage}
            onNext={nextImage}
            onRemove={removeCurrentImage}
          />
        )}
      </div>
    </div>
  )
}
