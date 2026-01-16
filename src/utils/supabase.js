import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Missing Supabase environment variables. Please set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY')
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey)

// Helper function to check if user owns a draft
export const isOwner = (draft, userId) => {
  return draft?.user_id === userId
}

// Helper function to upload image to storage
export const uploadImage = async (file, userId, draftId) => {
  const fileExt = file.name.split('.').pop()
  const fileName = `${Date.now()}-${Math.random().toString(36).substring(7)}.${fileExt}`
  const filePath = `${userId}/${draftId}/${fileName}`

  const { data, error } = await supabase.storage
    .from('draft-images')
    .upload(filePath, file, {
      cacheControl: '3600',
      upsert: false
    })

  if (error) {
    throw error
  }

  // Get public URL
  const { data: { publicUrl } } = supabase.storage
    .from('draft-images')
    .getPublicUrl(filePath)

  return publicUrl
}

// Helper function to delete image from storage
export const deleteImage = async (imageUrl) => {
  // Extract path from URL
  const url = new URL(imageUrl)
  const pathMatch = url.pathname.match(/\/storage\/v1\/object\/public\/draft-images\/(.+)/)

  if (!pathMatch) {
    throw new Error('Invalid image URL')
  }

  const filePath = pathMatch[1]

  const { error } = await supabase.storage
    .from('draft-images')
    .remove([filePath])

  if (error) {
    throw error
  }
}

// Helper function to delete all images for a draft
export const deleteAllDraftImages = async (posts) => {
  const imageUrls = posts
    .flatMap(post => post.images || [])
    .map(img => typeof img === 'string' ? img : img.url)
    .filter(Boolean)

  const deletePromises = imageUrls.map(url => deleteImage(url).catch(err => {
    console.error(`Failed to delete image ${url}:`, err)
  }))

  await Promise.all(deletePromises)
}

// Helper function to upload image from URL
export const uploadImageFromUrl = async (imageUrl, userId, draftId) => {
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

    // Validate size (5MB limit)
    if (blob.size > 5 * 1024 * 1024) {
      throw new Error('Image size exceeds 5MB limit')
    }

    const filename = imageUrl.split('/').pop()?.split('?')[0] || 'image.jpg'
    const file = new File([blob], filename, { type: blob.type })

    console.log('[uploadImageFromUrl] Uploading to storage...')
    const url = await uploadImage(file, userId, draftId)
    console.log('[uploadImageFromUrl] Upload complete:', url)

    return {
      url,
      sourceUrl: imageUrl,
      uploadMethod: 'url'
    }
  } catch (error) {
    console.error('[uploadImageFromUrl] Error:', error)
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
