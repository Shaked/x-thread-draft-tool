#!/usr/bin/env node
// Weekly improvement review, deterministic part (epic #273, task #295). Node 20, no model, no tokens.
//
// It collects signals (npm outdated and audit, the MCP and Vercel pins, the Telegram Bot API version,
// the Node LTS line, the stale client-matrix rows, the speed flags of the last 7 days), hashes them and
// compares the hash with the one stored in the newest `weekly` issue.
// The speed flags are booleans only, per stage: `over` (p90 over its limit) and `slower` (median 20 % and
// 10 s higher than last week). The seconds never enter the fingerprint (task S7, #315, plan speed.md section 6).
//   nochange    the fingerprint is the same as last week: nothing to do
//   still-open  it changed, but a `weekly` issue is still open: create nothing
//   create      it changed and no `weekly` issue is open: open ONE issue (labels task and weekly)
// A source that cannot be read is left out of the fingerprint: its last value is carried from the
// previous issue, and the body lists it as unreadable. A failed fetch never opens an issue by itself.
//
// CLI (the workflow passes every value through environment variables):
//   node scripts/weekly-review-check.mjs                plan; writes GITHUB_OUTPUT and the issue body file
//   node scripts/weekly-review-check.mjs notify         one Telegram line (kind weekly-started) after the issue is opened
// Env for the plan: LAST_BODY_FILE (the newest weekly issue body, empty file on the first run),
// OPEN_WEEKLY (count of open weekly issues), BODY_FILE (where the issue body is written),
// DRY_RUN ('true' prints only), TEMPLATE (default .github/weekly-review-issue.md), GITHUB_OUTPUT,
// SPEED_FILE (speed.json of `speed-metrics.mjs --since 7d`; missing = speed unreadable),
// SPEED_MD (its speed.md, put in the issue body when a speed flag is true).
// Env for notify: TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID, ISSUE_TITLE, ISSUE_URL.

import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { appendFileSync, existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { buildMessage, notify } from './notify-telegram.mjs'

export const TEMPLATE = '.github/weekly-review-issue.md'
export const FINGERPRINT_MARK = /<!-- weekly-fingerprint:([0-9a-f]{64}) -->/
export const TELEGRAM_API_PAGE = 'https://core.telegram.org/bots/api'
export const NODE_INDEX = 'https://nodejs.org/dist/index.json'
// The packages whose pins the check compares with the newest version on npm.
// One weekly review per week (AGENTS.md). Scheduled runs start late, so a run may come up to a day after
// its week ends. 6 days blocks a second run in the same week, and never skips a whole week because of cron delay.
export const WEEK_MS = 6 * 24 * 60 * 60 * 1000
export const PINNED_PACKAGES = ['@modelcontextprotocol/ext-apps', '@modelcontextprotocol/sdk', '@vercel/functions']

// Canonical JSON: keys sorted at every level, so the same facts always give the same text.
export function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k])}`)
      .join(',')}}`
  }
  return JSON.stringify(value ?? null)
}

export function fingerprintOf(facts) {
  return createHash('sha256').update(canonicalJson(facts)).digest('hex')
}

