// The only administrators, by numeric GitHub id. Never by login: a login can be renamed or reused.
// 960015 is github.com/Shaked. tests/api/admin-identity.test.js pins this list.
const ADMIN_GITHUB_IDS = Object.freeze(['960015'])
const CI_GITHUB_ID = '-1'

// The only apps that can hold admin tools, by their exact OAuth return address.
// tests/api/admin-identity.test.js pins this list. A loopback address never qualifies.
const ADMIN_REDIRECT_URIS = Object.freeze([
  'https://claude.ai/api/mcp/auth_callback',
  'https://chatgpt.com/connector_platform_oauth_redirect'
])

/** True for an admin id, unless ADMIN_DISABLED=1. The variable can only turn admin off. */
export function isAdminGithubId(githubId, env = process.env) {
  return env.ADMIN_DISABLED !== '1' && ADMIN_GITHUB_IDS.includes(String(githubId))
}

/** Accounts that can never be suspended or deleted: the admins and the CI identity. Not affected by ADMIN_DISABLED. */
export function isProtectedGithubId(githubId) {
  const id = String(githubId)
  return ADMIN_GITHUB_IDS.includes(id) || id === CI_GITHUB_ID
}

/** For SQL: `github_id <> all($n::bigint[])`. */
export function protectedGithubIds() {
  return [...ADMIN_GITHUB_IDS, CI_GITHUB_ID]
}

/** Exact match only: no prefix, no port, no loopback rule. */
export const isAdminRedirectUri = (uri) => typeof uri === 'string' && ADMIN_REDIRECT_URIS.includes(uri)
