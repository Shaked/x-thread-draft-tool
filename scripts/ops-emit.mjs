#!/usr/bin/env node
// Central metrics plan M3 (#439, task #449). Collects ops events from the GitHub API and posts them to
// POST /api/ops/events (M2). Run by .github/workflows/metrics-daily.yml. Node 20: node: modules and
// scripts/speed-metrics.mjs (imported, not copied), plus the pure server/ops/sources.js.
//
// Per listed repo (server/ops/sources.js):
//   1. an empty batch, to read the stored cursor;
//   2. the CI runs created since the start of the UTC day WINDOW_DAYS ago, one page at a time. The list
//      gives each run's latest attempt; the unique key (run id and attempt) keeps each attempt once, so a
//      re-run that starts later is stored too (the window is the re-run limit: 3 days, see docs/operations);
//      The list is read one UTC day at a time; a day with fewer distinct runs than its total_count is incomplete.
//   3. merges (git), the deployments of those merges (deploy) and, for `speed: true` repos, the speed stages
//      of each merge (speed-metrics.mjs measurePull and LIMITS). Speed rows wait SPEED_SETTLE_MS (2 hours) after
//      the merge and until every run on the merge's head and merge commit has finished; until then none is written;
//   4. counters for each finished UTC day of the window: runs that are not stored events (skipped,
//      cancelled, unlisted, and stuck: running for over 24 hours), a zero row for an empty day. A day's rows are
//      replaced whole, so they are sent only when the listing and the CI events completed (`countable`).
// Stops cleanly once fewer than RATE_FLOOR API calls remain (x-ratelimit-remaining of the last answer). It posts the events it has; counters and cursor are sent only when `countable`;
// a stop among the merges keeps them: they depend only on the listing and the CI events.
// The next run repeats the window.
//
// Flags: --dry-run --repo <owner/name>   print the batches (sorted JSON) and send nothing.
// Env:   GITHUB_TOKEN (reads only), ACTIONS_ID_TOKEN_REQUEST_URL and ACTIONS_ID_TOKEN_REQUEST_TOKEN (the
//        OIDC token for the ops-events audience), OPS_BASE_URL (default: production). No token is printed.

import { pathToFileURL } from 'node:url'
import { SOURCES, fullName } from '../server/ops/sources.js'
import { githubApi, measurePull, LIMITS, stableJson, CI_WORKFLOWS, SMOKE_WORKFLOW } from './speed-metrics.mjs'

export const WINDOW_DAYS = 3
export const RATE_FLOOR = 100
export const BATCH_MAX = 500
export const CURSOR_MAX_BEHIND_MS = 24 * 60 * 60 * 1000
export const OPS_AUDIENCE = 'x-thread-draft-tool-ops-events-production'
export const OPS_BASE_URL_DEFAULT = 'https://x-thread-draft-tool.vercel.app'
const DAY_MS = 24 * 60 * 60 * 1000
const CI_RESULTS = ['success', 'failure', 'timed_out']
const DEPLOY_ENVS = ['Production', 'Preview']

const utcDay = (ms) => new Date(ms).toISOString().slice(0, 10)
const utcDayStart = (ms) => Date.parse(`${utcDay(ms)}T00:00:00Z`)
// The ingest contract (server/ops/events.js cleanMs) refuses a duration above 2^31 - 1 ms: send null instead.
const MAX_MS = 2147483647
const millis = (from, to) => {
  const n = Math.round(Date.parse(to) - Date.parse(from))
  return Number.isFinite(n) && n <= MAX_MS ? Math.max(0, n) : null
}

export function parseArgs(argv) {
  const opts = { dryRun: false, repo: null }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--dry-run') opts.dryRun = true
    else if (arg === '--repo') opts.repo = argv[++i] ?? null
    else throw new Error(`ops-emit: unknown option ${arg}`)
  }
  if (opts.dryRun && !opts.repo) throw new Error('ops-emit: --dry-run needs --repo <owner/name>')
  return opts
}

/** Thrown before a request that would go below the rate floor. collectRepo keeps the events it has and stops. */
export class RateFloor extends Error {}

