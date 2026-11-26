// Central metrics M5 (#451): the admin metrics summary and the events list, in plain lines for an agent.
// One function builds every line, so the REST answer and the tool text say the same words. Reads only.
// Request numbers come from view.js (metrics_hourly), never from ops_events (plan section 9, D1 and D2).
import { query } from '../db.js'
import { HttpError } from '../http.js'
import { SOURCES, fullName } from '../ops/sources.js'
import { dbSizeBytes } from './daily.js'
import { metricsView } from './view.js'

const HOUR = 60 * 60 * 1000
const WINDOWS = { '24h': [24 * HOUR, 'last 24 hours'], '7d': [7 * 24 * HOUR, 'last 7 days'] }
const STALE_MS = 7 * HOUR
const SPEED_LIMIT_MS = 150 * 1000
const DB_LIMIT_BYTES = 1024 ** 3
const EVENT_LIMIT_MAX = 100
const STRING_MAX = 120
const ISO_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,9})?)?(Z|[+-]\d{2}:\d{2})$/

const bad = (message) => new HttpError(400, message)
const utc = (ms) => `${new Date(ms).toISOString().slice(0, 16).replace('T', ' ')} UTC`
const count = (n) => n.toLocaleString('en-US')

/** 3 min 38 s, 22 s or 120 ms. */
function duration(ms) {
  if (ms < 1000) return `${Math.round(ms)} ms`
  const s = Math.round(ms / 1000)
  if (s < 60) return `${s} s`
  return s % 60 ? `${Math.floor(s / 60)} min ${s % 60} s` : `${Math.floor(s / 60)} min`
}

/** Nearest rank: the smallest value that at least `q` of the values are at or below. */
function rank(values, q) {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.ceil(q * sorted.length) - 1]
}

const percent = (part, whole) => (whole === 0 ? null : Math.round((part / whole) * 100))
const listedRepo = (name) => SOURCES.find((repo) => fullName(repo) === name)

/** The query parameters of GET /api/admin/metrics/summary, checked. Anything wrong is 400. */
export function summaryParams(searchParams) {
  const window = searchParams.get('window') ?? '24h'
  if (!Object.hasOwn(WINDOWS, window)) throw bad(`window must be one of ${Object.keys(WINDOWS).join(', ')}.`)
  const repo = searchParams.get('repo') ?? fullName(SOURCES[0])
  if (!listedRepo(repo)) throw bad(`repo must be one of ${SOURCES.map(fullName).join(', ')}.`)
  return { window, repo }
}

function finding(area, text, extra = {}) {
  return { area, text, value: null, unit: null, limit: null, baseline: null, over: false, since: null, count_over: null, link: null, ...extra }
}

function speedFinding(events, base, link) {
  const total = (list) => list.filter((e) => e.kind === 'merge' && e.name === 'total' && e.ms !== null)
  const all = total(events)
  if (all.length === 0) return finding('speed', 'Speed: no merges in this window.', { link })
  // Code and docs-only merges have different limits: each kind is judged against its own, and the worst one is reported.
  const limitOf = (e) => e.attrs?.limit_ms ?? SPEED_LIMIT_MS
  const p90Of = (list) => rank(list.map((e) => e.ms), 0.9)
  const limits = [...new Set(all.map(limitOf))]
  const limit = limits.sort((a, b) => p90Of(all.filter((e) => limitOf(e) === b)) / b - p90Of(all.filter((e) => limitOf(e) === a)) / a)[0]
  const rows = all.filter((e) => limitOf(e) === limit)
  const value = p90Of(rows)
  const baseValue = p90Of(total(base).filter((e) => limitOf(e) === limit))
  const over = value > limit
  const overs = rows.filter((e) => e.status === 'over')
  const since = over && overs.length ? overs[0].at : null
  let text = `Speed: 1 in 10 ${limit < SPEED_LIMIT_MS ? 'docs-only ' : ''}merges took ${duration(value)} or more from push to tested production. Limit ${duration(limit)}.`
  text += baseValue === null ? ' Last week: no data.' : ` Last week ${duration(baseValue)}.`
  if (since !== null) text += ` Over since ${utc(since)} (${overs.length} ${overs.length === 1 ? 'merge' : 'merges'}).`
  return finding('speed', text, {
    value: Math.round(value / 1000), unit: 's', limit: Math.round(limit / 1000),
    baseline: baseValue === null ? null : Math.round(baseValue / 1000),
    over, since: since === null ? null : new Date(since).toISOString(), count_over: since === null ? null : overs.length, link
  })
}

