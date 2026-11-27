// Tiny valid-looking image files for upload tests (type is decided from the bytes).
const be32 = (n) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]
const le32 = (n) => [n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255]
const text = (s) => [...s].map((c) => c.charCodeAt(0))

export const pngChunk = (type, data) => [...be32(data.length), ...text(type), ...data, 0, 0, 0, 0] // CRC not checked

export const makePng = (extraChunks = []) =>
  Uint8Array.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    ...pngChunk('IHDR', [0, 0, 0, 1, 0, 0, 0, 1, 8, 2, 0, 0, 0]),
    ...extraChunks.flat(),
    ...pngChunk('IDAT', [1, 2, 3, 4]),
    ...pngChunk('IEND', [])
  ])

/** An Exif block with Orientation and a GPS pointer (big endian). */
export const exifPayload = (orientation = 6) => [
  ...text('Exif'), 0, 0,
  0x4d, 0x4d, 0, 0x2a, 0, 0, 0, 8,
  0, 2,
  0x01, 0x12, 0, 3, 0, 0, 0, 1, 0, orientation, 0, 0,
  0x88, 0x25, 0, 4, 0, 0, 0, 1, 0, 0, 0, 0x26,
  0, 0, 0, 0
]

export const jpegSegment = (marker, data) => [0xff, marker, (data.length + 2) >> 8, (data.length + 2) & 255, ...data]

export const makeJpeg = ({ exif = null, xmp = false, comment = false, app12 = false } = {}) =>
  Uint8Array.from([
    0xff, 0xd8,
    ...jpegSegment(0xe0, [...text('JFIF'), 0, 1, 1, 0, 0, 1, 0, 1, 0, 0]),
    ...(exif ? jpegSegment(0xe1, exif) : []),
    ...(xmp ? jpegSegment(0xe1, [...text('http://ns.adobe.com/xap/1.0/'), 0, ...text('<x/>')]) : []),
    ...(comment ? jpegSegment(0xfe, text('secret')) : []),
    ...(app12 ? jpegSegment(0xec, text('Ducky GPSDATA')) : []),
    ...jpegSegment(0xdb, new Array(65).fill(1)),
    ...jpegSegment(0xda, [1, 1, 0, 0, 63, 0]),
    7, 7, 7, 0xff, 0xd9
  ])

export const makeWebp = ({ exif = false, xmp = false } = {}) => {
  const chunk = (id, data) => [...text(id), ...le32(data.length), ...data, ...(data.length & 1 ? [0] : [])]
  const body = [
    ...text('WEBP'),
    ...chunk('VP8X', [(exif ? 0x08 : 0) | (xmp ? 0x04 : 0), 0, 0, 0, 0, 0, 0, 0, 0, 0]),
    ...chunk('VP8L', [0x2f, 0, 0, 0, 0, 1, 2, 3]),
    ...(exif ? chunk('EXIF', text('GPSDATA')) : []),
    ...(xmp ? chunk('XMP ', text('<x/>')) : [])
  ]
  return Uint8Array.from([...text('RIFF'), ...le32(body.length), ...body])
}

export const makeGif = () => Uint8Array.from([...text('GIF89a'), 1, 0, 1, 0, 0, 0, 0, 0x3b])
export const SVG = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>')
export const HTML = new TextEncoder().encode('<html><body>hi</body></html>')
export const contains = (bytes, s) => Buffer.from(bytes).includes(Buffer.from(s))
