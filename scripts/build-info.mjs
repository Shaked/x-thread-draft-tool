// Writes server/generated/build-info.js: the one source of the app's version for the client build
// (vite.config.js), GET /api/version and the MCP tool app_version (docs/plans/settings-menu.md M1, M2).
// Public-safe on purpose: a commit, a time and a schema name. No branch name, no env values.
import { execFileSync } from 'node:child_process'
import { mkdirSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

/** Pure: the build info from the environment, the git head, the clock and the migration file names. */
export function buildInfo({ env = {}, now = new Date(), gitHead = null, migrations = [] } = {}) {
  const newest = migrations.filter((name) => name.endsWith('.sql')).sort().pop()
  return {
    commit: env.VERCEL_GIT_COMMIT_SHA || gitHead || null,
    deployed_at: now.toISOString(),
    schema: newest ? newest.replace(/\.sql$/, '') : null
  }
}

function gitHead() {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() || null
  } catch {
    return null // slop-ok: no git (an archive build) means no commit, never a failed build
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const info = buildInfo({ env: process.env, gitHead: gitHead(), migrations: readdirSync(join(root, 'db', 'migrations')) })
  mkdirSync(join(root, 'server', 'generated'), { recursive: true })
  writeFileSync(join(root, 'server', 'generated', 'build-info.js'), `export default ${JSON.stringify(info, null, 2)}\n`)
  console.log(`[build-info] commit ${info.commit ? info.commit.slice(0, 7) : 'none'}, schema ${info.schema}`)
}
