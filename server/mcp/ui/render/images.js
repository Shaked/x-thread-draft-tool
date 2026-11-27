// One renderer per capability (#292): a post's images. Same rules as client.js: the function is copied into each view
// with toString(), so it has no imports and no module-level constants: it uses its arguments and the other view
// functions as page globals (tests/unit/setup.js installs them for the unit tests).
/* global document, el, linkButton, safeImage, safeUrl, tr */

/** The images of a post as a grid of pictures (https images on the one image origin) and links; null when there is none to show. */
export function imagesNode(images, imageOrigin, open) {
  const items = []
  images.forEach((img, n) => {
    const url = typeof img === 'string' ? img : img && img.url
    const safe = safeImage(url, imageOrigin)
    if (safe) {
      const pic = document.createElement('img')
      pic.setAttribute('src', safe)
      pic.setAttribute('alt', tr('thread', 'image_alt', { n: n + 1, total: images.length }))
      pic.loading = 'lazy'
      items.push(el('li', {}, [pic]))
    } else {
      const href = safeUrl(url, null)
      if (href) items.push(el('li', {}, [linkButton(href, href, open)]))
    }
  })
  return items.length > 0 ? el('ol', {}, items) : null
}
