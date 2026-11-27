// Project settings for the task-janitor plugin: the `task-janitor` section and the shared keys of
// `.claude/agent-kit.json` (`repo`, `owner`). A missing file or key means the default. Node 20, no dependencies.
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

export const CONFIG_FILE = '.claude/agent-kit.json'

/** Looks for the config from the project folder ($CLAUDE_PROJECT_DIR, else the working folder) up to the file system root. */
export function findConfig(start = process.env.CLAUDE_PROJECT_DIR || process.cwd()) {
  let dir = resolve(start)
  for (;;) {
    const file = join(dir, CONFIG_FILE)
    if (existsSync(file)) return { root: dir, file }
    const up = dirname(dir)
    if (up === dir) return { root: resolve(start), file: null }
    dir = up
  }
}

/** Reads the config. Returns { data, error }: error names the problem (a broken file, a key of the wrong type). */
export function readConfig(file) {
  if (!file) return { data: {}, error: null }
  let data
  try {
    data = JSON.parse(readFileSync(file, 'utf8'))
  } catch (err) {
    return { data: {}, error: `${file}: not valid JSON (${err.message})` }
  }
  const section = data['task-janitor']
  if (section !== undefined && (typeof section !== 'object' || section === null || Array.isArray(section))) {
    return { data, error: `${file}: "task-janitor" must be an object` }
  }
  for (const key of ['manualTestsIssue', 'reportIssue', 'dispatcherIssue']) {
    if (section && section[key] !== undefined && !Number.isInteger(section[key])) return { data, error: `${file}: "task-janitor.${key}" must be a whole number` }
  }
  if (section && section.replyLint !== undefined && typeof section.replyLint !== 'string') return { data, error: `${file}: "task-janitor.replyLint" must be a path` }
  return { data, error: null }
}

const found = findConfig()
const loaded = readConfig(found.file)
export const PROJECT_ROOT = found.root
export const CONFIG_ERROR = loaded.error
const data = loaded.data
const section = data['task-janitor'] && typeof data['task-janitor'] === 'object' ? data['task-janitor'] : {}

/** The repository, `owner/name`. Empty when the config has none: the fetch then needs a `repo` argument. */
export const REPO = typeof data.repo === 'string' ? data.repo : ''
/** The owner's display name, used in findings and patterns. The default is a neutral phrase. */
export const OWNER = typeof data.owner === 'string' && data.owner ? data.owner : 'the owner'
/** Issue numbers the janitor names in its output; null when the project does not set them. */
export const MANUAL_TESTS_ISSUE = Number.isInteger(section.manualTestsIssue) ? section.manualTestsIssue : null
export const REPORT_ISSUE = Number.isInteger(section.reportIssue) ? section.reportIssue : null
export const DISPATCHER_ISSUE = Number.isInteger(section.dispatcherIssue) ? section.dispatcherIssue : null
/** The reply-style lint module (a path from the project root), or null: the reply check is then not run. */
export const REPLY_LINT = typeof section.replyLint === 'string' && section.replyLint ? resolve(PROJECT_ROOT, section.replyLint) : null

export const escapeRegExp = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