// Lines in a fenced block. Backticks become apostrophes, so text from a package or a web page can
// never close the block or render as a link or mention. Same rule as the cleanup review.
export function fence(lines, lang = 'text') {
  const safe = lines.map((l) => String(l).replace(/`/g, "'"))
  return ['```' + lang, ...safe, '```'].join('\n')
}

// Bump kind between two x.y.z strings: major, minor, patch, or other when a version is not x.y.z.
export function bumpKind(current, latest) {
  const parse = (v) => {
    const m = /^(\d+)\.(\d+)\.(\d+)/.exec(String(v || ''))
    return m ? m.slice(1).map(Number) : null
  }
  const a = parse(current)
  const b = parse(latest)
  if (!a || !b) return 'other'
  if (a[0] !== b[0]) return 'major'
  if (a[1] !== b[1]) return 'minor'
  if (a[2] !== b[2]) return 'patch'
  return 'same'
}

// `npm outdated --json` (exit code 1 when something is outdated is normal). Returns a sorted list.
export function parseOutdated(text) {
  if (text === null || text === undefined) return null
  const data = JSON.parse(String(text).trim() || '{}')
  // npm prints { "error": { ... } } when the registry fails. That is unreadable, not "nothing is outdated".
  const err = data.error
  if (err && typeof err === 'object' && !('current' in err) && !('latest' in err)) return null
  return Object.keys(data)
    .sort()
    .map((name) => {
      const row = data[name] || {}
      return { name, current: row.current || '', latest: row.latest || '', kind: bumpKind(row.current, row.latest) }
    })
    .filter((row) => row.latest && row.kind !== 'same')
}

// `npm audit --json`: the counts by severity. Returns null when the output has no counts.
export function parseAudit(text) {
  if (text === null || text === undefined) return null
  const counts = JSON.parse(String(text).trim() || '{}')?.metadata?.vulnerabilities
  if (!counts) return null
  const pick = (k) => Number(counts[k] || 0)
  return { critical: pick('critical'), high: pick('high'), moderate: pick('moderate'), low: pick('low') }
}

// `npm view <pkg> version` prints one line.
export function parseNpmVersion(text) {
  if (text === null || text === undefined) return null
  const v = String(text).trim()
  return /^\d+\.\d+\.\d+/.test(v) ? v : null
}

// The first "Bot API x.y" heading of the Telegram Bot API page.
export function parseTelegramApi(html) {
  if (html === null || html === undefined) return null
  const m = /Bot API (\d+\.\d+)/.exec(String(html))
  return m ? m[1] : null
}

// The newest LTS major from https://nodejs.org/dist/index.json (newest first, LTS entries carry `lts`).
export function parseNodeLts(json) {
  if (json === null || json === undefined) return null
  const releases = typeof json === 'string' ? JSON.parse(json) : json
  const lts = releases.find((r) => r && r.lts)
  const m = lts ? /^v(\d+)\./.exec(lts.version) : null
  return m ? Number(m[1]) : null
}

// The node-version values in the workflow files: [{ name, text }] in, sorted unique majors out.
export function parseWorkflowNodeVersions(files) {
  const found = new Set()
  for (const { text } of files) {
    for (const m of String(text).matchAll(/node-version:\s*['"]?(\d+)/g)) found.add(Number(m[1]))
  }
  return [...found].sort((a, b) => a - b)
}

// The speed flags from a speed.json (scripts/speed-metrics.mjs): per kind and stage, two booleans.
// `over`: the p90 is over its limit. `slower`: the median is 20 % and 10 s higher than last week; a run
// without a previous file has no change, so slower is false. Null when the document cannot be read.
export function speedFacts(doc) {
  const summary = doc && typeof doc === 'object' ? doc.summary : null
  if (!summary || typeof summary !== 'object') return null
  const out = {}
  for (const kind of Object.keys(summary).sort()) {
    const stages = summary[kind]
    if (!stages || typeof stages !== 'object') continue
    out[kind] = {}
    for (const stage of Object.keys(stages).sort()) {
      const s = stages[stage]
      if (!s || typeof s !== 'object') continue
      out[kind][stage] = { over: s.over === true, slower: s.change?.slower === true }
    }
  }
  return Object.keys(out).length ? out : null
}

// True when any speed flag is set: the issue then carries the speed table.
export function speedFlagged(speed) {
  if (!speed) return false
  return Object.values(speed).some((stages) => Object.values(stages).some((s) => s.over || s.slower))
}

// One line for the signals block: how many stage flags are set.
export function speedSummaryText(speed) {
  const all = Object.values(speed).flatMap((stages) => Object.values(stages))
  return `${all.filter((s) => s.over).length} stage(s) over the limit, ${all.filter((s) => s.slower).length} slower than last week`
}

// Reads the facts from the last issue body: the JSON block, but only when its hash matches the marker.
export function readLastFacts(body) {
  // GitHub's web editor saves CRLF line endings after an edit (for example a ticked checkbox).
  const text = String(body || '').replace(/\r\n/g, '\n')
  const mark = FINGERPRINT_MARK.exec(text)
  const block = /```json\n([\s\S]*?)\n```/.exec(text)
  if (!mark || !block) return null
  try {
    const facts = JSON.parse(block[1])
    return fingerprintOf(facts) === mark[1] ? facts : null
  } catch {
    return null
  }
}

// A marker whose facts cannot be trusted, plus a source that cannot be read now: nothing to compare.
function cannotCompare(lastBody, trusted, unreadable) {
  const hasMarker = FINGERPRINT_MARK.test(String(lastBody || '').replace(/\r\n/g, '\n'))
  return hasMarker && !trusted && unreadable.length > 0
}

function openedWithinWeek(lastCreatedAt, now) {
  const created = Date.parse(lastCreatedAt)
  return Number.isFinite(created) && now.getTime() - created < WEEK_MS
}

// A source that cannot be read keeps its last value, so it never changes the fingerprint.
function factsWithCarry(current, last) {
  const facts = {}
  for (const key of Object.keys(current)) {
    if (current[key] !== null) facts[key] = current[key]
    else if (key in last) facts[key] = last[key]
  }
  return facts
}

// Decides the action. `current` maps each source to its value, or null when it could not be read.
export function planWeeklyReview({ current, lastBody = '', openWeekly = 0, lastCreatedAt = '', now = new Date(), date = '', template = '', speedMd = '' }) {
  const trusted = readLastFacts(lastBody)
  const last = trusted || {}
  const unreadable = Object.keys(current).filter((k) => current[k] === null)
  // A marker whose facts cannot be trusted, plus a source that cannot be read now: no way to compare, so nothing opens.
  if (cannotCompare(lastBody, trusted, unreadable)) {
    return { action: 'nochange', fingerprint: '', unreadable, message: 'last review cannot be read and a source is unreadable: nothing to compare' }
  }
  const facts = factsWithCarry(current, last)
  const fingerprint = fingerprintOf(facts)
  const lastFingerprint = FINGERPRINT_MARK.exec(String(lastBody || ''))?.[1] || ''
  // Nothing could be read at all: a failed fetch never opens an issue by itself.
  if (Object.keys(facts).length === 0) {
    return { action: 'nochange', fingerprint, unreadable, message: 'no source could be read: nothing to compare' }
  }
  if (fingerprint === lastFingerprint) {
    return { action: 'nochange', fingerprint, unreadable, message: 'nothing changed since the last weekly review' }
  }
  const message = `changed: fingerprint ${fingerprint.slice(0, 12)}` + (unreadable.length ? `, unreadable: ${unreadable.join(', ')}` : '')
  if (openedWithinWeek(lastCreatedAt, now)) {
    return { action: 'this-week', fingerprint, unreadable, facts, message: 'changed, but a weekly issue was opened within the last 7 days' }
  }
  if (openWeekly > 0) return { action: 'still-open', fingerprint, unreadable, facts, message: 'changed, but a weekly issue is still open' }
  return {
    action: 'create',
    fingerprint,
    unreadable,
    facts,
    message,
    title: `Weekly review ${date}`.trim(),
    body: buildBody({ facts, fingerprint, unreadable, template, speedMd }),
  }
}

// The issue body: the template, the signals in a block, the unreadable sources, and the hash + JSON
// the next run reads back.
export function buildBody({ facts, fingerprint, unreadable = [], template = '', speedMd = '' }) {
  const parts = []
  if (template.trim()) parts.push(template.trim())
  const lines = []
  if (facts.speed) lines.push(`Speed, last 7 days: ${speedSummaryText(facts.speed)}`)
  if (facts.outdated) lines.push(`Outdated packages: ${facts.outdated.length}`, ...facts.outdated.map((o) => `${o.name} ${o.current} -> ${o.latest} (${o.kind})`))
  if (facts.audit) lines.push(`Audit: critical ${facts.audit.critical}, high ${facts.audit.high}, moderate ${facts.audit.moderate}, low ${facts.audit.low}`)
  if (facts.pins) lines.push(...Object.entries(facts.pins).map(([name, p]) => `Pin ${name}: ${p.pinned} (npm latest ${p.latest})`))
  if (facts.telegramApi) lines.push(`Telegram Bot API: ${facts.telegramApi}`)
  if (facts.node) lines.push(`Node majors in workflows: ${facts.node.workflow.join(', ')}; newest LTS major: ${facts.node.lts}`)
  if (typeof facts.matrixStale === 'number') lines.push(`Client matrix rows not checked for over 30 days: ${facts.matrixStale}`)
  parts.push('Signals this week (checked by scripts/weekly-review-check.mjs):')
  parts.push(fence(lines))
  if (speedFlagged(facts.speed) && speedMd.trim()) {
    parts.push('Speed table (scripts/speed-metrics.mjs --since 7d). A stage is over when its p90 is over the limit, slower when its median rose:')
    parts.push(fence(speedMd.trim().split('\n')))
  }
  if (unreadable.length) parts.push(`Unreadable this week (value carried from the last issue): ${unreadable.join(', ')}`)
  parts.push(`<!-- weekly-fingerprint:${fingerprint} -->`)
  // A backtick is written as the JSON escape `: it still reads back as the same text, and it cannot close the block.
  parts.push(fence([JSON.stringify(facts, null, 2).replace(/`/g, '\\u0060')], 'json'))
  parts.push('Rules: docs/operations/weekly-review.md')
  return parts.join('\n\n') + '\n'
}

// Runs a command and returns stdout. npm exits 1 when something is outdated, so a failed run with
// stdout still counts as read. Any other failure gives null (unreadable).
function run(cmd, args) {
  try {
    return execFileSync(cmd, args, { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] })
  } catch (err) {
    return typeof err?.stdout === 'string' && err.stdout.trim() ? err.stdout : null
  }
}

async function getText(url) {
  try {
    const res = await fetch(url)
    return res.ok ? await res.text() : null
  } catch {
    return null
  }
}

// The real fetchers. Each returns the parsed value, or null when it could not be read.
export function liveFetchers(root = process.cwd(), speedFile = '') {
  const pkg = JSON.parse(readFileSync(`${root}/package.json`, 'utf8'))
  const pinOf = (name) => (pkg.dependencies?.[name] || pkg.devDependencies?.[name] || '').replace(/^[\^~]/, '')
  return {
    // A missing or unreadable speed.json is unreadable, never "no speed flags".
    speed: async () => {
      if (!speedFile || !existsSync(speedFile)) return null
      try {
        return speedFacts(JSON.parse(readFileSync(speedFile, 'utf8')))
      } catch {
        return null
      }
    },
    outdated: async () => parseOutdated(run('npm', ['outdated', '--json'])),
    audit: async () => parseAudit(run('npm', ['audit', '--json'])),
    pins: async () => {
      const out = {}
      for (const name of PINNED_PACKAGES) {
        const latest = parseNpmVersion(run('npm', ['view', name, 'version']))
        if (!latest) return null
        out[name] = { pinned: pinOf(name), latest }
      }
      return out
    },
    telegramApi: async () => parseTelegramApi(await getText(TELEGRAM_API_PAGE)),
    node: async () => {
      const lts = parseNodeLts(await getText(NODE_INDEX))
      const dir = `${root}/.github/workflows`
      const files = existsSync(dir)
        ? readdirSync(dir).filter((f) => f.endsWith('.yml')).map((f) => ({ name: f, text: readFileSync(`${dir}/${f}`, 'utf8') }))
        : []
      const workflow = parseWorkflowNodeVersions(files)
      return lts && workflow.length ? { workflow, lts } : null
    },
    matrixStale: async () => {
      const out = run('node', [`${root}/tests/eval/client-matrix.mjs`, '--stale'])
      const m = out && /^(\d+) stale rows/m.exec(out)
      return m ? Number(m[1]) : null
    },
  }
}

// Collects every source; the fetchers are a parameter so the tests run offline.
export async function collectSignals(fetchers) {
  const current = {}
  for (const [key, fetchOne] of Object.entries(fetchers)) {
    try {
      current[key] = (await fetchOne()) ?? null
    } catch {
      current[key] = null
    }
  }
  return current
}

function utcDate(now = new Date()) {
  return now.toISOString().slice(0, 10)
}

function writeOutputs(outputs) {
  const lines = Object.entries(outputs).map(([k, v]) => `${k}=${v}`).join('\n') + '\n'
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, lines)
  else console.log(`(no GITHUB_OUTPUT) ${lines.trim()}`)
}

async function planMain(env) {
  const current = await collectSignals(liveFetchers(process.cwd(), env.SPEED_FILE || ''))
  const lastBody = env.LAST_BODY_FILE && existsSync(env.LAST_BODY_FILE) ? readFileSync(env.LAST_BODY_FILE, 'utf8') : ''
  const template = existsSync(env.TEMPLATE || TEMPLATE) ? readFileSync(env.TEMPLATE || TEMPLATE, 'utf8') : ''
  const speedMd = env.SPEED_MD && existsSync(env.SPEED_MD) ? readFileSync(env.SPEED_MD, 'utf8') : ''
  const plan = planWeeklyReview({
    current,
    lastBody,
    openWeekly: Number(env.OPEN_WEEKLY || 0),
    lastCreatedAt: env.LAST_CREATED_AT || '',
    date: utcDate(),
    template,
    speedMd,
  })
  console.log(plan.message)
  if (plan.action === 'create') {
    if (env.BODY_FILE) writeFileSync(env.BODY_FILE, plan.body)
    console.log(plan.body)
  }
  if (env.DRY_RUN === 'true') console.log(`dry run: would ${plan.action === 'create' ? 'open one issue' : plan.action}; nothing written`)
  writeOutputs({ action: plan.action, title: plan.title || '' })
}

async function notifyMain(env) {
  const message = buildMessage('weekly-started', { title: env.ISSUE_TITLE || '', url: env.ISSUE_URL || '' })
  await notify({ token: env.TELEGRAM_BOT_TOKEN || '', chatId: env.TELEGRAM_CHAT_ID || '', ...message })
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const mode = process.argv[2] || 'plan'
  const job = mode === 'notify' ? notifyMain(process.env) : planMain(process.env)
  // A planning error fails the job (someone must look). A Telegram error never does.
  job.catch((err) => {
    console.log(`weekly-review failed: ${err?.name || 'error'}`)
    if (mode !== 'notify') process.exitCode = 1
  })
}
