import { useState, useRef } from 'react'
import { useParams } from 'react-router-dom'
import { supabase, uploadImage } from '../utils/supabase'

const MAX_IMAGES = 4
const MAX_FILE_SIZE = 5 * 1024 * 1024 // 5MB
const MAX_IMAGE_WIDTH = 1920

export default function ImageUpload({ images = [], onChange, postId }) {
  const [uploading, setUploading] = useState(false)
  const [dragActive, setDragActive] = useState(false)
  const [error, setError] = useState(null)
  const fileInputRef = useRef(null)
  const { id: draftId } = useParams()

  const canAddMore = images.length < MAX_IMAGES

  const compressImage = (file) => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.readAsDataURL(file)
      reader.onload = (e) => {
        const img = new Image()
        img.src = e.target.result
        img.onload = () => {
          const canvas = document.createElement('canvas')
          let width = img.width
          let height = img.height

          // Resize if larger than MAX_IMAGE_WIDTH
          if (width > MAX_IMAGE_WIDTH) {
            height = (height * MAX_IMAGE_WIDTH) / width
            width = MAX_IMAGE_WIDTH
          }

          canvas.width = width
          canvas.height = height

          const ctx = canvas.getContext('2d')
          ctx.drawImage(img, 0, 0, width, height)

          canvas.toBlob(
            (blob) => {
              resolve(new File([blob], file.name, {
                type: file.type,
                lastModified: Date.now()
              }))
            },
            file.type,
            0.9 // quality
          )
        }
        img.onerror = reject
      }
      reader.onerror = reject
    })
  }

  const handleFiles = async (files) => {
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
        return url
      })

      const urls = await Promise.all(uploadPromises)
      onChange([...images, ...urls])
    } catch (err) {
      console.error('Upload error:', err)
      setError(err.message || 'Failed to upload images')
    } finally {
      setUploading(false)
    }
  }

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

        {uploading ? (
          <div className="upload-status">Uploading...</div>
        ) : (
          <div className="upload-prompt">
            <span className="upload-icon">📷</span>
            <span>Drag images here or click to upload ({images.length}/{MAX_IMAGES})</span>
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
}
