import { useState, useRef, useEffect } from 'react'
import EmojiPicker from './EmojiPicker'
import ImageUpload from './ImageUpload'
import TweetEmbed from './TweetEmbed'

const MAX_CHARS = 280
// More flexible regex that handles query params and matches common image patterns
const IMAGE_URL_REGEX = /https?:\/\/[^\s]+?\.(jpg|jpeg|png|gif|webp|bmp|svg)(\?[^\s]*)?/gi

export default function PostBox({ post, index, totalPosts, onChange, onRemove, readOnly = false }) {
  const [showEmojiPicker, setShowEmojiPicker] = useState(false)
  const [detectingUrls, setDetectingUrls] = useState(false)
  const [currentImageIndex, setCurrentImageIndex] = useState(0)
  const textareaRef = useRef(null)
  const imageUploadRef = useRef(null)
  const urlDetectionTimeoutRef = useRef(null)

  const text = post?.text || ''
  const images = post?.images || []
  const embeddedTweet = post?.embeddedTweet || null
  const charCount = text.length
  const isOverLimit = charCount > MAX_CHARS

  // Detect RTL text (Hebrew, Arabic, etc.)
  const detectRTL = (text) => {
    const rtlRegex = /[\u0591-\u07FF\u200F\u202B\u202E\uFB1D-\uFDFD\uFE70-\uFEFC]/
    return rtlRegex.test(text)
  }

  const isRTL = detectRTL(text)

  const handleTextChange = (e) => {
    if (readOnly) return
    const newText = e.target.value
    onChange({
      ...post,
      text: newText
    })

    // Debounce URL detection
    if (urlDetectionTimeoutRef.current) {
      clearTimeout(urlDetectionTimeoutRef.current)
    }

    urlDetectionTimeoutRef.current = setTimeout(() => {
      detectAndConvertImageUrls(newText)
    }, 500)
  }

  const detectAndConvertImageUrls = async (text) => {
    if (readOnly || !imageUploadRef.current) {
      console.log('[detectAndConvertImageUrls] Skipped - readOnly or no imageUploadRef')
      return
    }

    console.log('[detectAndConvertImageUrls] Checking text:', text)
    const matches = [...text.matchAll(IMAGE_URL_REGEX)]
    console.log('[detectAndConvertImageUrls] Regex matches:', matches.length, matches.map(m => m[0]))

    if (matches.length === 0) return

    const imageUrls = matches.map(match => match[0])
    const remainingSlots = 4 - images.length

    if (remainingSlots <= 0) {
      console.log('[detectAndConvertImageUrls] No remaining image slots, skipping URL detection')
      return
    }

    const urlsToConvert = imageUrls.slice(0, remainingSlots)
    if (urlsToConvert.length === 0) return

    console.log(`[detectAndConvertImageUrls] Converting ${urlsToConvert.length} URL(s):`, urlsToConvert)
    setDetectingUrls(true)

    try {
      const convertedUrls = []
      for (const url of urlsToConvert) {
        console.log(`Attempting to fetch: ${url}`)
        const result = await imageUploadRef.current.addImageFromUrl(url)
        if (result) {
          console.log(`Successfully converted: ${url}`)
          convertedUrls.push(url)
        } else {
          console.warn(`Failed to convert: ${url}`)
        }
      }

      // Remove successfully converted URLs from text
      if (convertedUrls.length > 0) {
        let updatedText = text
        for (const url of convertedUrls) {
          updatedText = updatedText.replace(url, '').replace(/\s+/g, ' ').trim()
        }
        onChange({
          ...post,
          text: updatedText
        })
        console.log(`Removed ${convertedUrls.length} URL(s) from text`)
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
    console.log('[PostBox handleImagesChange] Received new images:', newImages)
    console.log('[PostBox handleImagesChange] Current post:', post)
    const updatedPost = {
      ...post,
      images: newImages
    }
    console.log('[PostBox handleImagesChange] Updated post:', updatedPost)
    onChange(updatedPost)
  }

  const handleEmbedTweetChange = (url) => {
    if (readOnly) return
    onChange({
      ...post,
      embeddedTweet: url
    })
  }

  const handleRemoveEmbed = () => {
    if (readOnly) return
    onChange({
      ...post,
      embeddedTweet: null
    })
  }

  const nextImage = () => {
    setCurrentImageIndex((prev) => (prev + 1) % images.length)
  }

  const prevImage = () => {
    setCurrentImageIndex((prev) => (prev - 1 + images.length) % images.length)
  }

  const removeCurrentImage = () => {
    const newImages = images.filter((_, i) => i !== currentImageIndex)
    handleImagesChange(newImages)
    // Adjust index if needed
    if (currentImageIndex >= newImages.length && newImages.length > 0) {
      setCurrentImageIndex(newImages.length - 1)
    } else if (newImages.length === 0) {
      setCurrentImageIndex(0)
    }
  }

  // Reset carousel index when images change
  useEffect(() => {
    if (currentImageIndex >= images.length && images.length > 0) {
      setCurrentImageIndex(images.length - 1)
    }
  }, [images.length, currentImageIndex])

  const handleCopyText = async () => {
    try {
      await navigator.clipboard.writeText(text)
      // Could add a toast notification here if you want
      const button = document.activeElement
      if (button && button.classList.contains('copy-post-btn')) {
        const originalText = button.innerHTML
        button.innerHTML = '✓ Copied'
        button.classList.add('copied')
        setTimeout(() => {
          button.innerHTML = originalText
          button.classList.remove('copied')
        }, 2000)
      }
    } catch (err) {
      console.error('Failed to copy text:', err)
      alert('Failed to copy to clipboard')
    }
  }

  return (
    <div className="post-box">
      <div className="post-header">
        <span className="post-number">{index + 1}/{totalPosts}</span>
        <div className="post-header-actions">
          <button
            className="copy-post-btn"
            onClick={handleCopyText}
            title="Copy post text"
            disabled={!text}
          >
            📋 Copy
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

        {!readOnly && (
          <ImageUpload
            ref={imageUploadRef}
            images={images}
            onChange={handleImagesChange}
            postId={post.id}
          />
        )}

        {detectingUrls && (
          <div className="url-detection-status">
            Detecting and converting image URLs...
          </div>
        )}

        {!readOnly && (
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

        {images.length > 0 && (() => {
          console.log('[PostBox render] Rendering images:', images)
          const img = images[currentImageIndex]
          console.log(`[PostBox render] Current image ${currentImageIndex}:`, img, typeof img)

          const imageUrl = typeof img === 'string' ? img : img.url
          const sourceUrl = typeof img === 'object' ? img.sourceUrl : null
          const uploadMethod = typeof img === 'object' ? img.uploadMethod : 'file'

          console.log(`[PostBox render] Image ${currentImageIndex} - url: ${imageUrl}, sourceUrl: ${sourceUrl}, method: ${uploadMethod}`)

          const methodIcon = {
            'file': '📁',
            'clipboard': '📋',
            'url': '🔗'
          }[uploadMethod] || '📁'

          return (
            <div className="image-carousel">
              <div className="image-carousel-container">
                <img src={imageUrl} alt={`Preview ${currentImageIndex + 1}`} className="carousel-image" />

                <div className="carousel-overlay">
                  <span className="upload-method-badge">{methodIcon}</span>

                  {sourceUrl && (
                    <a
                      href={sourceUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="source-url-link"
                      title={`Source: ${sourceUrl}`}
                      onClick={(e) => e.stopPropagation()}
                    >
                      🔗
                    </a>
                  )}

                  {!readOnly && (
                    <button
                      className="remove-image-btn"
                      onClick={removeCurrentImage}
                      title="Remove image"
                    >
                      ×
                    </button>
                  )}
                </div>

                {images.length > 1 && (
                  <>
                    <button className="carousel-nav carousel-prev" onClick={prevImage} title="Previous image">
                      ‹
                    </button>
                    <button className="carousel-nav carousel-next" onClick={nextImage} title="Next image">
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
                      className={`carousel-indicator ${idx === currentImageIndex ? 'active' : ''}`}
                      onClick={() => setCurrentImageIndex(idx)}
                      title={`Image ${idx + 1}`}
                    />
                  ))}
                  <span className="carousel-counter">
                    {currentImageIndex + 1} / {images.length}
                  </span>
                </div>
              )}
            </div>
          )
        })()}
      </div>
    </div>
  )
}
