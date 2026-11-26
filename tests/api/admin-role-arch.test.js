// @vitest-environment node
// Admin role (Task 3, #277): server/admin/role.js is the only module that decides a role. These tests read
// the source files as text (no database). They scan server/ and src/ only. scripts/dev-api.mjs also names the
// admin id (a local dev server that exits on Vercel), and it is outside this scan on purpose.
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it, vi } from 'vitest'

vi.mock('../../server/blob.js', () => ({ putBlob: vi.fn(), deleteBlobUrls: vi.fn(async () => {}) }))

import { ROUTES } from '../../server/router.js'
import { isGuardedAdminHandler } from '../../server/admin/guard.js'

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..')
const IDENTITY = 'server/admin/identity.js'
const ROLE = 'server/admin/role.js'
// Generated from docs/changelogs by scripts/build-info.mjs: data, not code. An old changelog summary names the id.
const GENERATED_CHANGELOG = 'server/generated/changelog.js'
const SOURCE_EXTENSION = /\.(js|jsx|mjs|cjs|ts|tsx)$/

// Who may import role.js. server/routes/auth.js (Task 8, #282) and server/session.js (#283: realSession decides the web admin
// before any database query) are on the list on purpose, each added in its own PR.
const ROLE_IMPORTERS = (file) =>
  file === 'server/mcp/tools.js' ||
  file === 'server/routes/oauth.js' ||
  file === 'server/routes/auth.js' ||
  file === 'server/session.js' ||
  file.startsWith('server/admin/')

/** The admin identity names: the id itself, the list and the check. Any other module that uses one decides admin by itself. */
const IDENTITY_NAMES = /\bisAdminGithubId\b|\bADMIN_GITHUB_IDS\b|\b960015\b/g

/** The identity names a source text uses, in order. */
function identityUses(source) {
  return [...source.matchAll(IDENTITY_NAMES)].map((match) => match[0])
}

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    return statSync(path).isDirectory() ? walk(path) : [path]
  })
}

/** Every source file under server/ and src/, as repo-relative paths with forward slashes. */
function sourceFiles() {
  return ['server', 'src']
    .flatMap((dir) => walk(join(ROOT, dir)))
    .filter((path) => SOURCE_EXTENSION.test(path))
    .map((path) => relative(ROOT, path).split('\\').join('/'))
}

const read = (file) => readFileSync(join(ROOT, file), 'utf8')

/** The module specifiers a source text imports (static `from '...'` and dynamic `import('...')`). */
function importSpecifiers(source) {
  return [...source.matchAll(/(?:from\s+|import\(\s*)['"]([^'"]+)['"]/g)].map((match) => match[1])
}

/** The repo-relative file a relative import points to. Bare package names are returned unchanged. */
function resolved(file, specifier) {
  if (!specifier.startsWith('.')) return specifier
  return relative(ROOT, resolve(ROOT, dirname(file), specifier)).split('\\').join('/')
}

describe('the admin identity is read in one place', () => {
  it('no file under server/ or src/ except identity.js contains the admin id 960015', () => {
    const offenders = sourceFiles().filter((file) => file !== IDENTITY && file !== GENERATED_CHANGELOG && /\b960015\b/.test(read(file)))
    expect(offenders).toEqual([])
  })

  it('isAdminGithubId and ADMIN_GITHUB_IDS are used only by identity.js and role.js', () => {
    const offenders = sourceFiles().filter((file) => file !== IDENTITY && file !== ROLE && /\bisAdminGithubId\b|\bADMIN_GITHUB_IDS\b/.test(read(file)))
    expect(offenders).toEqual([])
    expect(read(ROLE)).toMatch(/import \{ isAdminGithubId \} from '\.\/identity\.js'/)
  })

  it('every /admin route in the router is made with the guard', () => {
    const admin = ROUTES.filter((route) => route.path === '/admin' || route.path.startsWith('/admin/'))
    expect(admin.length).toBeGreaterThan(0)
    expect(admin.filter((route) => !isGuardedAdminHandler(route.handler))).toEqual([])
  })

  it('the MCP tool list takes its admin decision only from role.js', () => {
    const tools = read('server/mcp/tools.js')
    expect(tools).toMatch(/import \{ mcpAdminReason \} from '\.\.\/admin\/role\.js'/)
    expect(tools).toMatch(/return mcpAdminReason\(caller, origin\)/)
    expect(tools).not.toMatch(/admin\/identity/)
  })

  it('only the allow-listed modules import role.js', () => {
    const importers = sourceFiles().filter((file) => file !== ROLE && importSpecifiers(read(file)).some((spec) => resolved(file, spec) === ROLE))
    expect(importers).toEqual(expect.arrayContaining(['server/mcp/tools.js', 'server/routes/oauth.js', 'server/admin/guard.js']))
    expect(importers.filter((file) => !ROLE_IMPORTERS(file))).toEqual([])
  })

  it('the scanner flags a fake source that decides admin by its id', () => {
    expect(identityUses("if (isAdminGithubId(caller.gh)) return 'admin'")).toEqual(['isAdminGithubId'])
    expect(identityUses("const id = '960015'")).toEqual(['960015'])
    expect(identityUses("const role = roleOf(caller.gh)")).toEqual([])
  })
})