/**
 * Wraps fetch and keeps the rate-limit header of the last answer. budget.low() is true when fewer than
 * RATE_FLOOR calls remain. Before the first answer the remaining count is unknown, so not low. Every
 * request checks it, so no merge can spend the reserve between two checks.
 */
export function countedFetch(fetchImpl) {
  const budget = { calls: 0, remaining: null, low: () => budget.remaining !== null && budget.remaining < RATE_FLOOR }
  const fetchCounted = async (url, init) => {
    if (budget.low()) throw new RateFloor('rate floor reached')
    budget.calls += 1
    const res = await fetchImpl(url, init)
    const left = res?.headers?.get?.('x-ratelimit-remaining')
    if (left !== null && left !== undefined && left !== '' && Number.isFinite(Number(left))) budget.remaining = Number(left)
    return res
  }
  return { fetch: fetchCounted, budget }
}

/** GET of one REST path of the repo, for the lists githubApi() does not have. Errors carry status and path only. */
export function restGet({ fetchImpl, repo, token }) {
  return async (path) => {
    const res = await fetchImpl(`https://api.github.com/repos/${repo}${path}`, {
      headers: { accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28', authorization: `Bearer ${token}` }
    })
    if (!res.ok) throw new Error(`GitHub API ${res.status} for ${path.split('?')[0]}`)
    return res.json()
  }
}

const isStored = (run, repo) =>
  run.status === 'completed' && repo.workflows.includes(run.name) && CI_RESULTS.includes(run.conclusion)

/** The CI event of one stored run (latest attempt). `failed` is { job, step } or null. */
export function ciEvent(run, repo, failed) {
  const attrs = { event: run.event, queue_ms: millis(run.created_at, run.run_started_at), pr: run.pull_requests?.[0]?.number }
  if (failed) {
    attrs.failed_job = failed.job
    if (failed.step) attrs.failed_step = failed.step
  }
  return {
    source: 'ci',
    kind: 'run',
    id: `${run.id}.${run.run_attempt}`,
    at: run.run_started_at,
    name: run.name,
    status: run.conclusion,
    ms: millis(run.run_started_at, run.updated_at),
    attrs: Object.fromEntries(Object.entries(attrs).filter(([, v]) => v !== undefined && v !== null)),
    link: run.html_url
  }
}

/** Counter rows of the finished UTC days in the window: the runs that are not stored events. */
export function counterRows(runs, repo, now) {
  const today = utcDay(now)
  const stuckBefore = now - CURSOR_MAX_BEHIND_MS
  const counts = new Map()
  for (const run of runs) {
    const day = run.created_at.slice(0, 10)
    if (day >= today) continue
    if (isStored(run, repo)) continue
    if (run.status !== 'completed' && Date.parse(run.created_at) >= stuckBefore) continue // still going: counted when done
    const name = repo.workflows.includes(run.name) ? run.name : 'other'
    const status = run.status === 'completed' ? (run.conclusion ?? 'unknown') : 'stuck'
    const key = [day, name, status].join('\u0001')
    counts.set(key, { day, source: 'ci', kind: 'run', name, status, count: (counts.get(key)?.count ?? 0) + 1 })
  }
  return [...counts.values()]
}

/**
 * The cursor: the creation time of the oldest run still going, else of the newest stored run. Never more
 * than CURSOR_MAX_BEHIND_MS behind the newest stored run (a stuck run must not pin it).
 */
export function cursorFor(runs, repo) {
  const stored = runs.filter((r) => isStored(r, repo)).map((r) => Date.parse(r.created_at))
  if (stored.length === 0) return null
  const newest = Math.max(...stored)
  const going = runs.filter((r) => r.status !== 'completed').map((r) => Date.parse(r.created_at))
  const at = going.length ? Math.min(...going) : newest
  return new Date(Math.max(at, newest - CURSOR_MAX_BEHIND_MS)).toISOString()
}

/** Speed rows of one measured merge: one per stage with a time (merge_wait has no limit). */
export function speedEvents(record, link) {
  const seconds = {
    ci: record.stages.ci?.running,
    merge_wait: record.stages.merge?.wait,
    vercel: record.stages.vercel?.running,
    smoke: record.stages.smoke?.running,
    total: record.total
  }
  const rows = []
  for (const [stage, sec] of Object.entries(seconds)) {
    if (sec === null || sec === undefined) continue
    const limit = LIMITS[record.kind]?.[stage]
    const attrs = { pr: record.number }
    let status = 'ok'
    if (limit !== undefined) {
      attrs.limit_ms = limit * 1000
      status = sec > limit ? 'over' : 'ok'
    }
    rows.push({
      source: 'speed',
      kind: 'merge',
      id: `${record.merge_sha}:${stage}`,
      at: record.merged_at,
      name: stage,
      status,
      ms: sec * 1000,
      attrs,
      link
    })
  }
  return rows
}

/**
 * Lists the runs created on each UTC day from `since` to `today`, one day at a time (a day is far below any
 * list cap). Runs are de-duplicated by id: a run can move onto another page while the pages are read.
 * complete is false when a day stops early or answers fewer distinct runs than its total_count. An
 * incomplete listing only delays counters and the cursor; it never sends a wrong count.
 */
async function listWindowRuns(get, budget, since, today) {
  const byId = new Map()
  for (let ms = Date.parse(`${since}T00:00:00Z`); utcDay(ms) <= today; ms += DAY_MS) {
    const day = utcDay(ms)
    const dayIds = new Set()
    let total = null
    let complete = false
    for (let page = 1; page <= 50 && !complete; page++) {
      if (budget.low()) return { runs: [...byId.values()], complete: false }
      const body = await get(`/actions/runs?created=${encodeURIComponent(`${day}..${day}`)}&per_page=100&page=${page}`)
      total = typeof body.total_count === 'number' ? body.total_count : total
      const list = body.workflow_runs ?? []
      for (const run of list) byId.set(run.id, run)
      for (const run of list) dayIds.add(run.id)
      if (list.length < 100) complete = true
    }
    // Distinct runs of the day against its total: fewer means a run is missing (a duplicate hides nothing).
    if (!complete || (total !== null && dayIds.size < total)) return { runs: [...byId.values()], complete: false }
  }
  return { runs: [...byId.values()], complete: true }
}
/** One event per stored run. A failed run costs one jobs call, for its failed job and step. Pushes into `events`. */
async function ciEvents(api, budget, repo, runs, events) {
  for (const run of runs) {
    if (!isStored(run, repo)) continue
    if (budget.low()) return false
    let failed = null
    if (run.conclusion === 'failure') {
      const job = (await api.jobsForRun(run.id)).find((j) => j.conclusion === 'failure')
      if (job) failed = { job: job.name, step: (job.steps ?? []).find((s) => s.conclusion === 'failure')?.name ?? null }
    }
    events.push(ciEvent(run, repo, failed))
  }
  return true
}

/** The git merge event of a merged pull request. */
function gitEvent(pr, full) {
  return {
    source: 'git',
    kind: 'merge',
    id: pr.merge_commit_sha,
    at: pr.merged_at,
    name: 'main',
    status: 'merged',
    ms: millis(pr.created_at, pr.merged_at),
    attrs: { pr: pr.number },
    link: `https://github.com/${full}/pull/${pr.number}`
  }
}

/**
 * The deploy events of a merge: each Production or Preview deployment, with its newest success or failure in
 * the status history. The current state is not used: GitHub marks a superseded successful deployment `inactive`
 * (auto_inactive), and that must not hide it.
 */
async function deployEvents(api, pr, full) {
  const events = []
  for (const dep of await api.deploymentsForSha(pr.merge_commit_sha)) {
    if (!DEPLOY_ENVS.includes(dep.environment)) continue
    const terminal = (await api.deploymentStatuses(dep.id))
      .filter((s) => s.state === 'success' || s.state === 'failure')
      .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))[0]
    if (!terminal) continue
    events.push({
      source: 'deploy',
      kind: 'deploy',
      id: String(dep.id),
      at: dep.created_at,
      name: dep.environment,
      status: terminal.state,
      ms: millis(dep.created_at, terminal.created_at),
      attrs: { sha: dep.sha },
      link: `https://github.com/${full}/commit/${dep.sha}`
    })
  }
  return events
}

