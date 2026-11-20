// Implements #273 Task 4 (issue #278): offline, deterministic discovery score for the MCP tools.
// It asks: for each user phrase, which tool would a text-only ranker pick from the tool name, title and
// description (and the server instructions, in the `with_instructions` mode)? No model, no network, no money.
//
//   node tests/eval/discovery/score.mjs            prints the table, checks nothing
//   node tests/eval/discovery/score.mjs --record   rewrites tests/eval/discovery/baseline.json from this run
//
// The test in tests/api/mcp-discovery.test.js calls the same functions and fails when a number falls below
// the recorded floor. See docs/architecture/mcp-discovery.md for how to read the report and raise a floor.
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { WRITE_TOOLS } from '../mcp-default-use.eval.mjs'

export const MODES = ['with_instructions', 'tools_only']
const K1 = 1.2
const B = 0.75
// Hebrew points only (cantillation U+0591-U+05AF, vowel marks U+05B0-U+05BD, U+05BF, U+05C1, U+05C2, U+05C4, U+05C5, U+05C7).
// Maqaf U+05BE and sof pasuq U+05C3 are punctuation, so they are kept.
const NIQQUD = /[\u0591-\u05AF\u05B0-\u05BD\u05BF\u05C1\u05C2\u05C4\u05C5\u05C7]/g
const HEBREW_PREFIXES = new Set(['ו', 'ה', 'ב', 'ל', 'מ', 'ש', 'כ'])
const HEBREW = /\p{Script=Hebrew}/u

/**
 * NFC, lowercase, Hebrew niqqud removed, Unicode letters and digits. A Hebrew token of 3+ letters that starts
 * with a prefix letter (ו ה ב ל מ ש כ) is indexed twice: as written and with that one letter removed.
 */
export function tokenize(text) {
  const norm = String(text ?? '').normalize('NFC').replace(NIQQUD, '').toLowerCase()
  const out = []
  for (const [token] of norm.matchAll(/[\p{L}\p{N}]+/gu)) {
    out.push(token)
    if (HEBREW.test(token) && token.length >= 3 && HEBREW_PREFIXES.has(token[0])) out.push(token.slice(1))
  }
  return out
}

/** The sentences of the server instructions that name this tool (whole-word match on its name). */
function sentencesNaming(instructions, name) {
  const word = new RegExp(`(?<![A-Za-z0-9_])${name}(?![A-Za-z0-9_])`)
  return String(instructions ?? '').split(/(?<=[.!?])\s+/).filter((sentence) => word.test(sentence))
}

/** One document per tool: name split on `_`, title, description; in the instructions mode, also the sentences that name it. */
export function buildDocs(tools, { instructions } = {}) {
  return tools.map((tool) => {
    const parts = [tool.name.replace(/_/g, ' '), tool.title ?? '', tool.description ?? '']
    if (instructions) parts.push(...sentencesNaming(instructions, tool.name))
    return { name: tool.name, tokens: tokenize(parts.join(' ')) }
  })
}

