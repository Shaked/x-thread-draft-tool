// Server-side image fetch for POST /api/images/from-url (replaces the browser CORS path).
// SSRF guard: only http(s); every resolved address must be public; redirects are refused;
// 10 s timeout; image content type; at most 4 MB.
// Known limit: DNS rebinding between the resolution check and the fetch is not prevented.
import { lookup as dnsLookup } from 'node:dns/promises'
import { isIP } from 'node:net'
import { HttpError } from './http.js'

export const MAX_REMOTE_IMAGE_BYTES = 4 * 1024 * 1024
const TIMEOUT_MS = 10_000

let lookup = dnsLookup

/** Tests only: replace the DNS lookup so no network is needed. */
export function setResolverForTests(fn) {
  lookup = fn ?? dnsLookup
}

function ipv4ToInt(ip) {
  return ip.split('.').reduce((acc, part) => ((acc << 8) + Number(part)) >>> 0, 0)
}

const PRIVATE_V4 = [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16],
  ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15],
  ['224.0.0.0', 4], ['240.0.0.0', 4]
]

function isPrivateV4(ip) {
  const value = ipv4ToInt(ip)
  return PRIVATE_V4.some(([base, bits]) => {
    const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0
    return (value & mask) === (ipv4ToInt(base) & mask)
  })
}

function isPrivateV6(ip) {
  const lower = ip.toLowerCase()
  if (lower === '::' || lower === '::1') return true
  const mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)
  if (mapped) return isPrivateV4(mapped[1])
  const firstHextet = parseInt(lower.split(':')[0] || '0', 16)
  // fc00::/7 unique-local, fe80::/10 link-local, ff00::/8 multicast
  return (firstHextet & 0xfe00) === 0xfc00 || (firstHextet & 0xffc0) === 0xfe80 || (firstHextet & 0xff00) === 0xff00
}

/** True for loopback, private, link-local, CGNAT, multicast and other special-use addresses. */
export function isPrivateAddress(address) {
  const family = isIP(address)
  if (family === 4) return isPrivateV4(address)
  if (family === 6) return isPrivateV6(address)
  return true // not an IP at all: refuse
}

/** Fetches a public image and returns its bytes and content type, or throws an HttpError. */
export async function fetchRemoteImage(input) {
  let url
  try {
    url = new URL(input)
  } catch {
    throw new HttpError(400, 'Invalid URL')
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new HttpError(400, 'Only http and https URLs are allowed')
  }
  if (url.username || url.password) throw new HttpError(400, 'URLs with credentials are not allowed')

  const hostname = url.hostname.replace(/^\[(.*)\]$/, '$1')
  const addresses = isIP(hostname) ? [{ address: hostname }] : await lookup(hostname, { all: true })
  if (addresses.length === 0 || addresses.some((entry) => isPrivateAddress(entry.address))) {
    throw new HttpError(400, 'That address is not allowed')
  }

  let response
  try {
    response = await fetch(url, {
      redirect: 'manual',
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { accept: 'image/*' }
    })
  } catch {
    throw new HttpError(502, 'Could not fetch the image')
  }
  if (response.status >= 300 && response.status < 400) throw new HttpError(400, 'Redirects are not followed')
  if (!response.ok) throw new HttpError(502, `Image host returned HTTP ${response.status}`)

  const contentType = (response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase()
  if (!contentType.startsWith('image/')) throw new HttpError(415, 'The URL does not point to an image')

  const declared = Number(response.headers.get('content-length') || 0)
  if (declared > MAX_REMOTE_IMAGE_BYTES) throw new HttpError(413, 'Image must be 4 MB or smaller')

  const chunks = []
  let total = 0
  const reader = response.body.getReader()
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > MAX_REMOTE_IMAGE_BYTES) {
      await reader.cancel()
      throw new HttpError(413, 'Image must be 4 MB or smaller')
    }
    chunks.push(value)
  }
  if (total === 0) throw new HttpError(400, 'The image is empty')

  const bytes = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return { bytes, contentType }
}
