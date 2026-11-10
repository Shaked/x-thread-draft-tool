/**
 * Client for the same-origin `/api` function. Every call sends the session cookie.
 * Errors carry the server's message and the HTTP status (`err.status`).
 */

async function request(path, { method = 'GET', body, headers = {} } = {}) {
  const isRaw = body instanceof Blob
  const init = {
    method,
    credentials: 'same-origin',
    headers: { ...headers }
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
    throw error
  }

  return data
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

  async update(id, patch) {
    const data = await request(`/drafts/${encodeURIComponent(id)}`, { method: 'PATCH', body: patch })
    return data.draft
  },

  async publish(id) {
    const data = await request(`/drafts/${encodeURIComponent(id)}/publish`, { method: 'POST' })
    return data.draft
  },

  remove(id) {
    return request(`/drafts/${encodeURIComponent(id)}`, { method: 'DELETE' })
  },

  async createShareToken(id) {
    const data = await request(`/drafts/${encodeURIComponent(id)}/share-tokens`, { method: 'POST' })
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
