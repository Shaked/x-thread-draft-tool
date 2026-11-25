#!/usr/bin/env node
// Speed metrics (epic #273, task S5 = #310, plan docs/plans/speed.md sections 1, 4 and 5).
// Node 20, no dependencies. Reads only the GitHub REST API (GITHUB_TOKEN, GITHUB_REPOSITORY).
//
// Modes:
//   --last <N>      the N most recent merged pull requests (default 50)
//   --since <D>d    every merge of the last D days
//   --merge <sha>   one merge commit: the per-merge check after a production smoke run
// Options:
//   --previous <file>  a speed.json from an earlier run: adds the change per stage
//   --out <dir>        where speed.json and speed.md are written (default speed-metrics)
//
// Stages: (a) CI, (b) merge wait, (c) Vercel, (d) smoke. Running time and queue time are kept apart;
// the queue is reported but is not part of the target. Output is deterministic: keys sorted, whole
// seconds, pull requests sorted by number, no timestamps.
// --merge warns (one ::warning:: per stage over its p90 limit) and never fails for speed.
// --last sends one Telegram line when a stage's p90 is over its limit.

import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { shouldSkip } from './vercel-ignore.mjs'
import { buildMessage, notify } from './notify-telegram.mjs'

export const CI_WORKFLOWS = ['Tests', 'Security', 'CodeQL', 'Net lines']
export const SMOKE_WORKFLOW = 'Smoke test (deployed)'
// p90 limits in seconds (plan section 1). A docs-only change has stage (a) only, so it has ci and total.
export const LIMITS = {
  code: { ci: 90, vercel: 35, smoke: 25, total: 150 },
  docs: { ci: 90, total: 90 },
}
const STAGE_LABEL = { ci: 'CI', merge_wait: 'Merge wait', vercel: 'Vercel', smoke: 'Smoke', total: 'Total' }
const STAT_STAGES = ['ci', 'merge_wait', 'vercel', 'smoke', 'total']

const secs = (from, to) => Math.round((Date.parse(to) - Date.parse(from)) / 1000)
const minDate = (dates) => dates.reduce((a, b) => (Date.parse(b) < Date.parse(a) ? b : a))
const maxDate = (dates) => dates.reduce((a, b) => (Date.parse(b) > Date.parse(a) ? b : a))
const earliest = (items, key = 'created_at') =>
  [...items].sort((a, b) => Date.parse(a[key]) - Date.parse(b[key]) || a.id - b.id)[0] ?? null

// Nearest rank: the value at position ceil(percent/100 × n) of the sorted list, 1-based.
export function nearestRank(values, percent) {
  const s = [...values].sort((a, b) => a - b)
  if (s.length === 0) return null
  return s[Math.ceil((percent * s.length) / 100) - 1]
}

export function median(values) {
  const s = [...values].sort((a, b) => a - b)
  if (s.length === 0) return null
  const mid = s.length >> 1
  return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2)
}

// Sorted keys at every level, so the same input gives the same bytes.
function sortKeys(value) {
  if (Array.isArray(value)) return value.map(sortKeys)
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map((k) => [k, sortKeys(value[k])]))
  return value
}
export const stableJson = (value) => `${JSON.stringify(sortKeys(value), null, 2)}\n`

