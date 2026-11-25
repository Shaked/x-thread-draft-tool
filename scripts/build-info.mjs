// Writes server/generated/build-info.js: the one source of the app's version for the client build
// (vite.config.js), GET /api/version and the MCP tool app_version (docs/plans/settings-menu.md M1, M2).
// Public-safe on purpose: a commit, a time and a schema name. No branch name, no env values.
// Also writes server/generated/changelog.js from docs/changelogs (M13): the API serves it, not the client.
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
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

const SUMMARY_MAX = 280
const LABEL = /^(?:[A-Z]+\d+[A-Z\d-]*|[A-Z][A-Z\d]*(?:-[A-Z\d]+)+):\s+/ // "T6: ", "D-14: ", "P-CODEX: "

/** Plain text: markdown links become their text, backticks go, spaces collapse, Unicode NFC. */
function plain(text) {
  return text.replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/`/g, '').normalize('NFC').replace(/\s+/g, ' ').trim()
}

/** At most 280 characters, cut at a word boundary, with an ellipsis when cut. */
function cut(text) {
  const chars = [...text]
  if (chars.length <= SUMMARY_MAX) return text
  const head = chars.slice(0, SUMMARY_MAX - 1).join('')
  const space = head.lastIndexOf(' ')
  return `${(space > 0 ? head.slice(0, space) : head).trimEnd()}…`
}

/** The first one to three text or bullet lines (headings, blank lines and code fences skipped). */
function summaryOf(body) {
  const lines = []
  let fence = false
  for (const raw of body.split('\n')) {
    const line = raw.trim()
    if (line.startsWith('```')) {
      fence = !fence
      continue
    }
    if (fence || line === '' || line.startsWith('#') || /^(Area|Link):/.test(line)) continue
    lines.push(line.replace(/^[-*+]\s+/, ''))
    if (lines.length === 3) break
  }
  return cut(plain(lines.join(' ')).replace(LABEL, ''))
}

/**
 * Pure: the changelog entries from `{ name, text }` files, newest first (docs/plans/settings-menu.md M13).
 * `id` is the file name without `.md`, `date` the UTC time in the name (null if the name has none),
 * `title` the first `# ` heading (null if none), `summary` the short text. README.md is skipped.
 * `area` and `link` come from the `Area:` and `Link:` lines (null if missing). `details` is the text under
 * `## Technical details` (empty if none). The summary reads only the part above that heading.
 */
export function changelogEntries(files) {
  const entries = files
    .filter(({ name }) => name.endsWith('.md') && name !== 'README.md')
    .map(({ name, text }) => {
      const stamp = name.match(/^(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})-/)
      const heading = text.match(/^#\s+(.+)$/m)
      const title = heading ? plain(heading[1]) : ''
      const at = text.search(/^## Technical details\s*$/m)
      const top = at === -1 ? text : text.slice(0, at)
      const details = at === -1 ? '' : text.slice(at).replace(/^## Technical details\s*\n?/, '').trim()
      const area = top.match(/^Area:\s*(.+?)\s*$/m)?.[1] ?? null
      const link = top.match(/^Link:\s*(https:\/\/\S+)\s*$/m)?.[1] ?? null
      return {
        id: name.replace(/\.md$/, ''),
        date: stamp ? `${stamp[1]}-${stamp[2]}-${stamp[3]}T${stamp[4]}:${stamp[5]}:${stamp[6]}Z` : null,
        title: title || null,
        summary: summaryOf(top),
        area,
        link,
        details
      }
    })
  return entries.sort((a, b) => (a.id < b.id ? 1 : a.id > b.id ? -1 : 0))
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
  const dir = join(root, 'docs', 'changelogs')
  const files = readdirSync(dir).map((name) => ({ name, text: readFileSync(join(dir, name), 'utf8') }))
  const entries = changelogEntries(files)
  writeFileSync(join(root, 'server', 'generated', 'changelog.js'), `export default ${JSON.stringify(entries, null, 2)}\n`)
  console.log(`[build-info] commit ${info.commit ? info.commit.slice(0, 7) : 'none'}, schema ${info.schema}, ${entries.length} changelog entries`)
}
