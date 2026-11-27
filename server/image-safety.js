// Safe uploads (#416, plan 4.5 C6): the type comes from the first bytes, never from the header;
// SVG and everything else is refused; location and text metadata is removed in plain JS.
import { HttpError } from './http.js'

const TYPES_TEXT = 'Upload a PNG, JPEG, WebP or GIF image.'

/** 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif' from the first bytes, or null. */
function sniffImageType(b) {
  const at = (i, s) => s.every((v, k) => b[i + k] === v)
  if (b.length >= 8 && at(0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png'
  if (b.length >= 3 && at(0, [0xff, 0xd8, 0xff])) return 'image/jpeg'
  if (b.length >= 12 && at(0, [0x52, 0x49, 0x46, 0x46]) && at(8, [0x57, 0x45, 0x42, 0x50])) return 'image/webp'
  if (b.length >= 6 && at(0, [0x47, 0x49, 0x46, 0x38]) && (b[4] === 0x37 || b[4] === 0x39) && b[5] === 0x61) return 'image/gif'
  return null
}

const u32be = (b, i) => ((b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]) >>> 0
const u32le = (b, i) => (b[i] | (b[i + 1] << 8) | (b[i + 2] << 16) | (b[i + 3] << 24)) >>> 0
const ascii = (b, i, n) => String.fromCharCode(...b.subarray(i, i + n))
const concat = (parts) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let o = 0
  for (const p of parts) { out.set(p, o); o += p.length }
  return out
}

/** The Orientation (1 to 8) of an Exif APP1 payload (after "Exif\0\0"), or null. */
function exifOrientation(t) {
  if (t.length < 14) return null
  const le = t[0] === 0x49
  if (!le && t[0] !== 0x4d) return null
  const r16 = (i) => (le ? t[i] | (t[i + 1] << 8) : (t[i] << 8) | t[i + 1])
  const r32 = (i) => (le ? u32le(t, i) : u32be(t, i))
  const ifd = r32(4)
  if (ifd + 2 > t.length) return null
  const count = r16(ifd)
  for (let n = 0; n < count; n += 1) {
    const e = ifd + 2 + n * 12
    if (e + 12 > t.length) return null
    if (r16(e) === 0x0112) {
      const v = r16(e + 8)
      return v >= 1 && v <= 8 ? v : null
    }
  }
  return null
}

/** A minimal Exif APP1 segment that holds only the Orientation tag. */
function orientationSegment(value) {
  return Uint8Array.from([
    0xff, 0xe1, 0x00, 0x22, 0x45, 0x78, 0x69, 0x66, 0x00, 0x00,
    0x4d, 0x4d, 0x00, 0x2a, 0x00, 0x00, 0x00, 0x08,
    0x00, 0x01, 0x01, 0x12, 0x00, 0x03, 0x00, 0x00, 0x00, 0x01, 0x00, value, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00
  ])
}

const damaged = (kind) => new HttpError(400, `This ${kind} is damaged. ${TYPES_TEXT}`)

// JPEG: an allow-list. APP0 (JFIF), APP2 only for ICC profiles and APP14 (Adobe) are kept; every other APPn,
// comments and Exif/XMP are dropped, in every scan of a progressive file. The file ends at the first EOI.
const isStandalone = (m) => m === 0x01 || (m >= 0xd0 && m <= 0xd8)

function keepJpegSegment(b, i, marker) {
  if (marker === 0xe0 || marker === 0xee) return true
  if (marker === 0xe2) return ascii(b, i + 4, 11) === 'ICC_PROFILE'
  return !(marker >= 0xe1 && marker <= 0xef) && marker !== 0xfe // other APPn and comments are dropped
}

/** The index where the entropy-coded data after a scan header ends: the next marker that is not a stuffed 0xff00, a restart or fill. */
function scanEnd(b, from) {
  for (let j = from; j + 1 < b.length; j += 1) {
    const next = b[j + 1]
    if (b[j] === 0xff && next !== 0x00 && next !== 0xff && !(next >= 0xd0 && next <= 0xd7)) return j
  }
  throw damaged('JPEG')
}

function cleanJpeg(b) {
  const out = [b.subarray(0, 2)]
  let orientation = null
  let i = 2
  let afterApp0 = 1 // where a new Orientation block goes: after JFIF APP0
  for (;;) {
    if (i + 2 > b.length || b[i] !== 0xff) throw damaged('JPEG')
    const marker = b[i + 1]
    if (marker === 0xff) { i += 1; continue }
    if (marker === 0xd9) { out.push(b.subarray(i, i + 2)); break } // EOI: nothing after it is kept
    if (isStandalone(marker)) { out.push(b.subarray(i, i + 2)); i += 2; continue }
    const len = i + 4 <= b.length ? (b[i + 2] << 8) | b[i + 3] : 0
    if (len < 2 || i + 2 + len > b.length) throw damaged('JPEG')
    if (marker === 0xe1 && ascii(b, i + 4, 6) === 'Exif\0\0') {
      orientation ??= exifOrientation(b.subarray(i + 10, i + 2 + len))
    } else if (keepJpegSegment(b, i, marker)) {
      out.push(b.subarray(i, i + 2 + len))
      if (marker === 0xe0 && out.length === 2) afterApp0 = 2
    }
    i += 2 + len
    if (marker === 0xda) {
      const end = scanEnd(b, i)
      out.push(b.subarray(i, end))
      i = end
    }
  }
  if (orientation && orientation !== 1) out.splice(afterApp0, 0, orientationSegment(orientation))
  return concat(out)
}

// PNG: an allow-list of chunks, and the file ends at IEND. Exif, text, C2PA and unknown chunks are dropped.
const PNG_KEEP = new Set(['IHDR', 'PLTE', 'IDAT', 'IEND', 'tRNS', 'gAMA', 'cHRM', 'sRGB', 'iCCP', 'sBIT', 'pHYs', 'bKGD', 'hIST', 'sPLT', 'acTL', 'fcTL', 'fdAT'])
function cleanPng(b) {
  const out = [b.subarray(0, 8)]
  let i = 8
  while (i + 12 <= b.length) {
    const len = u32be(b, i)
    const end = i + 12 + len
    if (end > b.length) throw damaged('PNG')
    const type = ascii(b, i + 4, 4)
    if (PNG_KEEP.has(type)) out.push(b.subarray(i, end))
    i = end
    if (type === 'IEND') return concat(out)
  }
  throw damaged('PNG')
}

// WebP: an allow-list of chunks, inside the RIFF size. EXIF, XMP and unknown chunks are dropped.
const WEBP_KEEP = new Set(['VP8 ', 'VP8L', 'VP8X', 'ALPH', 'ANIM', 'ANMF', 'ICCP'])
function cleanWebp(b) {
  const riffEnd = Math.min(8 + u32le(b, 4), b.length)
  const out = [b.subarray(0, 12)]
  let i = 12
  while (i + 8 <= riffEnd) {
    const fourcc = ascii(b, i, 4)
    const size = u32le(b, i + 4)
    const end = i + 8 + size + (size & 1)
    if (i + 8 + size > riffEnd) throw damaged('WebP')
    if (WEBP_KEEP.has(fourcc)) {
      const chunk = b.slice(i, Math.min(end, riffEnd))
      if (fourcc === 'VP8X' && chunk.length >= 9) chunk[8] &= ~0x0c // no Exif and no XMP flag
      out.push(chunk)
    }
    i = end
  }
  const result = concat(out)
  const size = result.length - 8
  result[4] = size & 0xff; result[5] = (size >> 8) & 0xff; result[6] = (size >> 16) & 0xff; result[7] = (size >>> 24) & 0xff
  return result
}

// GIF: comment extensions and application extensions other than the animation loop are dropped; ends at the trailer.
function cleanGif(b) {
  const out = []
  const skipSubBlocks = (from) => {
    let j = from
    for (;;) {
      if (j >= b.length) throw damaged('GIF')
      if (b[j] === 0) return j + 1
      j += 1 + b[j]
    }
  }
  if (b.length < 13) throw damaged('GIF')
  let i = 13 + ((b[10] & 0x80) ? 3 * (1 << ((b[10] & 7) + 1)) : 0)
  if (i > b.length) throw damaged('GIF')
  out.push(b.subarray(0, i))
  for (;;) {
    if (i >= b.length) throw damaged('GIF')
    const tag = b[i]
    if (tag === 0x3b) { out.push(b.subarray(i, i + 1)); return concat(out) }
    if (tag === 0x21) {
      const end = skipSubBlocks(i + 2)
      const label = b[i + 1]
      const app = label === 0xff ? ascii(b, i + 3, 11) : ''
      if (label !== 0xfe && (label !== 0xff || app === 'NETSCAPE2.0' || app === 'ANIMEXTS1.0')) out.push(b.subarray(i, end))
      i = end
    } else if (tag === 0x2c) {
      if (i + 10 > b.length) throw damaged('GIF')
      const flags = b[i + 9]
      const start = i + 10 + ((flags & 0x80) ? 3 * (1 << ((flags & 7) + 1)) : 0) + 1
      const end = skipSubBlocks(start)
      out.push(b.subarray(i, end))
      i = end
    } else {
      throw damaged('GIF')
    }
  }
}

/**
 * Checks the bytes of an upload and returns `{ bytes, contentType }` with metadata removed. The header the
 * client sent is ignored. SVG, HTML and any other file is refused with the types that work.
 */
export function prepareImage(input) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input)
  const type = sniffImageType(bytes)
  if (!type) throw new HttpError(415, `This file is not a supported image (SVG and other types are not accepted). ${TYPES_TEXT}`)
  if (type === 'image/jpeg') return { bytes: cleanJpeg(bytes), contentType: type }
  if (type === 'image/png') return { bytes: cleanPng(bytes), contentType: type }
  if (type === 'image/webp') return { bytes: cleanWebp(bytes), contentType: type }
  return { bytes: cleanGif(bytes), contentType: type }
}
