// Implements #273 Task C1 (issue #365): the client and language matrix in docs/architecture/client-matrix.md.
// Pure checks, no model, no network. tests/api/client-matrix.test.js runs them; the weekly review (#294, #295) runs
// `node tests/eval/client-matrix.mjs --stale` to list `not checked` cells older than 30 days.
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const HEBREW = /\p{Script=Hebrew}/u
const LATIN_WORD = /[A-Za-z][A-Za-z0-9_-]*/g
// Latin words a Hebrew text may keep: product and service names. Anything else in a Hebrew part was not translated.
export const LATIN_ALLOWED = new Set(['X', 'Twitter', 'MCP', 'URL', 'AI'])
// What a feature row can cover. Each must be covered by at least one row; `view:<name>` must name a served view.
export const SURFACES = ['instructions', 'tools', 'results', 'prompts', 'skill']

/** Splits `| a | b |` into trimmed cells with backticks removed. */
const cellsOf = (line) =>
  line.replace(/^\|/, '').replace(/\|\s*$/, '').split('|').map((c) => c.replace(/`/g, '').trim())

/** Every table of the markdown, keyed by its `## heading`: { header: [...], rows: [[...]] }. */
export function parseMatrix(markdown) {
  const tables = {}
  let heading = null
  for (const line of markdown.split('\n')) {
    const h = line.match(/^##\s+(.+?)\s*$/)
    if (h) heading = h[1]
    if (h || !line.startsWith('|') || !heading) continue
    const cells = cellsOf(line)
    if (cells.every((c) => /^:?-+:?$/.test(c))) continue
    if (!tables[heading]) tables[heading] = { header: cells, rows: [] }
    else tables[heading].rows.push(cells)
  }
  return tables
}

/** A cell as { kind, refs, reason }: kind is built, no, not_checked or bad. */
export function readCell(cell) {
  if (cell === 'not checked') return { kind: 'not_checked' }
  if (cell.startsWith('no:')) return { kind: 'no', reason: cell.slice(3).trim() }
  if (cell.startsWith('built:')) return { kind: 'built', refs: cell.slice(6).split(',').map((s) => s.trim()).filter(Boolean) }
  return { kind: 'bad' }
}

const words = (text) => text.split(/\s+/).filter(Boolean).length
const languageHeading = (lang) => `Language: ${lang}`

/** Problems with one cell: shape, reason length, refs that do not exist. `where` names it in the message. */
function cellProblems(cell, where, fileExists) {
  const c = readCell(cell ?? '')
  if (c.kind === 'bad') return [`${where}: cell must be "built: <file>", "no: <reason>" or "not checked", got "${cell ?? ''}"`]
  if (c.kind === 'no' && words(c.reason) < 3) return [`${where}: the "no:" reason needs at least 3 words`]
  if (c.kind === 'built' && c.refs.length === 0) return [`${where}: "built:" names no file or test`]
  if (c.kind === 'built') return c.refs.filter((ref) => !fileExists(ref)).map((ref) => `${where}: built names a file that does not exist: ${ref}`)
  return []
}

/** A client cell against the server cell and the client fact the feature needs (clients.json). */
function factProblems(cell, server, fact, where) {
  const c = readCell(cell ?? '')
  if (server.kind === 'no' && c.kind !== 'no') return [`${where}: the server cell is "no:", so this cell must be "no:" too`]
  if (fact === undefined) return []
  if (fact === false && c.kind !== 'no') return [`${where}: clients.json says this client does not do it, so the cell must be "no:"`]
  if (fact === 'not checked' && c.kind === 'built') return [`${where}: clients.json says "not checked" for what this feature needs, so the cell cannot be "built"`]
  return []
}

/** Problems with the Features table rows: cell count, Needs, Checked date and what Covers names. */
function featureProblems(features, { fields, views, fileExists }) {
  const problems = []
  for (const row of features) {
    const [name, covers = '', needs = '', checked = ''] = row
    if (row.length !== 4) problems.push(`Features ${name}: must have 4 cells (Feature, Covers, Needs, Checked)`)
    if (needs !== 'none' && !fields.has(needs)) problems.push(`Features ${name}: Needs must be "none" or a clients.json field, got "${needs}"`)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(checked)) problems.push(`Features ${name}: Checked must be a date (YYYY-MM-DD)`)
    for (const item of listOf(covers)) {
      const ok = SURFACES.includes(item) || (item.startsWith('view:') && views.includes(item.slice(5))) || fileExists(item)
      if (!ok) problems.push(`Features ${name}: Covers names nothing that exists: ${item}`)
    }
  }
  const covered = new Set(features.flatMap((row) => listOf(row[1] ?? '')))
  return problems.concat(
    [...SURFACES, ...views.map((v) => `view:${v}`)].filter((surface) => !covered.has(surface)).map((surface) => `no feature row covers ${surface}`)
  )
}

const listOf = (cell) => cell.split(',').map((s) => s.trim()).filter(Boolean)

/** Problems with one feature row of a language table: the Server cell, then each client cell. */
function rowProblems(row, header, feature, { lang, clients, fileExists }) {
  const name = row[0]
  const problems = []
  if (row.length !== header.length) problems.push(`${lang} ${name}: has ${row.length} cells, the header has ${header.length}`)
  const server = readCell(row[1] ?? '')
  if (server.kind === 'not_checked') problems.push(`${lang} ${name} Server: the server side is always checkable: "built:" or "no:"`)
  problems.push(...cellProblems(row[1], `${lang} ${name} Server`, fileExists))
  header.slice(2).forEach((client, i) => {
    const where = `${lang} ${name} ${client}`
    const fact = feature[2] === 'none' ? undefined : clients.clients[client]?.[feature[2]]?.value
    problems.push(...cellProblems(row[i + 2], where, fileExists), ...factProblems(row[i + 2], server, fact, where))
  })
  return problems
}

/** Problems with the table of one language: its columns against clients.json, its rows against Features. */
function languageTableProblems(lang, table, features, { clients, fileExists }) {
  if (!table) return [`no table "## ${languageHeading(lang)}" for the supported language ${lang}`]
  const { header, rows } = table
  const clientNames = Object.keys(clients.clients)
  const problems = []
  if (header[0] !== 'Feature' || header[1] !== 'Server') problems.push(`${lang}: the first columns must be Feature and Server`)
  for (const client of clientNames) if (!header.includes(client)) problems.push(`${lang}: no column for the client ${client} (clients.json)`)
  for (const column of header.slice(2)) if (!clientNames.includes(column)) problems.push(`${lang}: column ${column} is not a client in clients.json`)
  for (const [name] of features) if (!rows.some((row) => row[0] === name)) problems.push(`${lang}: feature row is missing: ${name}`)
  for (const row of rows) {
    const feature = features.find((f) => f[0] === row[0])
    if (!feature) problems.push(`${lang}: ${row[0]} is not in the Features table`)
    else problems.push(...rowProblems(row, header, feature, { lang, clients, fileExists }))
  }
  return problems
}

/**
 * Every problem with the matrix, as readable strings; an empty list means it is complete and consistent.
 * Inputs: the parsed tables, clients.json, the served view names, and a file check (repo-relative paths).
 */
export function checkMatrix({ tables, clients, views, fileExists }) {
  const features = tables.Features?.rows ?? []
  if (!features.length) return ['the Features table is missing or empty']
  const fields = new Set(Object.values(clients.clients).flatMap((profile) => Object.keys(profile)))
  return [
    ...featureProblems(features, { fields, views, fileExists }),
    ...(clients.languages ?? []).flatMap((lang) => languageTableProblems(lang, tables[languageHeading(lang)], features, { clients, fileExists }))
  ]
}

/** Features with a `not checked` cell whose Checked date is more than `days` days before `today` (YYYY-MM-DD). */
export function staleNotChecked(tables, today, days = 30) {
  const limit = new Date(`${today}T00:00:00Z`).getTime() - days * 86400000
  const stale = []
  for (const [name, , , checked] of tables.Features?.rows ?? []) {
    if (new Date(`${checked}T00:00:00Z`).getTime() >= limit) continue
    for (const [heading, table] of Object.entries(tables)) {
      if (!heading.startsWith('Language: ')) continue
      const row = table.rows.find((r) => r[0] === name) ?? []
      const clients = table.header.slice(2).filter((_, i) => readCell(row[i + 2] ?? '').kind === 'not_checked')
      if (clients.length) stale.push({ feature: name, lang: heading.slice(10), checked, clients })
    }
  }
  return stale
}

/**
 * The English and Hebrew parts of a text written as "... Also: <en>. Hebrew: <he>." (tool and prompt descriptions).
 * The service names after the parts ("on X/Twitter", "(X/טוויטר)") are left out. Null when the text has neither marker.
 */
export function triggerPair(text) {
  const m = String(text).match(/Also: (.*?)(?:, on X\/Twitter)?\. Hebrew: (.*?)(?: \(X\/טוויטר\))?\.(?: |$)/)
  return m ? { en: m[1].trim(), he: m[2].trim() } : null
}

/** Latin words in a Hebrew text that are not product names: an untranslated placeholder or word. */
export const untranslated = (he) => (he.match(LATIN_WORD) ?? []).filter((word) => !LATIN_ALLOWED.has(word))

/**
 * Problems with the English and Hebrew pairs of the client-facing text: each entry is { key, text, kind }. kind
 * `pair` (tool and prompt descriptions) needs an English part with no Hebrew and a Hebrew part with Hebrew letters and
 * no untranslated Latin words. kind `mixed` (instructions, skill description) needs English text and Hebrew words.
 */
export function languageProblems(entries) {
  const problems = []
  for (const { key, text, kind } of entries) {
    if (kind === 'mixed') {
      if (!/[A-Za-z]{3}/.test(text)) problems.push(`${key}: no English text`)
      if (!HEBREW.test(text)) problems.push(`${key}: English text has no Hebrew counterpart (no Hebrew words)`)
      continue
    }
    const pair = triggerPair(text)
    if (!pair) { problems.push(`${key}: no "Also: <English>. Hebrew: <Hebrew>." part`); continue }
    if (!/[A-Za-z]/.test(pair.en) || HEBREW.test(pair.en)) problems.push(`${key}: Hebrew text has no English counterpart`)
    if (!HEBREW.test(pair.he)) problems.push(`${key}: English text has no Hebrew counterpart`)
    const latin = untranslated(pair.he)
    if (latin.length) problems.push(`${key}: Hebrew part has untranslated Latin words: ${latin.join(', ')}`)
  }
  return problems
}

/** The matrix and clients.json from the repo, and a repo-relative file check. */
export function loadMatrix() {
  return {
    tables: parseMatrix(readFileSync(join(ROOT, 'docs/architecture/client-matrix.md'), 'utf8')),
    clients: JSON.parse(readFileSync(join(ROOT, 'tests/eval/discovery/clients.json'), 'utf8')),
    fileExists: (ref) => !ref.includes('..') && existsSync(join(ROOT, ref))
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url) && process.argv.includes('--stale')) {
  const today = new Date().toISOString().slice(0, 10)
  const stale = staleNotChecked(loadMatrix().tables, today)
  for (const s of stale) console.log(`${s.feature} (${s.lang}, checked ${s.checked}): not checked for ${s.clients.join(', ')}`)
  console.log(`${stale.length} stale rows (older than 30 days on ${today})`)
}
