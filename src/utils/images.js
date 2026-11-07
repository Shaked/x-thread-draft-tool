import { imagesApi } from './api.js'

// Helper function to check if user owns a draft
export const isOwner = (draft, userId) => {
  return draft?.user_id === userId
}

// Upload an image file for a draft. Resolves to the public Blob URL.
export const uploadImage = (file, draftId) => imagesApi.upload(file, draftId)

// Delete an image previously uploaded by the signed-in user.
export const deleteImage = (imageUrl) => imagesApi.remove(imageUrl)

// Helper function to upload image from URL
export const uploadImageFromUrl = async (imageUrl, draftId) => {
  try {
    console.log('[uploadImageFromUrl] Fetching:', imageUrl)

    const response = await fetch(imageUrl, {
      mode: 'cors',
      headers: {
        'Accept': 'image/*'
      }
    })

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`)
    }

    const blob = await response.blob()
    console.log('[uploadImageFromUrl] Blob received:', blob.type, blob.size)

    // Validate it's actually an image
    if (!blob.type.startsWith('image/')) {
      throw new Error(`Invalid content type: ${blob.type}. Expected image/*`)
    }

    // Validate size (server accepts at most 4 MB)
    if (blob.size > 4 * 1024 * 1024) {
      throw new Error('Image size exceeds 4MB limit')
    }

    const filename = imageUrl.split('/').pop()?.split('?')[0] || 'image.jpg'
    const file = new File([blob], filename, { type: blob.type })

    console.log('[uploadImageFromUrl] Uploading to storage...')
    const url = await uploadImage(file, draftId)
    console.log('[uploadImageFromUrl] Upload complete:', url)

    return {
      url,
      sourceUrl: imageUrl,
      uploadMethod: 'url'
    }
  } catch (error) {
    console.error('[uploadImageFromUrl] Error:', error)
    // Upload errors from the API already carry a status; let the caller map them.
    if (error.status) throw error
    // Provide more specific error messages
    if (error.message.includes('CORS')) {
      throw new Error('CORS error: Image host blocks cross-origin requests')
    }
    if (error.message.includes('Failed to fetch') || error.message.includes('NetworkError')) {
      throw new Error('Network error: Unable to reach image URL')
    }
    throw new Error(`Cannot fetch image: ${error.message}`)
  }
}

// Helper function to normalize images (backward compatibility)
export const normalizeImages = (images) => {
  if (!Array.isArray(images)) return []

  return images.map(img => {
    if (typeof img === 'string') {
      return {
        url: img,
        uploadMethod: 'file'
      }
    }
    return img
  })
}
