/**
 * API client for backend communication
 */

// In production, if worker is on a different domain, set VITE_API_BASE env var
// Otherwise, use relative paths (same origin)
const API_BASE = import.meta.env.DEV
  ? 'http://localhost:8787'
  : (import.meta.env.VITE_API_BASE || '');

/**
 * Make API request with error handling
 */
async function apiRequest(endpoint, options = {}) {
  const url = `${API_BASE}${endpoint}`;

  const response = await fetch(url, {
    ...options,
    credentials: 'include', // Include cookies for session
    headers: {
      'Content-Type': 'application/json',
      ...options.headers
    }
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Request failed' }));
    throw new Error(error.error || `HTTP ${response.status}`);
  }

  return response.json();
}

/**
 * Auth API
 */
export const authAPI = {
  async getCurrentUser() {
    return apiRequest('/api/auth/me');
  },

  async login() {
    window.location.href = `${API_BASE}/api/auth/login`;
  },

  async logout() {
    await apiRequest('/api/auth/logout', { method: 'POST' });
    window.location.reload();
  }
};

/**
 * Drafts API
 */
export const draftsAPI = {
  async listDrafts() {
    const response = await apiRequest('/api/drafts');
    return response.drafts || [];
  },

  async getDraftByTitle(title) {
    const encodedTitle = encodeURIComponent(title);
    const response = await apiRequest(`/api/drafts/${encodedTitle}`);
    return response.draft;
  },

  async saveDraft(title, content) {
    const response = await apiRequest('/api/drafts', {
      method: 'POST',
      body: JSON.stringify({ title, content })
    });
    return response.draft;
  },

  async deleteDraft(title) {
    const encodedTitle = encodeURIComponent(title);
    await apiRequest(`/api/drafts/${encodedTitle}`, {
      method: 'DELETE'
    });
  }
};
