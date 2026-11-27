import { useState, useRef, forwardRef, useImperativeHandle } from 'react'
import { useParams } from 'react-router-dom'
import { uploadImage, uploadImageFromUrl } from '../utils/images'
import { beginUpload, endUpload } from '../utils/pendingUploads'
import { compressImage } from '../utils/compressImage'
import Banner from '../ui/Banner'
import Icon from '../ui/Icon'
import { useViewAsReason } from '../utils/viewAs'
import './ImageUpload.css'

const MAX_IMAGES = 4
const MAX_FILE_SIZE = 5 * 1024 * 1024 // 5MB before compression
const NOT_LOGGED_IN = 'You must be logged in to upload images'

// Map an upload error to the message shown to the user.
const uploadErrorMessage = (err) => (err.status === 401 ? NOT_LOGGED_IN : err.message || 'Failed to upload images')

const ImageUpload = forwardRef(({ images = [], onChange }, ref) => {
  const [uploading, setUploading] = useState(false)
  const [dragActive, setDragActive] = useState(false)
  const [error, setError] = useState(null)
  const [urlLoading, setUrlLoading] = useState(false)
  const fileInputRef = useRef(null)
  const { id: draftId } = useParams()
  const reason = useViewAsReason()

  const canAddMore = images.length < MAX_IMAGES

  const handleFiles = async (files, uploadMethod = 'file') => {
    if (reason) return
    setError(null)

    const fileArray = Array.from(files)
    const remainingSlots = MAX_IMAGES - images.length

    if (fileArray.length > remainingSlots) {
      setError(`You can only upload ${remainingSlots} more image(s)`)
      return
    }

    // Validate files
    for (const file of fileArray) {
      if (!file.type.startsWith('image/')) {
        setError('Only image files are allowed')
        return
      }
      if (file.size > MAX_FILE_SIZE) {
        setError('Image size must be less than 5MB')
        return
      }
    }

    setUploading(true)
    beginUpload()

    try {
      const uploadPromises = fileArray.map(async (file) => {
        // Compress image
        const compressedFile = await compressImage(file)
        const url = await uploadImage(compressedFile, draftId || 'temp')
        return {
          url,
          uploadMethod
        }
      })

      const imageObjects = await Promise.all(uploadPromises)
      onChange([...images, ...imageObjects])
    } catch (err) {
      console.error('Upload error:', err)
      setError(uploadErrorMessage(err))
    } finally {
      endUpload()
      setUploading(false)
    }
  }

  const handleImageFromUrl = async (imageUrl) => {
    setError(null)
    const remainingSlots = MAX_IMAGES - images.length

    if (remainingSlots <= 0) {
      const errorMsg = 'Maximum 4 images reached'
      setError(errorMsg)
      console.warn(errorMsg)
      return null
    }

    setUrlLoading(true)
    beginUpload()

    try {
      console.log(`Fetching image from URL: ${imageUrl}`)
      const imageObject = await uploadImageFromUrl(imageUrl, draftId || 'temp')
      console.log('Image uploaded successfully:', imageObject)

      const newImages = [...images, imageObject]
      console.log('[ImageUpload] Calling onChange with new images array:', newImages)
      onChange(newImages)

      // Clear error after 3 seconds on success
      setTimeout(() => setError(null), 3000)

      return imageObject
    } catch (err) {
      console.error('URL upload error:', err)
      const errorMsg = err.status === 401 ? NOT_LOGGED_IN : err.message || 'Failed to fetch image from URL'
      setError(`${errorMsg} - URL: ${imageUrl.substring(0, 50)}...`)

      // Auto-clear error after 5 seconds
      setTimeout(() => setError(null), 5000)

      return null
    } finally {
      endUpload()
      setUrlLoading(false)
    }
  }

  // Expose methods to parent via ref
  useImperativeHandle(ref, () => ({
    addFiles: (files) => handleFiles(files, 'clipboard'),
    addImageFromUrl: (url) => (reason ? undefined : handleImageFromUrl(url)),
    triggerFileSelect: () => handleClick()
  }))

  const handleDrag = (e) => {
    e.preventDefault()
    e.stopPropagation()
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setDragActive(true)
    } else if (e.type === 'dragleave') {
      setDragActive(false)
    }
  }

  const handleDrop = (e) => {
    e.preventDefault()
    e.stopPropagation()
    setDragActive(false)

    if (!canAddMore) return

    const files = e.dataTransfer.files
    if (files && files.length > 0) {
      handleFiles(files)
    }
  }

  const handleChange = (e) => {
    const files = e.target.files
    if (files && files.length > 0) {
      handleFiles(files)
    }
  }

  const handleClick = () => {
    if (canAddMore && !uploading && !reason) {
      fileInputRef.current?.click()
    }
  }

  // Enter or Space opens the file picker, as a click does.
  const handleKeyDown = (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      handleClick()
    }
  }

  if (!canAddMore && images.length > 0) {
    return null // Hide upload area if max images reached
  }

  return (
    <div className="image-upload">
      <div
        className={`image-upload-area${dragActive ? ' is-drag-active' : ''}${uploading ? ' is-uploading' : ''}`}
        role="button"
        tabIndex={0}
        aria-disabled={!canAddMore || uploading || Boolean(reason)}
        onDragEnter={handleDrag}
        onDragLeave={handleDrag}
        onDragOver={handleDrag}
        onDrop={handleDrop}
        onClick={handleClick}
        onKeyDown={handleKeyDown}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          onChange={handleChange}
          hidden
        />

        {uploading || urlLoading ? (
          <div className="image-upload-status" role="status" aria-live="polite">
            {uploading ? 'Uploading…' : 'Fetching image…'}
          </div>
        ) : (
          <div className="image-upload-prompt">
            <Icon name="image" size="lg" />
            <span>{reason ?? `Drag, paste or click to add images (${images.length} of ${MAX_IMAGES})`}</span>
          </div>
        )}
      </div>

      {error && (
        <Banner tone="danger" role="alert">
          {error}
        </Banner>
      )}
    </div>
  )
})

ImageUpload.displayName = 'ImageUpload'

export default ImageUpload
