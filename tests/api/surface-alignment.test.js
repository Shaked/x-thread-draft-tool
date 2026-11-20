// @vitest-environment node
// docs/architecture/capabilities.md names, for every capability, its REST routes (API), MCP tools
// and prompts (MCP) and React pages (UI). This test fails when a route, tool, prompt or page is
// missing from that table, or when a cell names something that does not exist. No DB, no network.
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { ROUTES } from '../../server/router.js'
import { listTools } from '../../server/mcp/tools.js'
import { ADMIN_TOOLS } from '../../server/mcp/admin-tools.js'
import { listPrompts } from '../../server/mcp/prompts.js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const TABLE = readFileSync(join(ROOT, 'docs/architecture/capabilities.md'), 'utf8')
const SRC = join(ROOT, 'src')

/** Rows of each table, keyed by its `## heading`. The header and separator lines are skipped. */
export function parseTables(markdown) {
  const tables = {}
  let heading = null
  for (const line of markdown.split('\n')) {
    const h = line.match(/^##\s+(.+?)\s*$/)
    if (h) {
      heading = h[1]
      continue
    }
    if (!line.startsWith('|')) continue
    const cells = line
      .replace(/^\|/, '')
      .replace(/\|\s*$/, '')
      .split('|')
      .map((c) => c.replace(/`/g, '').trim())
    if (cells.every((c) => /^-+$/.test(c))) continue
    if (cells[0] === 'Capability' || cells[0] === 'Route') continue
    ;(tables[heading] ??= []).push(cells)
  }
  return tables
}

/** A cell as a list of names: backticks removed, comma separated. A `no:` cell names nothing. */
export function items(cell) {
  if (cell.startsWith('no:')) return []
  return cell
    .split(',')
    .map((s) => s.replace(/`/g, '').trim())
    .filter(Boolean)
}

/** True when a route matches a key: "GET /x", "/x" or a "/x/*" prefix. Same rule as mcp-coverage. */
function matchesKey(route, key) {
  const [method, pattern] = key.includes(' ') ? key.split(' ') : [null, key]
  if (method !== null && method !== route.method) return false
  if (pattern.endsWith('/*')) {
    const prefix = pattern.slice(0, -1)
    return route.path.startsWith(prefix) || route.path === prefix.slice(0, -1)
  }
  return route.path === pattern
}

/** True when a UI path is covered by a UI item: the same path, or a "/x/*" prefix. */
const coversPage = (item, page) => (item.endsWith('/*') ? page.startsWith(item.slice(0, -1)) : page === item)

/** Problems with one capability row: cell shape, reasons and names that do not exist (checks d and e). */
function rowProblems(row, { routes, toolNames, promptNames, uiPaths }) {
  if (row.length !== 5) return [`capability row must have 5 cells: ${row[0] ?? '(empty)'}`]
  const [name, api, mcp, ui] = row
  const problems = []
  // (e) every surface cell has names, or `no:` with a reason of at least 3 words.
  for (const [surface, cell] of [['API', api], ['MCP', mcp], ['UI', ui]]) {
    if (cell.startsWith('no:')) {
      if (cell.slice(3).trim().split(/\s+/).length < 3) problems.push(`${name}: ${surface} reason is too short`)
    } else if (items(cell).length === 0) {
      problems.push(`${name}: ${surface} cell is empty`)
    }
  }
  // (d) every name in a cell exists.
  const routeKeys = routes.map((r) => `${r.method} ${r.path}`)
  for (const key of items(api)) {
    if (!routeKeys.includes(key)) problems.push(`${name}: API route does not exist: ${key}`)
  }
  for (const item of items(mcp)) {
    const ok = item.startsWith('prompt:') ? promptNames.includes(item.slice(7)) : toolNames.includes(item)
    if (!ok) problems.push(`${name}: MCP tool or prompt does not exist: ${item}`)
  }
  for (const item of items(ui)) {
    if (!uiPaths.some((page) => coversPage(item, page))) problems.push(`${name}: UI page does not exist: ${item}`)
  }
  return problems
}

/** Problems with the infrastructure table: a key that matches no route is stale (check d). */
function infraProblems(infraKeys, routes) {
  return infraKeys
    .filter((key) => !routes.some((r) => matchesKey(r, key)))
    .map((key) => `infrastructure route does not exist: ${key}`)
}

/**
 * Every problem with the table, as readable strings. An empty list means aligned. Pure: the inputs
 * are the parsed tables, the route list, the tool and prompt names and the UI paths.
 */
export function checkAlignment({ tables, routes, toolNames, promptNames, uiPaths }) {
  const caps = tables.Capabilities ?? []
  const infraKeys = (tables.Infrastructure ?? []).map((row) => items(row[0] ?? '')[0] ?? '')
  const apiCovered = new Set(caps.flatMap((row) => items(row[1] ?? '')))
  const mcpCovered = new Set(caps.flatMap((row) => items(row[2] ?? '')))
  const uiCovered = caps.flatMap((row) => items(row[3] ?? ''))
  const problems = caps.flatMap((row) => rowProblems(row, { routes, toolNames, promptNames, uiPaths }))
  problems.push(...infraProblems(infraKeys, routes))

  // (a) every REST route is in a capability row or in the infrastructure table.
  for (const route of routes) {
    const key = `${route.method} ${route.path}`
    if (apiCovered.has(key) || infraKeys.some((k) => matchesKey(route, k))) continue
    problems.push(`REST route is missing from the table: ${key}`)
  }
  // (b) every MCP tool and prompt is in a capability row.
  for (const name of toolNames) if (!mcpCovered.has(name)) problems.push(`MCP tool is missing from the table: ${name}`)
  for (const name of promptNames) {
    if (!mcpCovered.has(`prompt:${name}`)) problems.push(`MCP prompt is missing from the table: ${name}`)
  }
  // (c) every UI page is in a capability row.
  for (const page of uiPaths) {
    if (!uiCovered.some((item) => coversPage(item, page))) problems.push(`UI page is missing from the table: ${page}`)
  }
  return problems
}

/** Every page path in src/**\/*.jsx (not `*`), read from the `path="..."` attributes. */
function uiPathsFromSrc() {
  const paths = new Set()
  for (const file of readdirSync(SRC, { recursive: true })) {
    if (!String(file).endsWith('.jsx')) continue
    const text = readFileSync(join(SRC, String(file)), 'utf8')
    for (const m of text.matchAll(/path="([^"]+)"/g)) if (m[1] !== '*') paths.add(m[1])
  }
  return [...paths]
}

const toolNames = [...listTools(null, 'https://app.example').map((t) => t.name), ...ADMIN_TOOLS.map((t) => t.name)]
const promptNames = listPrompts().map((p) => p.name)
const real = () => ({
  tables: parseTables(TABLE),
  routes: ROUTES,
  toolNames,
  promptNames,
  uiPaths: uiPathsFromSrc()
})

describe('capability table (docs/architecture/capabilities.md)', () => {
  it('lists every REST route, MCP tool, prompt and UI page, and no name that does not exist', () => {
    expect(checkAlignment(real())).toEqual([])
  })

  it('reports a tool that is missing from the table', () => {
    const input = real()
    input.tables.Capabilities = input.tables.Capabilities.filter((row) => !row[2].includes('list_drafts'))
    expect(checkAlignment(input).join('\n')).toContain('MCP tool is missing from the table: list_drafts')
  })

  it('reports a REST route that is missing from the table', () => {
    const input = real()
    input.tables.Capabilities = input.tables.Capabilities.filter((row) => !row[1].includes('GET /version'))
    expect(checkAlignment(input).join('\n')).toContain('REST route is missing from the table: GET /version')
  })

  it('reports a UI page that is missing from the table', () => {
    const input = real()
    input.tables.Capabilities = input.tables.Capabilities.filter((row) => !row[3].includes('/about'))
    expect(checkAlignment(input).join('\n')).toContain('UI page is missing from the table: /about')
  })

  it('reports a cell that names something that does not exist', () => {
    const input = real()
    input.tables.Capabilities.push(['Ghost', 'GET /ghost', 'ghost_tool', '/ghost', ''])
    const problems = checkAlignment(input).join('\n')
    expect(problems).toContain('API route does not exist: GET /ghost')
    expect(problems).toContain('MCP tool or prompt does not exist: ghost_tool')
    expect(problems).toContain('UI page does not exist: /ghost')
  })

  it('reports a surface marked "no:" without a reason of at least 3 words', () => {
    const input = real()
    input.tables.Capabilities.push(['Short', 'no: none', 'list_drafts', '/', ''])
    expect(checkAlignment(input).join('\n')).toContain('Short: API reason is too short')
  })
})
