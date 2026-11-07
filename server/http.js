export class HttpError extends Error {
  constructor(status, message) {
    super(message)
    this.name = 'HttpError'
    this.status = status
  }
}

export function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json',
      'cache-control': 'no-store',
      ...headers
    }
  })
}

export function error(status, message) {
  return json({ error: message }, status)
}

export function parseCookies(request) {
  const header = request.headers.get('cookie') || ''
  const out = {}
  for (const part of header.split(';')) {
    const index = part.indexOf('=')
    if (index === -1) continue
    const name = part.slice(0, index).trim()
    if (!name) continue
    try {
      out[name] = decodeURIComponent(part.slice(index + 1).trim())
    } catch {
      out[name] = part.slice(index + 1).trim()
    }
  }
  return out
}

export function cookie(
  name,
  value,
  { maxAge, httpOnly = true, secure = true, sameSite = 'Lax', path = '/' } = {}
) {
  const parts = [`${name}=${encodeURIComponent(value)}`, `Path=${path}`]
  if (maxAge !== undefined) parts.push(`Max-Age=${maxAge}`)
  if (httpOnly) parts.push('HttpOnly')
  if (secure) parts.push('Secure')
  if (sameSite) parts.push(`SameSite=${sameSite}`)
  return parts.join('; ')
}

export async function readJson(request, maxBytes = 1_000_000) {
  const length = Number(request.headers.get('content-length') || 0)
  if (length > maxBytes) throw new HttpError(413, 'Request body too large')

  const text = await request.text()
  if (new TextEncoder().encode(text).byteLength > maxBytes) {
    throw new HttpError(413, 'Request body too large')
  }
  try {
    return JSON.parse(text)
  } catch {
    throw new HttpError(400, 'Invalid JSON body')
  }
}
