import { useState, useRef, forwardRef, useImperativeHandle } from 'react'
import { useParams } from 'react-router-dom'
import { supabase, uploadImage, uploadImageFromUrl } from '../utils/supabase'

const MAX_IMAGES = 4
const MAX_FILE_SIZE = 5 * 1024 * 1024 // 5MB
const MAX_IMAGE_WIDTH = 1600

const ImageUpload = forwardRef(({ images = [], onChange, postId }, ref) => {
  const [uploading, setUploading] = useState(false)
  const [dragActive, setDragActive] = useState(false)
  const [error, setError] = useState(null)
  const [urlLoading, setUrlLoading] = useState(false)
  const fileInputRef = useRef(null)
  const { id: draftId } = useParams()

  const canAddMore = images.length < MAX_IMAGES

  const compressImage = (file) => {
    return new Promise((resolve, reject) => {
      const objectUrl = URL.createObjectURL(file)
      const img = new Image()

      const cleanup = () => {
        URL.revokeObjectURL(objectUrl)
        img.onload = null
        img.onerror = null
        img.src = ''
      }

      img.onload = () => {
        let width = img.width
        let height = img.height

        if (width > MAX_IMAGE_WIDTH) {
          height = (height * MAX_IMAGE_WIDTH) / width
          width = MAX_IMAGE_WIDTH
        }

        const canvas = document.createElement('canvas')
        canvas.width = width
        canvas.height = height
        const ctx = canvas.getContext('2d')
        ctx.drawImage(img, 0, 0, width, height)

        canvas.toBlob(
          (blob) => {
            // Release the decoded bitmap and canvas backing store ASAP.
            canvas.width = 0
            canvas.height = 0
            cleanup()
            if (!blob) {
              reject(new Error('Compression failed'))
              return
            }
            resolve(new File([blob], file.name, {
              type: file.type,
              lastModified: Date.now()
            }))
          },
          file.type,
          0.9
        )
      }
      img.onerror = (err) => {
        cleanup()
        reject(err)
      }
      img.src = objectUrl
    })
  }

  const handleFiles = async (files, uploadMethod = 'file') => {
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

    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) {
        throw new Error('You must be logged in to upload images')
      }

      const uploadPromises = fileArray.map(async (file) => {
        // Compress image
        const compressedFile = await compressImage(file)
        // Upload to Supabase
        const url = await uploadImage(compressedFile, user.id, draftId || 'temp')
        return {
          url,
          uploadMethod
        }
      })

      const imageObjects = await Promise.all(uploadPromises)
      onChange([...images, ...imageObjects])
    } catch (err) {
      console.error('Upload error:', err)
      setError(err.message || 'Failed to upload images')
    } finally {
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

    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) {
        throw new Error('You must be logged in to upload images')
      }

      console.log(`Fetching image from URL: ${imageUrl}`)
      const imageObject = await uploadImageFromUrl(imageUrl, user.id, draftId || 'temp')
      console.log('Image uploaded successfully:', imageObject)

      const newImages = [...images, imageObject]
      console.log('[ImageUpload] Calling onChange with new images array:', newImages)
      onChange(newImages)

      // Clear error after 3 seconds on success
      setTimeout(() => setError(null), 3000)

      return imageObject
    } catch (err) {
      console.error('URL upload error:', err)
      const errorMsg = err.message || 'Failed to fetch image from URL'
      setError(`${errorMsg} - URL: ${imageUrl.substring(0, 50)}...`)

      // Auto-clear error after 5 seconds
      setTimeout(() => setError(null), 5000)

      return null
    } finally {
      setUrlLoading(false)
    }
  }

  // Expose methods to parent via ref
  useImperativeHandle(ref, () => ({
    addFiles: (files) => handleFiles(files, 'clipboard'),
    addImageFromUrl: (url) => handleImageFromUrl(url),
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
    if (canAddMore && !uploading) {
      fileInputRef.current?.click()
    }
  }

  if (!canAddMore && images.length > 0) {
    return null // Hide upload area if max images reached
  }

  return (
    <div className="image-upload">
      <div
        className={`upload-area ${dragActive ? 'drag-active' : ''} ${uploading ? 'uploading' : ''}`}
        onDragEnter={handleDrag}
        onDragLeave={handleDrag}
        onDragOver={handleDrag}
        onDrop={handleDrop}
        onClick={handleClick}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          onChange={handleChange}
          style={{ display: 'none' }}
        />

        {uploading || urlLoading ? (
          <div className="upload-status">
            {uploading ? 'Uploading...' : 'Fetching image...'}
          </div>
        ) : (
          <div className="upload-prompt">
            <span className="upload-icon">📷</span>
            <span>Drag, paste, or click to upload ({images.length}/{MAX_IMAGES})</span>
          </div>
        )}
      </div>

      {error && (
        <div className="upload-error">
          {error}
        </div>
      )}
    </div>
  )
})

ImageUpload.displayName = 'ImageUpload'

export default ImageUpload
