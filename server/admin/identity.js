// The only administrators, by numeric GitHub id. Never by login: a login can be renamed or reused.
// 960015 is github.com/Shaked. tests/api/admin-identity.test.js pins this list.
const ADMIN_GITHUB_IDS = Object.freeze(['960015'])
const CI_GITHUB_ID = '-1'

// How long admin tools stay on after the owner approves a connection on a fresh sign-in.
export const ADMIN_ELEVATION_HOURS = 24

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