/** A merge's speed stages are measured only SPEED_SETTLE_MS after it merged, and only when every run on its head and merge commit is finished. */
export const SPEED_SETTLE_MS = 2 * 60 * 60 * 1000

/**
 * Speed rows are written only once the merge's runs have finished: a stage measured while a run is still going
 * is partial, and ingest never updates a stored row. The runs are read fresh here (the window listing is older
 * than the measurements), and a code merge needs its smoke run.
 */
async function speedRowsFor(api, repo, pr, now, full) {
  if (now - Date.parse(pr.merged_at) < SPEED_SETTLE_MS) return []
  // Only the runs that measurePull reads count: the collector's own run on the same commit must not hold a merge back.
  const measured = new Set([...CI_WORKFLOWS, SMOKE_WORKFLOW])
  const runs = [...(await api.runsForSha(pr.head.sha)), ...(await api.runsForSha(pr.merge_commit_sha))]
  if (runs.some((r) => measured.has(r.name) && r.status !== 'completed')) return []
  const record = await measurePull(pr, api)
  if (record.kind !== 'docs' && !record.stages.smoke) return []
  return speedEvents(record, `https://github.com/${full}/pull/${pr.number}`)
}

/** Git, deploy and (speed repos) speed events of the merges since the window start. Pushes into `events`. */
async function mergeEvents(api, budget, repo, now, events) {
  const full = fullName(repo)
  const pulls = (await api.recentMergedPulls({ sinceMs: utcDayStart(now - WINDOW_DAYS * DAY_MS) })).filter((pr) => pr.base?.ref === 'main')
  for (const pr of pulls) {
    if (budget.low()) return false
    events.push(gitEvent(pr, full))
    events.push(...(await deployEvents(api, pr, full)))
    if (repo.speed) events.push(...(await speedRowsFor(api, repo, pr, now, full)))
  }
  return true
}