// Measures one merged pull request. `api` is the client from githubApi() or a test fake.
export async function measurePull(pr, api) {
  const flags = []
  const runs = await api.runsForSha(pr.head.sha)
  const firsts = CI_WORKFLOWS.map((name) => earliest(runs.filter((r) => r.name === name))).filter(Boolean)

  let ci = null
  let ciEnd = null
  if (firsts.some((r) => r.name === 'Tests')) {
    const start = minDate(firsts.map((r) => r.run_started_at))
    ciEnd = maxDate(firsts.map((r) => r.updated_at))
    ci = { running: secs(start, ciEnd), queue: secs(minDate(firsts.map((r) => r.created_at)), start) }
  } else flags.push('missing_ci')

  let merge = null
  if (ciEnd) {
    const raw = secs(ciEnd, pr.merged_at)
    if (raw < 0) flags.push('negative_wait')
    merge = { running: 0, wait: Math.max(0, raw) }
  }

  const files = await api.commitFiles(pr.merge_commit_sha)
  const kind = shouldSkip({ VERCEL_ENV: 'production' }, files) ? 'docs' : 'code'

  let vercel = null
  let smoke = null
  let total = null
  if (kind === 'docs') {
    total = ci ? ci.running : null
  } else {
    const deployments = (await api.deploymentsForSha(pr.merge_commit_sha)).filter((d) => d.environment === 'Production')
    const successes = []
    for (const d of deployments) successes.push(...(await api.deploymentStatuses(d.id)).filter((s) => s.state === 'success'))
    let successAt = null
    if (successes.length) {
      successAt = earliest(successes).created_at
      vercel = { running: secs(pr.merged_at, successAt) }
    } else flags.push('missing_vercel')

    // The production smoke run starts after the deployment's success status. Earlier deployment_status
    // runs (pending, in progress) can be skipped by the workflow's job condition, so they are not it.
    const mergeRuns = await api.runsForSha(pr.merge_commit_sha)
    const run = successAt
      ? earliest(
          mergeRuns.filter(
            (r) =>
              r.name === SMOKE_WORKFLOW &&
              r.event === 'deployment_status' &&
              r.conclusion !== 'skipped' &&
              r.conclusion !== 'cancelled' &&
              Date.parse(r.created_at) >= Date.parse(successAt),
          ),
        )
      : null
    if (run) {
      // run_started_at is the latest attempt's start (a re-run); the wait before it is queue time.
      smoke = { running: secs(run.run_started_at, run.updated_at), queue: secs(run.created_at, run.run_started_at) }
    } else flags.push('missing_smoke')

    if (ci && vercel && smoke) total = ci.running + vercel.running + smoke.running
  }

  return {
    number: pr.number,
    kind,
    merged_at: pr.merged_at,
    head_sha: pr.head.sha,
    merge_sha: pr.merge_commit_sha,
    stages: { ci, merge, vercel, smoke },
    total,
    flags: flags.sort(),
  }
}

export async function measureAll(pulls, api) {
  const records = []
  for (const pr of pulls) records.push(await measurePull(pr, api))
  return records.sort((a, b) => a.number - b.number)
}

// Summary per kind: n, median, nearest-rank p90, the p90 limit and whether the p90 is over it.
export function summarize(records) {
  const out = {}
  for (const kind of ['code', 'docs']) {
    const rs = records.filter((r) => r.kind === kind)
    const pick = (get) => rs.map(get).filter((v) => v !== null && v !== undefined)
    const stat = (values, limit) => {
      const p90 = nearestRank(values, 90)
      return { n: values.length, median: median(values), p90, limit: limit ?? null, over: typeof limit === 'number' && p90 !== null && p90 > limit }
    }
    const lim = LIMITS[kind]
    out[kind] = {
      count: rs.length,
      ci: stat(pick((r) => r.stages.ci?.running), lim.ci),
      merge_wait: stat(pick((r) => r.stages.merge?.wait)),
      vercel: kind === 'code' ? stat(pick((r) => r.stages.vercel?.running), lim.vercel) : null,
      smoke: kind === 'code' ? stat(pick((r) => r.stages.smoke?.running), lim.smoke) : null,
      total: stat(pick((r) => r.total), lim.total),
    }
  }
  return out
}

// Adds the change of the median against an earlier summary. `slower`: at least 20 % and at least 10 s higher.
export function addTrend(summary, previous) {
  const out = {}
  for (const kind of Object.keys(summary)) {
    out[kind] = { count: summary[kind].count }
    for (const stage of STAT_STAGES) {
      const cur = summary[kind][stage]
      const prev = previous?.[kind]?.[stage]
      if (!cur) {
        out[kind][stage] = null
        continue
      }
      let change = null
      if (cur.median !== null && prev?.median !== null && prev?.median !== undefined) {
        const delta = cur.median - prev.median
        change = { delta, slower: prev.median > 0 && delta >= 10 && cur.median >= prev.median * 1.2 }
      }
      out[kind][stage] = { ...cur, change }
    }
  }
  return out
}

// Stages of one merge over their p90 limit (the limit is compared with the value itself).
export function overLimit(record) {
  const lim = LIMITS[record.kind]
  const values = { ci: record.stages.ci?.running, vercel: record.stages.vercel?.running, smoke: record.stages.smoke?.running, total: record.total }
  return Object.keys(lim)
    .filter((stage) => values[stage] !== null && values[stage] !== undefined && values[stage] > lim[stage])
    .map((stage) => ({ stage, value: values[stage], limit: lim[stage] }))
}

// Stage labels over their limit in any kind of a summary.
export function overNames(summary) {
  const names = new Set()
  for (const kind of Object.keys(summary)) for (const stage of STAT_STAGES) if (summary[kind][stage]?.over) names.add(STAGE_LABEL[stage])
  return [...names]
}

