// The running version (docs/plans/settings-menu.md M3, M4). The build writes server/generated/build-info.js
// (scripts/build-info.mjs). Without it (tests, dev:api before a build) the commit comes from the environment.
import { json } from './http.js'

const loadGenerated = () => import('./generated/build-info.js').then((mod) => mod.default).catch(() => null)

/** { commit, commit_short, deployed_at, environment, schema }. `load` is injectable for tests. */
export async function getVersion({ load = loadGenerated, env = process.env } = {}) {
  const info = await load()
  const commit = info?.commit || env.VERCEL_GIT_COMMIT_SHA || null
  return {
    commit,
    commit_short: commit ? commit.slice(0, 7) : null,
    deployed_at: info?.deployed_at ?? null,
    environment: env.VERCEL_ENV || 'local',
    schema: info?.schema ?? null
  }
}

async function versionHandler() {
  return json(await getVersion(), 200, { 'cache-control': 'public, max-age=60' })
}

export const versionRoutes = [{ method: 'GET', path: '/version', handler: versionHandler }]