function ciFinding(events, base, repo) {
  const runs = events.filter((e) => e.kind === 'run')
  const baseRuns = base.filter((e) => e.kind === 'run')
  const link = `https://github.com/${repo}/actions`
  if (runs.length === 0) return finding('ci', 'CI checks: no runs in this window.', { link })
  const failed = runs.filter((e) => e.status !== 'success')
  const pct = percent(failed.length, runs.length)
  const basePct = percent(baseRuns.filter((e) => e.status !== 'success').length, baseRuns.length)
  let text = `CI checks: ${runs.length} runs, ${failed.length} failed (${pct} %). Last week ${basePct === null ? 'no data' : `${basePct} %`}.`
  const last = failed[failed.length - 1]
  if (last) {
    const groups = new Map()
    for (const e of failed) {
      const key = e.attrs?.failed_step ? `${e.name}, step "${e.attrs.failed_step}"` : e.name
      groups.set(key, (groups.get(key) ?? 0) + 1)
    }
    const [top, n] = [...groups].sort((a, b) => b[1] - a[1])[0]
    text += ` Most failures: ${top} (${n}).`
    if (last.link) text += ` Last failure: ${last.link}`
  }
  return finding('ci', text, { value: pct, unit: '%', baseline: basePct, link: last?.link ?? link })
}

function deployFinding(events, base, repo) {
  const prod = (list) => list.filter((e) => e.kind === 'deploy' && e.name === 'Production')
  const rows = prod(events)
  const link = `https://github.com/${repo}/deployments`
  if (rows.length === 0) return finding('deploys', 'Deploys: none to production in this window.', { link })
  const failed = rows.filter((e) => e.status !== 'success').length
  // Only successful deploys went live: a failed one must not lower the time to live.
  const timed = (list) => list.filter((e) => e.status === 'success' && e.ms !== null).map((e) => e.ms)
  const median = rank(timed(rows), 0.5)
  const baseMedian = rank(timed(prod(base)), 0.5)
  let text = `Deploys: ${rows.length} to production, ${failed === 0 ? 'none failed' : `${failed} failed`}.`
  if (median !== null) text += ` Median ${duration(median)} from deploy start to live. Last week ${baseMedian === null ? 'no data' : duration(baseMedian)}.`
  return finding('deploys', text, {
    value: median === null ? null : Math.round(median / 1000), unit: 's',
    baseline: baseMedian === null ? null : Math.round(baseMedian / 1000), link
  })
}

// The Production line is view.js: the window as the admin metrics route reads it, and the 7 days before it.
async function productionFinding(windowName, now, windowMs) {
  const params = { window: windowName, by: 'total', route: null }
  // Hourly rows are kept 14 days and then rolled into whole days. A baseline that reaches that edge would count hours
  // outside itself, so past 13 days back there is no last-week value, rather than a wrong one.
  const exact = windowMs + 7 * 24 * HOUR <= 13 * 24 * HOUR
  const [view, before] = await Promise.all([
    metricsView(params, now),
    exact ? metricsView({ ...params, window: '7d' }, now - windowMs - 1) : { metrics: [] }
  ])
  const current = view.metrics[0]
  const link = '/admin/metrics'
  if (!current) return finding('production', 'Production: no requests in this window.', { link })
  let text = `Production: ${count(current.count)} requests, ${count(current.errors['5xx'])} server ${current.errors['5xx'] === 1 ? 'error' : 'errors'}.`
  const baseP95 = before.metrics[0]?.p95 ?? null
  if (current.p95 === null) text += ' Slowest 5 %: too few requests to say.'
  else text += ` Slowest 5 %: ${duration(current.p95)} or more. Last week ${baseP95 === null ? 'no data' : duration(baseP95)}.`
  return finding('production', text, { value: current.p95, unit: 'ms', baseline: baseP95, link })
}

async function databaseFinding() {
  const bytes = await dbSizeBytes()
  const text = `Database: ${count(Math.round(bytes / 1024 ** 2))} MB of 1 GB (${percent(bytes, DB_LIMIT_BYTES)} %).`
  return finding('database', text, { value: bytes, unit: 'bytes', limit: DB_LIMIT_BYTES, over: bytes > DB_LIMIT_BYTES, link: '/admin/metrics' })
}