const signed = (d) => (d > 0 ? `+${d} s` : d < 0 ? `${d} s` : '0 s')
const cell = (v) => (v === null || v === undefined ? '-' : `${v} s`)

export function renderMarkdown({ mode, summary, prs }) {
  const lines = ['# Speed metrics', '', `Mode: ${mode}. Merged pull requests: ${prs.length}.`, '']
  lines.push('| Kind | Stage | n | Median | p90 | p90 limit | Over | Change |', '|---|---|---|---|---|---|---|---|')
  for (const kind of ['code', 'docs']) {
    for (const stage of STAT_STAGES) {
      const st = summary[kind][stage]
      if (!st) continue
      const kindLabel = kind === 'code' ? 'Product code' : 'Docs-only'
      const change = st.change ? `${signed(st.change.delta)}${st.change.slower ? ' (slower)' : ''}` : '-'
      lines.push(`| ${kindLabel} | ${STAGE_LABEL[stage]} | ${st.n} | ${cell(st.median)} | ${cell(st.p90)} | ${cell(st.limit)} | ${st.over ? 'yes' : 'no'} | ${change} |`)
    }
  }
  lines.push('', '| PR | Kind | CI | Merge wait | Vercel | Smoke | Total | Flags |', '|---|---|---|---|---|---|---|---|')
  for (const pr of prs) {
    const s = pr.stages
    const flags = pr.flags.length ? pr.flags.join(', ') : '-'
    lines.push(`| #${pr.number} | ${pr.kind} | ${cell(s.ci?.running)} | ${cell(s.merge?.wait)} | ${cell(s.vercel?.running)} | ${cell(s.smoke?.running)} | ${cell(pr.total)} | ${flags} |`)
  }
  return `${lines.join('\n')}\n`
}