/** BM25 over prepared docs. Ties are sorted by tool name, so the order is the same on every run. */
function rankDocs(queryTokens, docs) {
  const N = docs.length
  const counts = docs.map((doc) => {
    const map = new Map()
    for (const token of doc.tokens) map.set(token, (map.get(token) ?? 0) + 1)
    return map
  })
  const avgdl = docs.reduce((sum, doc) => sum + doc.tokens.length, 0) / N
  const terms = [...new Set(queryTokens)]
  const scored = docs.map((doc, i) => {
    let score = 0
    for (const term of terms) {
      const tf = counts[i].get(term) ?? 0
      if (!tf) continue
      const df = counts.filter((map) => map.has(term)).length
      const idf = Math.log(1 + (N - df + 0.5) / (df + 0.5))
      score += idf * (tf * (K1 + 1)) / (tf + K1 * (1 - B + (B * doc.tokens.length) / avgdl))
    }
    return { name: doc.name, score }
  })
  return scored.sort((a, b) => b.score - a.score || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
}

/** Tools in score order for one phrase. `instructions` adds the instruction sentences that name each tool. */
export function rank(phrase, tools, { instructions } = {}) {
  return rankDocs(tokenize(phrase), buildDocs(tools, { instructions }))
}

const round3 = (x) => Math.round(x * 1000) / 1000
const ceil3 = (x) => Math.ceil(x * 1000) / 1000

/** Names that count as naming X, Twitter, the connector or a draft. Used by the corpus check. */
export const NAMES_CONNECTOR = /\bX\b|twitter|connector|draft|טוויטר|טיוטה|טיוטות|טיוטת|קונקטור/i

/**
 * Scores the corpus in both modes. Positive phrases: top-1 and top-3 hits, the margin (best expected score minus
 * best other score). Negatives: the best write-tool score. Admin tools, when given, join the pool for `adminRun`.
 */
export function evaluate({ tools, instructions, intents, negatives, admin = [] }) {
  const modes = {}
  for (const mode of MODES) {
    const text = mode === 'with_instructions' ? instructions : undefined
    const docs = buildDocs(tools, { instructions: text })
    const cells = {}
    const phrases = []
    for (const intent of intents) {
      for (const phrase of intent.phrases) {
        const ranked = rankDocs(tokenize(phrase.text), docs)
        const rankOf = ranked.findIndex((r) => phrase.expect.includes(r.name))
        const bestExpected = ranked.find((r) => phrase.expect.includes(r.name)).score
        const bestOther = ranked.find((r) => !phrase.expect.includes(r.name)).score
        const row = {
          mode, intent: intent.id, lang: phrase.lang, text: phrase.text,
          rank: rankOf, top1: rankOf === 0, top3: rankOf < 3, margin: round3(bestExpected - bestOther), first: ranked[0].name
        }
        phrases.push(row)
        const cell = (((cells[intent.id] ??= {})[phrase.lang]) ??= { top1: 0, top3: 0, total: 0, margin: Infinity })
        cell.total += 1
        if (row.top1) cell.top1 += 1
        if (row.top3) cell.top3 += 1
        cell.margin = Math.min(cell.margin, row.margin)
      }
    }
    const negs = {}
    for (const neg of negatives) {
      const ranked = rankDocs(tokenize(neg.text), docs)
      const writeTop = ranked.find((r) => WRITE_TOOLS.includes(r.name))
      const entry = (negs[neg.lang] ??= { max_write_score: 0, total: 0 })
      entry.total += 1
      entry.max_write_score = Math.max(entry.max_write_score, writeTop.score)
    }
    for (const lang of Object.keys(negs)) negs[lang].max_write_score = ceil3(negs[lang].max_write_score)
    modes[mode] = { cells, negatives: negs, phrases }
  }

  // Admin run: normal tools and admin tools share one pool; no normal phrase may rank an admin tool first.
  const adminFirst = []
  if (admin.length) {
    const pool = [...tools, ...admin]
    const adminNames = new Set(admin.map((t) => t.name))
    for (const mode of MODES) {
      const docs = buildDocs(pool, { instructions: mode === 'with_instructions' ? instructions : undefined })
      for (const phrase of [...intents.flatMap((i) => i.phrases), ...negatives]) {
        const first = rankDocs(tokenize(phrase.text), docs)[0].name
        if (adminNames.has(first)) adminFirst.push({ mode, text: phrase.text, first })
      }
    }
  }
  return { modes, adminFirst }
}

/** Compact table: one line per intent, language and mode. */
export function formatTable(report) {
  const lines = ['intent            lang mode              top1 top3 margin']
  for (const mode of MODES) {
    const { cells } = report.modes[mode]
    for (const [intent, langs] of Object.entries(cells)) {
      for (const [lang, c] of Object.entries(langs)) {
        lines.push(`${intent.padEnd(17)} ${lang.padEnd(4)} ${mode.padEnd(18)} ${`${c.top1}/${c.total}`.padEnd(5)} ${`${c.top3}/${c.total}`.padEnd(5)} ${c.margin}`)
      }
    }
    for (const [lang, n] of Object.entries(report.modes[mode].negatives)) {
      lines.push(`negatives         ${lang.padEnd(4)} ${mode.padEnd(18)} max write score ${n.max_write_score}`)
    }
  }
  return lines.join('\n')
}

/**
 * Turns one run into the baseline floors. Known failures are the positive phrases that miss the top 3 in a mode;
 * each keeps the reason the run gave (the rank and the tool that came first).
 */
export function toBaseline(report) {
  const baseline = { schema: 1, modes: {}, known_failures: [] }
  for (const mode of MODES) {
    const { cells, negatives, phrases } = report.modes[mode]
    baseline.modes[mode] = { cells, negatives: Object.fromEntries(Object.entries(negatives).map(([lang, n]) => [lang, { max_write_score: n.max_write_score }])) }
    for (const row of phrases.filter((p) => !p.top3)) {
      baseline.known_failures.push({
        kind: 'top3', mode, intent: row.intent, lang: row.lang, text: row.text,
        reason: `top-3 miss at run: ranked ${row.rank + 1}, ${row.first} first`
      })
    }
  }
  for (const hit of report.adminFirst) {
    baseline.known_failures.push({
      kind: 'admin_first', mode: hit.mode, intent: null, lang: null, text: hit.text,
      reason: `admin pool: ${hit.first} ranks first for this normal phrase`
    })
  }
  return baseline
}

/** Cell floors (top-1, top-3, margin) for one mode. Every cell needs a floor. */
function cellFailures(mode, cells, floors) {
  const failures = []
  for (const [intent, langs] of Object.entries(cells)) {
    for (const [lang, c] of Object.entries(langs)) {
      const floor = floors[intent]?.[lang]
      const where = `${mode} ${intent} ${lang}`
      if (!floor) { failures.push(`${where}: no floor in the baseline (record it)`); continue }
      if (c.top1 < floor.top1) failures.push(`${where}: top-1 ${c.top1} is below the floor ${floor.top1}`)
      if (c.top3 < floor.top3) failures.push(`${where}: top-3 ${c.top3} is below the floor ${floor.top3}`)
      if (c.margin < floor.margin) failures.push(`${where}: margin ${c.margin} is below the floor ${floor.margin}`)
    }
  }
  return failures
}

/** Negative thresholds for one mode: the best write-tool score must stay at or below the recorded threshold. */
function negativeFailures(mode, negatives, thresholds) {
  return Object.entries(negatives).flatMap(([lang, n]) => {
    const limit = thresholds?.[lang]?.max_write_score
    if (limit === undefined) return [`${mode} negatives ${lang}: no threshold in the baseline (record it)`]
    return n.max_write_score > limit ? [`${mode} negatives ${lang}: a write tool scores ${n.max_write_score}, above ${limit}`] : []
  })
}

/** The failures of one run against the baseline. An empty list means the run passes. */
export function checkAgainst(report, baseline, { adminFirst = report.adminFirst } = {}) {
  const known = new Set(baseline.known_failures.map((k) => `${k.kind}|${k.mode}|${k.intent}|${k.lang}|${k.text}`))
  const failures = []
  for (const mode of MODES) {
    const { cells, negatives, phrases } = report.modes[mode]
    failures.push(...cellFailures(mode, cells, baseline.modes[mode]?.cells ?? {}))
    failures.push(...negativeFailures(mode, negatives, baseline.modes[mode]?.negatives))
    for (const row of phrases.filter((p) => !p.top3)) {
      if (!known.has(`top3|${mode}|${row.intent}|${row.lang}|${row.text}`)) {
        failures.push(`${mode} ${row.intent} ${row.lang} "${row.text}": missed top 3 (ranked ${row.rank + 1}) and is not in known_failures`)
      }
    }
  }
  for (const hit of adminFirst) {
    if (!known.has(`admin_first|${hit.mode}|null|null|${hit.text}`)) failures.push(`${hit.mode}: admin tool ${hit.first} ranks first for "${hit.text}" and is not in known_failures`)
  }
  return failures
}

/** Loads the real tools, admin tools, prompts and instructions from the server modules. */
export async function loadServer() {
  const [{ INSTRUCTIONS }, { listTools }, { listAdminTools }, { listPrompts }] = await Promise.all([
    import('../../../server/mcp/server.js'),
    import('../../../server/mcp/tools.js'),
    import('../../../server/mcp/admin-tools.js'),
    import('../../../server/mcp/prompts.js')
  ])
  return { instructions: INSTRUCTIONS, tools: listTools(), admin: listAdminTools(), prompts: listPrompts() }
}

const here = new URL('.', import.meta.url)
const readJson = (name) => JSON.parse(readFileSync(new URL(name, here), 'utf8'))

/** One full run: the real server, the committed corpus. */
export async function runCorpus() {
  const server = await loadServer()
  const { intents, negatives } = readJson('./intents.json')
  return { server, intents, negatives, report: evaluate({ tools: server.tools, instructions: server.instructions, intents, negatives, admin: server.admin }) }
}

/** Floors that a new run would lower (a higher number is worse for negatives). Empty when nothing goes down. */
export function loweredFloors(baseline, next) {
  const out = []
  for (const mode of MODES) {
    for (const [intent, langs] of Object.entries(next.modes[mode].cells)) {
      for (const [lang, c] of Object.entries(langs)) {
        const old = baseline.modes?.[mode]?.cells?.[intent]?.[lang]
        if (!old) continue
        for (const key of ['top1', 'top3', 'margin']) if (c[key] < old[key]) out.push(`${mode} ${intent} ${lang} ${key}: ${old[key]} -> ${c[key]}`)
      }
    }
    for (const [lang, n] of Object.entries(next.modes[mode].negatives)) {
      const old = baseline.modes?.[mode]?.negatives?.[lang]
      if (old && n.max_write_score > old.max_write_score) out.push(`${mode} negatives ${lang}: ${old.max_write_score} -> ${n.max_write_score}`)
    }
  }
  return out
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { report } = await runCorpus()
  if (process.argv.includes('--record')) {
    const path = new URL('./baseline.json', here)
    const previous = existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : null
    const lowered = previous && !process.argv.includes('--allow-lower') ? loweredFloors(previous, report) : []
    if (lowered.length) {
      console.error('refused: this run lowers floors. Fix the regression, or pass --allow-lower on purpose:')
      for (const line of lowered) console.error('  ' + line)
      process.exit(1)
    }
    writeFileSync(path, `${JSON.stringify(toBaseline(report), null, 2)}\n`)
    console.log('baseline.json written from this run')
  }
  console.log(formatTable(report))
  console.log(`admin tools ranked first for a normal phrase: ${report.adminFirst.length}`)
}
