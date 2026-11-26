/**
 * Client for the same-origin `/api` function. Every call sends the session cookie.
 * Errors carry the server's message and the HTTP status (`err.status`).
 */

async function request(path, { method = 'GET', body, headers = {}, keepalive = false } = {}) {
  const isRaw = body instanceof Blob
  const init = {
    method,
    credentials: 'same-origin',
    headers: { ...headers },
    keepalive
  }

  if (isRaw) {
    init.headers['content-type'] = body.type || 'application/octet-stream'
    init.body = body
  } else if (body !== undefined) {
    init.headers['content-type'] = 'application/json'
    init.body = JSON.stringify(body)
  }

  const response = await fetch(`/api${path}`, init)
  const data = await response.json().catch(() => ({}))

  if (!response.ok) {
    const error = new Error(data.error || `HTTP ${response.status}`)
    error.status = response.status
    // A 412 carries the current `version` and `draft` (nothing was written), so the editor can show them.
    error.version = data.version
    error.draft = data.draft
    throw error
  }

  return data
}

// The admin routes (#283) answer only the admin's browser session that sends this header; the server decides.
const PAGE_SIZE = 50

export const adminApi = {
  stats() {
    return request('/admin/stats', { headers: { 'x-xt-admin': '1' } }).then((data) => data.stats)
  },

  audit(before) {
    const query = before ? `&before=${encodeURIComponent(before)}` : ''
    return request(`/admin/audit?limit=${PAGE_SIZE}${query}`, { headers: { 'x-xt-admin': '1' } }).then((data) => data.events)
  }
}

export const authApi = {
  me() {
    return request('/auth/me')
  },

  login() {
    window.location.href = '/api/auth/login'
  },

  logout() {
    return request('/auth/logout', { method: 'POST' })
  }
}

export const draftsApi = {
  async list(published) {
    const data = await request(`/drafts?published=${published ? 'true' : 'false'}`)
    return data.drafts
  },

  async create({ title, posts }) {
    const data = await request('/drafts', { method: 'POST', body: { title, posts } })
    return data.draft
  },

  async get(id) {
    const data = await request(`/drafts/${encodeURIComponent(id)}`)
    return data.draft
  },

  /**
   * The open editor's cheap "did it change?" check (#360). `version` is the one the editor holds: the server
   * answers 304 with no body when it is current, so `{ changed: false }`. Otherwise `{ changed: true, draft }`.
   */
  async check(id, version) {
    const response = await fetch(`/api/drafts/${encodeURIComponent(id)}`, {
      credentials: 'same-origin',
      headers: { 'if-none-match': `"${version}"` }
    })
    if (response.status === 304) return { changed: false }
    const data = await response.json().catch(() => ({}))
    if (!response.ok) {
      const error = new Error(data.error || `HTTP ${response.status}`)
      error.status = response.status
      throw error
    }
    return { changed: true, draft: data.draft }
  },

  /**
   * `version` is the draft version the editor last read or saved. The server refuses a write made on an
   * older version with 412 and writes nothing (`If-Match`). `keepalive` lets a save during page unload finish.
   */
  async update(id, patch, version, { keepalive = false } = {}) {
    const headers = version === undefined ? {} : { 'if-match': `"${version}"` }
    const data = await request(`/drafts/${encodeURIComponent(id)}`, { method: 'PATCH', body: patch, headers, keepalive })
    return data.draft
  },

  async publish(id) {
    const data = await request(`/drafts/${encodeURIComponent(id)}/publish`, { method: 'POST' })
    return data.draft
  },

  remove(id) {
    return request(`/drafts/${encodeURIComponent(id)}`, { method: 'DELETE' })
  },

  /** Returns the token. No options: a one-time link that expires in an hour (the server default). */
  async createShareToken(id, options) {
    const data = await request(`/drafts/${encodeURIComponent(id)}/share-tokens`, { method: 'POST', body: options })
    return data.token
  }
}

export const imagesApi = {
  async upload(file, draftId) {
    const data = await request(`/images?draftId=${encodeURIComponent(draftId)}`, {
      method: 'POST',
      body: file
    })
    return data.url
  },

  remove(url) {
    return request('/images', { method: 'DELETE', body: { url } })
  },

  /** The server fetches the image, so the browser's CORS limits do not apply. */
  fromUrl(draftId, url) {
    return request('/images/from-url', { method: 'POST', body: { draftId, url } })
  }
}

export const tokensApi = {
  list() {
    return request('/tokens')
  },

  /** Returns `{ token, id, name, prefix, expires_at }`. The token is shown once. */
  create({ name, expires_in_days }) {
    return request('/tokens', { method: 'POST', body: { name, expires_in_days } })
  },

  revoke(id) {
    return request(`/tokens/${encodeURIComponent(id)}`, { method: 'DELETE' })
  }
}

/** Connected apps: the signed-in user's OAuth grants (plan Task 7.8). */
export const grantsApi = {
  /** Returns `{ grants: [{ id, client_name, kind, redirect_host, resource, scope, created_at, last_used_at, revoked_at }] }`. */
  list() {
    return request('/grants')
  },

  revoke(id) {
    return request(`/grants/${encodeURIComponent(id)}`, { method: 'DELETE' })
  }
}

/** The changelog (settings-menu.md M14): `{ entries, next }`, newest first. Pass `next` as `before` for older entries. */
export const changelogApi = {
  list({ before } = {}) {
    const query = before ? `?limit=20&before=${encodeURIComponent(before)}` : '?limit=20'
    return request(`/changelog${query}`)
  }
}