// The GitHub REST client. Only read calls; the token is never printed. Errors carry the status and path.
export function githubApi({ token, repo, fetchImpl = fetch }) {
  const base = `https://api.github.com/repos/${repo}`
  const headers = { accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28', authorization: `Bearer ${token}` }
  async function get(path) {
    const res = await fetchImpl(`${base}${path}`, { headers })
    if (!res.ok) throw new Error(`GitHub API ${res.status} for ${path.split('?')[0]}`)
    return res.json()
  }
  return {
    // Merged pull requests, newest merge first: the `count` newest, or every one merged since sinceMs.
    // Pages come in updated_at order, and a merge is never later than its last update. So paging stops
    // only when no PR still unseen can merge into the answer: the oldest update on the page is older
    // than the count-th newest merge found so far (count mode), or older than sinceMs (since mode).
    async recentMergedPulls({ count = 0, sinceMs = 0 }) {
      const out = []
      for (let page = 1; page <= 20; page++) {
        const list = await get(`/pulls?state=closed&sort=updated&direction=desc&per_page=100&page=${page}`)
        if (list.length === 0) break
        for (const pr of list) if (pr.merged_at && Date.parse(pr.merged_at) >= sinceMs) out.push(pr)
        const oldestUpdate = Math.min(...list.map((pr) => Date.parse(pr.updated_at)))
        if (list.length < 100) break
        if (count) {
          const merges = out.map((pr) => Date.parse(pr.merged_at)).sort((a, b) => b - a)
          if (merges.length >= count && oldestUpdate < merges[count - 1]) break
        } else if (oldestUpdate < sinceMs) break
      }
      out.sort((a, b) => Date.parse(b.merged_at) - Date.parse(a.merged_at))
      return count ? out.slice(0, count) : out
    },
    async pullForMergeSha(sha) {
      const list = await get(`/commits/${sha}/pulls?per_page=10`)
      return list.find((pr) => pr.merge_commit_sha === sha && pr.merged_at) ?? null
    },
    async runsForSha(sha) {
      return (await get(`/actions/runs?head_sha=${sha}&per_page=100`)).workflow_runs ?? []
    },
    async deploymentsForSha(sha) {
      return get(`/deployments?sha=${sha}&per_page=100`)
    },
    async deploymentStatuses(id) {
      return get(`/deployments/${id}/statuses?per_page=100`)
    },
    // Every page of the commit's file list (100 per page; a merge can list more than 300 files). A renamed
    // file counts under both paths, as scripts/vercel-ignore.mjs does with --no-renames.
    async commitFiles(sha) {
      const names = []
      for (let page = 1; page <= 30; page++) {
        const files = (await get(`/commits/${sha}?per_page=100&page=${page}`)).files ?? []
        for (const f of files) names.push(f.filename, f.previous_filename)
        if (files.length < 100) break
      }
      return names.filter(Boolean)
    },
  }
}

export function parseArgs(argv) {
  const opts = {}
  for (let i = 0; i < argv.length; i += 2) {
    const flag = argv[i]
    const value = argv[i + 1]
    if (!/^--(last|since|merge|previous|out)$/.test(flag) || value === undefined) throw new Error(`bad option: ${flag}`)
    opts[flag.slice(2)] = value
  }
  return opts
}

// The pull requests one run measures, and its mode label. Null when a merge commit has no pull request.
async function pullsFor(opts, client, now) {
  if (opts.merge !== undefined) {
    if (!/^[0-9a-f]{40}$/.test(opts.merge)) throw new Error('--merge needs a full commit sha')
    const pr = await client.pullForMergeSha(opts.merge)
    return pr ? { mode: `merge ${opts.merge.slice(0, 7)}`, pulls: [pr] } : null
  }
  if (opts.since !== undefined) {
    if (!/^[1-9]\d{0,2}d$/.test(opts.since)) throw new Error('--since needs a number of days, such as 7d')
    const days = Number(opts.since.slice(0, -1))
    return { mode: `since ${days}d`, pulls: await client.recentMergedPulls({ sinceMs: now - days * 86400000 }) }
  }
  const n = Number(opts.last ?? '50')
  if (!Number.isInteger(n) || n < 1 || n > 200) throw new Error('--last needs a whole number from 1 to 200')
  return { mode: `last ${n}`, pulls: await client.recentMergedPulls({ count: n }) }
}

// A per-merge run warns in the log for each stage over its limit. A manual run sends one Telegram line.
async function alert(opts, prs, summary, env, { log, notifyImpl }) {
  if (opts.merge !== undefined) {
    for (const pr of prs) {
      for (const o of overLimit(pr)) {
        log(`::warning title=Speed budget::#${pr.number} ${STAGE_LABEL[o.stage]} ${o.value} s is over the limit of ${o.limit} s`)
      }
    }
    return
  }
  const over = overNames(summary)
  if (over.length === 0) return
  const runUrl = `${env.GITHUB_SERVER_URL || 'https://github.com'}/${env.GITHUB_REPOSITORY || ''}/actions/runs/${env.GITHUB_RUN_ID || ''}`
  const message = buildMessage('speed', { title: `p90 over the limit: ${over.join(', ')}`, url: runUrl })
  await notifyImpl({ token: env.TELEGRAM_BOT_TOKEN || '', chatId: env.TELEGRAM_CHAT_ID || '', ...message, log })
}

// Writes speed.json and speed.md, and the markdown to the job summary when GitHub gives one.
function writeOutputs(doc, out, env) {
  mkdirSync(out, { recursive: true })
  writeFileSync(join(out, 'speed.json'), stableJson(doc))
  const md = renderMarkdown(doc)
  writeFileSync(join(out, 'speed.md'), md)
  if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, md)
}

// Runs one measurement. Returns { status: 'done' | 'skipped', summary }.
export async function run(argv, env = {}, deps = {}) {
  const { now = Date.now(), log = console.log, notifyImpl = notify } = deps
  const opts = parseArgs(argv)
  const client = deps.api ?? githubApi({ token: env.GITHUB_TOKEN || '', repo: env.GITHUB_REPOSITORY || '' })
  const found = await pullsFor(opts, client, now)
  if (!found) {
    log('speed: skipped, no merged pull request has this commit as its merge commit')
    return { status: 'skipped' }
  }
  const prs = await measureAll(found.pulls, client)
  // A per-merge check only means something for a production merge (it has a Vercel stage).
  if (opts.merge !== undefined && (prs[0].kind !== 'code' || !prs[0].stages.vercel)) {
    log('speed: skipped, this merge has no Production deployment (docs-only or not deployed)')
    return { status: 'skipped' }
  }
  const previous = opts.previous ? JSON.parse(readFileSync(opts.previous, 'utf8')).summary : null
  const summary = addTrend(summarize(prs), previous)
  writeOutputs({ mode: found.mode, limits: LIMITS, summary, prs }, opts.out ?? 'speed-metrics', env)
  await alert(opts, prs, summary, env, { log, notifyImpl })
  log(`speed: ${found.mode}, ${prs.length} merged pull requests, written to ${opts.out ?? 'speed-metrics'}`)
  return { status: 'done', summary }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run(process.argv.slice(2), process.env).then(
    () => process.exit(0),
    (err) => {
      console.error(`speed-metrics failed: ${err?.message || 'error'}`)
      process.exit(1)
    },
  )
}
