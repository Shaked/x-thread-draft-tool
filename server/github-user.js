import { query } from './db.js'
import { HttpError } from './http.js'

const UPSERT_USER = `
  insert into users (github_id, login, name, avatar_url)
  values ($1, $2, $3, $4)
  on conflict (github_id) do update set
    login = excluded.login,
    name = excluded.name,
    avatar_url = excluded.avatar_url,
    updated_at = now()
  returning *`

/** Reads the signed-in GitHub profile. The access token is used once and not stored. */
export async function fetchGithubUser(accessToken) {
  const response = await fetch('https://api.github.com/user', {
    headers: {
      authorization: `Bearer ${accessToken}`,
      'user-agent': 'x-thread-draft-tool',
      accept: 'application/vnd.github+json'
    }
  })
  const data = await response.json().catch(() => null)
  if (!response.ok || !data?.id || !data?.login) throw new HttpError(502, 'GitHub sign-in failed')
  return data
}

/** Creates or refreshes the user row for a GitHub account. Shared by web and device sign-in. */
export async function upsertGithubUser(github) {
  const { rows } = await query(UPSERT_USER, [
    github.id,
    github.login,
    github.name ?? null,
    github.avatar_url ?? null
  ])
  return rows[0]
}