/** GET /api/admin/metrics/summary. Plain lines in `text`; the same facts as data in `findings`. */
export async function summaryView({ window, repo }, now = Date.now()) {
  const [windowMs, label] = WINDOWS[window]
  const from = now - windowMs
  const repoId = String(listedRepo(repo).repository_id)
  const { rows } = await query(
    `select source, kind, name, status, ms, attrs, link, at from ops_events
     where repo_id = $1 and at >= $2::timestamptz and at < $3::timestamptz
       and ((source = 'speed' and kind = 'merge') or (source = 'ci' and kind = 'run') or (source = 'deploy' and kind = 'deploy'))
     order by at`,
    [repoId, new Date(from - 7 * 24 * HOUR).toISOString(), new Date(now).toISOString()]
  )
  const all = rows.map((row) => ({ ...row, at: new Date(row.at).getTime(), ms: row.ms === null ? null : Number(row.ms) }))
  const part = (source, inWindow) => all.filter((e) => e.source === source && (e.at >= from) === inWindow)
  // Only delivery sources: a production error must not hide a collector that has stopped.
  const last = (await query("select max(at) as at from ops_events where repo_id = $1 and source <> 'prod'", [repoId])).rows[0].at
  const eventsUntil = last === null ? null : new Date(last).getTime()
  const findings = [
    speedFinding(part('speed', true), part('speed', false), `https://github.com/${repo}/actions/workflows/speed-metrics.yml`),
    ciFinding(part('ci', true), part('ci', false), repo),
    deployFinding(part('deploy', true), part('deploy', false), repo),
    await productionFinding(window, now, windowMs),
    await databaseFinding()
  ]
  const lines = []
  const runLink = `https://github.com/${repo}/actions/workflows/metrics-daily.yml`
  if (eventsUntil === null) lines.push(`No delivery events yet. Run ${runLink} by hand.`)
  else if (now - eventsUntil > STALE_MS) lines.push(`Delivery events are old: the last one is from ${utc(eventsUntil)}. Run ${runLink} by hand.`)
  lines.push(`Metrics summary for ${repo}, ${label}, as of ${utc(now)}${eventsUntil === null ? '' : ` (events up to ${utc(eventsUntil)})`}.`)
  for (const f of findings) lines.push(`- ${f.text}`)
  lines.push(findings.some((f) => f.over) ? 'Nothing else is over its limit.' : 'Nothing is over its limit.')
  return {
    text: lines.join('\n'),
    as_of: new Date(now).toISOString(),
    events_until: eventsUntil === null ? null : new Date(eventsUntil).toISOString(),
    window,
    repo,
    findings
  }
}

function textParam(searchParams, key) {
  const value = searchParams.get(key)
  if (value === null) return null
  if (value === '' || Array.from(value).length > STRING_MAX) throw bad(`${key} must be 1 to ${STRING_MAX} characters.`)
  return value
}

/** The query parameters of GET /api/admin/metrics/events, checked. Anything wrong is 400. */
export function eventsParams(searchParams) {
  const params = {}
  for (const key of ['source', 'kind', 'status', 'name']) params[key] = textParam(searchParams, key)
  const since = searchParams.get('since')
  if (since !== null && (!ISO_TIME.test(since) || Number.isNaN(Date.parse(since)))) throw bad('since must be an ISO time, for example 2026-11-26T06:00:00Z.')
  params.since = since === null ? null : new Date(since).toISOString()
  const limit = searchParams.get('limit')
  if (limit !== null && (!/^\d{1,3}$/.test(limit) || Number(limit) < 1 || Number(limit) > EVENT_LIMIT_MAX)) throw bad(`limit must be 1 to ${EVENT_LIMIT_MAX}.`)
  params.limit = limit === null ? 50 : Number(limit)
  return params
}

/** GET /api/admin/metrics/events: newest first, at most 100, with the link to the run, merge or deploy. */
export async function eventsView(params, now = Date.now()) {
  const where = []
  const values = []
  for (const key of ['source', 'kind', 'status', 'name']) {
    if (params[key] === null) continue
    values.push(params[key])
    where.push(`${key} = $${values.length}`)
  }
  if (params.since !== null) {
    values.push(params.since)
    where.push(`at >= $${values.length}::timestamptz`)
  }
  values.push(params.limit)
  const { rows } = await query(
    `select source, kind, id, name, status, ms, attrs, link, at from ops_events
     ${where.length ? `where ${where.join(' and ')}` : ''} order by at desc limit $${values.length}`,
    values
  )
  const events = rows.map((row) => ({
    at: new Date(row.at).toISOString(), source: row.source, kind: row.kind, id: row.id, name: row.name, status: row.status,
    ms: row.ms === null ? null : Number(row.ms), attrs: row.attrs, link: row.link
  }))
  const lines = events.map(
    (e) => `${utc(Date.parse(e.at))} ${e.source}/${e.kind} ${e.name} ${e.status}${e.ms === null ? '' : ` ${duration(e.ms)}`}${e.link ? ` ${e.link}` : ''}`
  )
  return { text: events.length ? lines.join('\n') : 'No events match.', as_of: new Date(now).toISOString(), count: events.length, events }
}
