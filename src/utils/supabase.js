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
    .filter(Boolean)

  const deletePromises = imageUrls.map(url => deleteImage(url).catch(err => {
    console.error(`Failed to delete image ${url}:`, err)
  }))

  await Promise.all(deletePromises)
}