/** Drops a second row with the same key, and sorts the rest by key, so the same answers give the same batch. */
function uniqueSorted(events) {
  const seen = new Set()
  return events
    .filter((e) => {
      const key = `${e.source}/${e.kind}/${e.id}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    .sort((a, b) => `${a.source}/${a.kind}/${a.id}`.localeCompare(`${b.source}/${b.kind}/${b.id}`))
}

/**
 * Every finished day of the window gets a counter row, a zero one when it has none. Ingest replaces a day's
 * rows only when the day is in the batch, so an empty day must be sent to clear the counts it had before.
 */
export function withEmptyDays(counters, since, now) {
  const today = utcDay(now)
  const have = new Set(counters.map((c) => c.day))
  const out = [...counters]
  for (let ms = Date.parse(`${since}T00:00:00Z`); utcDay(ms) < today; ms += DAY_MS) {
    const day = utcDay(ms)
    if (!have.has(day)) out.push({ day, source: 'ci', kind: 'run', name: 'none', status: 'none', count: 0 })
  }
  return out
}

/**
 * The events and counters of one listed repo. `api` is githubApi(), `get` is restGet(), `budget` is countedFetch's.
 * `countable` is true when the run listing and the CI events completed: counters and cursor depend only on
 * those, so a later stop among the merges does not stop them. `complete` is true when everything did. A
 * RateFloor thrown by any request stops the collection; the events gathered so far are kept.
 */
export async function collectRepo(repo, { api, get, budget, now }) {
  const since = new Date(utcDayStart(now - WINDOW_DAYS * DAY_MS)).toISOString().slice(0, 10)
  const events = []
  let runs = []
  let countable = false
  let complete = false
  try {
    const listed = await listWindowRuns(get, budget, since, utcDay(now))
    runs = listed.runs
    countable = listed.complete && (await ciEvents(api, budget, repo, runs, events))
    complete = countable && (await mergeEvents(api, budget, repo, now, events))
  } catch (err) {
    if (!(err instanceof RateFloor)) throw err
  }
  return {
    events: uniqueSorted(events),
    complete,
    countable,
    counters: countable ? withEmptyDays(counterRows(runs, repo, now), since, now) : [],
    cursor: countable ? cursorFor(runs, repo) : null,
    calls: budget.calls,
    remaining: budget.remaining
  }
}

/** The request bodies for one repo: events in chunks of BATCH_MAX; counters and cursor only on the last, and only when complete. */
export function batchesFor(repoId, result) {
  const chunks = []
  for (let i = 0; i < result.events.length; i += BATCH_MAX) chunks.push(result.events.slice(i, i + BATCH_MAX))
  if (chunks.length === 0) chunks.push([])
  return chunks.map((events, index) => {
    const body = { v: 1, repo_id: repoId, events }
    if (index === chunks.length - 1) {
      if (result.countable && result.counters.length) body.counters = result.counters
      if (result.countable && result.cursor) body.cursor = result.cursor
    }
    return body
  })
}

async function oidcToken(env, fetchImpl) {
  const res = await fetchImpl(`${env.ACTIONS_ID_TOKEN_REQUEST_URL}&audience=${encodeURIComponent(OPS_AUDIENCE)}`, {
    headers: { authorization: `bearer ${env.ACTIONS_ID_TOKEN_REQUEST_TOKEN}` }
  })
  if (!res.ok) throw new Error(`OIDC token request failed: HTTP ${res.status}`)
  const { value } = await res.json()
  if (!value) throw new Error('OIDC token request answered no token')
  return value
}

/**
 * One POST with a token requested just before it: the route accepts a token up to 5 minutes old, and a
 * collection can run longer than that, so no token is reused across requests.
 */
async function post(url, body, env, fetchImpl) {
  const token = await oidcToken(env, fetchImpl)
  const res = await fetchImpl(url, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(body)
  })
  if (!res.ok) throw new Error(`ops events refused: HTTP ${res.status}`)
  return res.json()
}

/** Runs the collector for the listed repos (or one, with --repo). deps: now, fetchImpl, log. */
export async function run(argv, env = {}, deps = {}) {
  const opts = parseArgs(argv)
  const now = deps.now ?? Date.now()
  const fetchImpl = deps.fetchImpl ?? fetch
  const log = deps.log ?? console.log
  const repos = SOURCES.filter((r) => !opts.repo || fullName(r) === opts.repo)
  if (repos.length === 0) throw new Error('ops-emit: no listed repo matches --repo')
  const token = env.GITHUB_TOKEN || ''
  const base = (env.OPS_BASE_URL || OPS_BASE_URL_DEFAULT).replace(/\/$/, '')

  for (const repo of repos) {
    const counted = countedFetch(fetchImpl)
    const api = githubApi({ token, repo: fullName(repo), fetchImpl: counted.fetch })
    const get = restGet({ fetchImpl: counted.fetch, repo: fullName(repo), token })
    const result = await collectRepo(repo, { api, get, budget: counted.budget, now })
    const bodies = batchesFor(repo.repository_id, result)
    if (opts.dryRun) {
      log(stableJson(bodies).trimEnd())
      continue
    }
    // The first call reads the stored cursor (an empty batch answers it).
    const before = await post(`${base}/api/ops/events`, { v: 1, repo_id: repo.repository_id, events: [] }, env, fetchImpl)
    let accepted = 0
    let refused = 0
    for (const body of bodies) {
      const answer = await post(`${base}/api/ops/events`, body, env, fetchImpl)
      accepted += answer.accepted
      refused += answer.refused
    }
    log(
      `ops-emit: ${fullName(repo)} events=${result.events.length} counters=${result.counters.length} complete=${result.complete} ` +
        `calls=${result.calls} remaining=${result.remaining ?? 'unknown'} previous_cursor=${before.cursor ?? 'none'} accepted=${accepted} refused=${refused}`
    )
  }
  return { status: 'done' }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run(process.argv.slice(2), process.env).then(
    () => process.exit(0),
    (err) => {
      console.error(`ops-emit failed: ${err?.message || 'error'}`)
      process.exit(1)
    }
  )
}
