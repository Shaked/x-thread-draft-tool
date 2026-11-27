// The editor's resize: at most 1600 px wide, re-drawn on a canvas (which also drops EXIF). Shared with the upload page (#418).
const MAX_IMAGE_WIDTH = 1600

export const compressImage = (file) => {
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
