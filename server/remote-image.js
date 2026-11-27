// Server-side image fetch for POST /api/images/from-url (replaces the browser CORS path).
// SSRF guard: only http(s); every resolved address must be public; up to 3 redirects, each hop
// re-checked (URL rules, DNS, pinned connection) under one shared 10 s limit; at most 4 MB. The connection uses the checked address
// (pinnedFetch), so a DNS rebind after the check cannot reach a private address.
import { lookup as dnsLookup } from 'node:dns/promises'
import { isIP } from 'node:net'
import { HttpError } from './http.js'

const MAX_REMOTE_IMAGE_BYTES = 4 * 1024 * 1024
const TIMEOUT_MS = 10_000
const MAX_REDIRECTS = 3
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308])

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

function parseV6(ip) {
  let text = ip.toLowerCase().split('%')[0]
  const dotted = text.match(/(\d+\.\d+\.\d+\.\d+)$/)
  if (dotted) {
    const v = ipv4ToInt(dotted[1])
    text = text.slice(0, -dotted[1].length) + `${(v >>> 16).toString(16)}:${(v & 0xffff).toString(16)}`
  }
  const [head, tail] = text.split('::')
  const left = head ? head.split(':') : []
  const right = tail ? tail.split(':') : []
  const zeros = text.includes('::') ? new Array(8 - left.length - right.length).fill('0') : []
  return [...left, ...zeros, ...right].map((h) => parseInt(h, 16))
}

const v4FromHextets = (hi, lo) => `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`

function isPrivateV6(ip) {
  const h = parseV6(ip)
  if (h.length !== 8 || h.some(Number.isNaN)) return true
  const zeroTo = (n) => h.slice(0, n).every((x) => x === 0)
  // IPv4 inside IPv6: mapped ::ffff:a.b.c.d, compatible ::a.b.c.d (also :: and ::1), NAT64 64:ff9b::/96, 6to4 2002::/16
  if (zeroTo(5) && h[5] === 0xffff) return isPrivateV4(v4FromHextets(h[6], h[7]))
  if (zeroTo(4) && h[4] === 0xffff && h[5] === 0) return isPrivateV4(v4FromHextets(h[6], h[7])) // SIIT ::ffff:0:a.b.c.d
  if (zeroTo(6)) return isPrivateV4(v4FromHextets(h[6], h[7]))
  if (h[0] === 0x64 && h[1] === 0xff9b && h.slice(2, 6).every((x) => x === 0)) return isPrivateV4(v4FromHextets(h[6], h[7]))
  if (h[0] === 0x64 && h[1] === 0xff9b) return true // local-use NAT64 64:ff9b:1::/48
  if (h[0] === 0x2002) return isPrivateV4(v4FromHextets(h[1], h[2]))
  if (h[0] === 0x2001 && h[1] === 0) return true // Teredo
  // fc00::/7 unique-local, fe80::/10 link-local, ff00::/8 multicast
  return (h[0] & 0xfe00) === 0xfc00 || (h[0] & 0xffc0) === 0xfe80 || (h[0] & 0xff00) === 0xff00
}

/** True for loopback, private, link-local, CGNAT, multicast and other special-use addresses. */
export function isPrivateAddress(address) {
  const family = isIP(address)
  if (family === 4) return isPrivateV4(address)
  if (family === 6) return isPrivateV6(address)
  return true // not an IP at all: refuse
}

/** Parses and checks one URL (every redirect hop too): http(s) only, no credentials. */
function parseRemoteUrl(input) {
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
  return url
}

class AddressRefusedError extends Error {}

/** Rejects when the signal aborts, so a slow DNS answer counts against the time limit. */
function raceAbort(promise, signal) {
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(signal.reason)
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort))
    if (signal.aborted) return onAbort()
    signal.addEventListener('abort', onAbort, { once: true })
  })
}
/**
 * Resolves the host once, refuses if any address is private, and connects only to the first checked
 * address. TLS (SNI and the certificate) still uses url.hostname. Redirects are returned, not followed.
 * `resolve` is the caller's own DNS lookup (each caller keeps its test hook).
 */
export async function pinnedFetch(url, { resolve, timeoutMs, headers, signal = AbortSignal.timeout(timeoutMs) }) {
  const host = url.hostname.replace(/^\[(.*)\]$/, '$1')
  const addresses = isIP(host) ? [{ address: host }] : await raceAbort(resolve(host, { all: true }), signal)
  if (addresses.length === 0 || addresses.some((entry) => isPrivateAddress(entry.address))) {
    throw new AddressRefusedError('That address is not allowed')
  }
  const address = addresses[0].address
  const family = isIP(address)
  const { Agent } = await import('undici')
  const dispatcher = new Agent({
    connect: {
      lookup: (_name, options, callback) =>
        options && options.all ? callback(null, [{ address, family }]) : callback(null, address, family)
    }
  })
  try {
    return await fetch(url, { redirect: 'manual', signal, headers, dispatcher })
  } finally {
    dispatcher.close().catch(() => {})
  }
}

async function readImageBody(response) {
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
  return bytes
}

export async function fetchRemoteImage(input) {
  let url = parseRemoteUrl(input)
  const signal = AbortSignal.timeout(TIMEOUT_MS) // one limit for DNS, every hop and the body read

  let response
  for (let hop = 0; ; hop++) {
    try {
      response = await pinnedFetch(url, { resolve: lookup, signal, headers: { accept: 'image/*' } })
    } catch (err) {
      if (err instanceof AddressRefusedError) throw new HttpError(400, err.message)
      throw new HttpError(502, 'Could not fetch the image')
    }
    if (!REDIRECT_STATUSES.has(response.status)) break
    const location = response.headers.get('location')
    response.body?.cancel().catch(() => {})
    if (!location) throw new HttpError(502, 'The image link redirects without a target. Ask the user for the direct image link or to add it in the editor.')
    if (hop >= MAX_REDIRECTS) {
      throw new HttpError(400, 'The image link redirects too many times. Ask the user for the direct image link or to add it in the editor.')
    }
    let next
    try {
      next = new URL(location, url).href
    } catch {
      throw new HttpError(400, 'Invalid URL')
    }
    url = parseRemoteUrl(next)
  }
  if (!response.ok) {
    response.body?.cancel().catch(() => {})
    throw new HttpError(502, `Image host returned HTTP ${response.status}`)
  }

  const declared = Number(response.headers.get('content-length') || 0)
  if (declared > MAX_REMOTE_IMAGE_BYTES) {
    response.body?.cancel().catch(() => {})
    throw new HttpError(413, 'Image must be 4 MB or smaller')
  }

  let bytes
  try {
    bytes = await readImageBody(response)
  } catch (err) {
    if (err instanceof HttpError) throw err
    throw new HttpError(502, 'Could not fetch the image')
  }
  return { bytes } // the type is decided from the bytes by prepareImage
}
