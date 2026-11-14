import { imagesApi } from './api.js'

// Upload an image file for a draft. Resolves to the public Blob URL.
export const uploadImage = (file, draftId) => imagesApi.upload(file, draftId)

// Upload an image from a URL. The API fetches it server-side (no browser CORS limits).
export const uploadImageFromUrl = async (imageUrl, draftId) => {
  const { url } = await imagesApi.fromUrl(draftId, imageUrl)
  return {
    url,
    sourceUrl: imageUrl,
    uploadMethod: 'url'
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
