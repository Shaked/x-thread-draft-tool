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
// --merge warns (one ::warning:: per stage over its limit), never fails for speed, and runs the per-merge gate:
//   one gate issue, and one Telegram alert when a streak over a limit starts (task M7, #446).
// --last sends one Telegram alert when a stage's p90 is over its limit.

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
  // Writes are used only by the per-merge gate (issues: write). The token is never printed.
  async function send(method, path, payload) {
    const res = await fetchImpl(`${base}${path}`, { method, headers: { ...headers, 'content-type': 'application/json' }, body: JSON.stringify(payload) })
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
    async jobsForRun(runId) {
      return (await get(`/actions/runs/${runId}/jobs?per_page=100`)).jobs ?? []
    },
    // The open speed gate issue (label task, the title below), or null.
    async openGateIssue() {
      // Every page: the repository has more open task issues than one page holds.
      for (let page = 1; page <= 20; page++) {
        const list = await get(`/issues?state=open&labels=task&per_page=100&page=${page}`)
        const found = list.find((issue) => !issue.pull_request && issue.title === GATE_TITLE)
        if (found || list.length < 100) return found ?? null
      }
      return null
    },
    async createGateIssue(body) {
      return send('POST', '/issues', { title: GATE_TITLE, body, labels: ['task'] })
    },
    async updateGateBody(number, body) {
      return send('PATCH', `/issues/${number}`, { body })
    },
    async closeGate(number, comment) {
      await send('POST', `/issues/${number}/comments`, { body: comment })
      return send('PATCH', `/issues/${number}`, { state: 'closed', state_reason: 'completed' })
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

// Plain words for the stages (the Telegram alert and the gate issue; the table keeps STAGE_LABEL).
const PLAIN_STAGE = { ci: 'CI checks', merge_wait: 'merge wait', vercel: 'deploy', smoke: 'smoke test', total: 'the total' }
export const GATE_TITLE = 'Speed gate: delivery is over its limit'
const DAY_MS = 86400000
// Merges measured for a streak: docs-only merges use up part of it. A streak longer than this keeps its stored start.
const GATE_WINDOW = 40
const SPEED_DOC = 'docs/plans/speed.md#1-definitions'
const FOOTER = '---\n_Generated by [Claude Code](https://claude.ai/code)_'

// "3 min 38 s", or "47 s" under a minute.
export function secsText(s) {
  const m = Math.floor(s / 60)
  return m ? `${m} min ${s % 60} s` : `${s} s`
}
// "2026-11-24 14:10 UTC".
export const utcText = (iso) => `${new Date(Date.parse(iso)).toISOString().slice(0, 16).replace('T', ' ')} UTC`
// "CI checks and the total", "deploy".
export function plainList(names) {
  return names.length <= 1 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
}
const pct = (value, limit) => Math.round((value / limit - 1) * 100)

// The stage furthest over its limit, by how many times its limit it is.
export function worstOver(record) {
  return [...overLimit(record)].sort((a, b) => b.value / b.limit - a.value / a.limit)[0] ?? null
}

// The streak: production merges, newest first, counted back from the merge `from` while each is over a limit.
// Stops at the first one within its limits.
export function streakOf(records, from) {
  const upTo = Date.parse(from.merged_at)
  const code = records
    .filter((r) => r.kind === 'code' && r.stages.vercel && Date.parse(r.merged_at) <= upTo)
    .sort((a, b) => Date.parse(b.merged_at) - Date.parse(a.merged_at))
  const streak = []
  for (const r of code) {
    if (overLimit(r).length === 0) break
    streak.push(r)
  }
  return streak
}

// Likely cause for CI: the step of the newest merge's Tests run that is furthest above its median over the streak.
// Null when there is no step to compare (one run, or no step above its usual time).
export async function ciCause(record, recent, api) {
  const stepSecs = []
  const compare = [record, ...recent.filter((r) => r.kind === 'code' && r.head_sha !== record.head_sha)].slice(0, 20)
  for (const r of compare) {
    const tests = earliest((await api.runsForSha(r.head_sha)).filter((run) => run.name === 'Tests'))
    if (!tests) continue
    const byName = new Map()
    for (const job of await api.jobsForRun(tests.id)) {
      for (const step of job.steps ?? []) {
        if (step.started_at && step.completed_at) byName.set(step.name, (byName.get(step.name) ?? 0) + secs(step.started_at, step.completed_at))
      }
    }
    stepSecs.push({ sha: r.head_sha, byName })
  }
  const newest = stepSecs.find((x) => x.sha === record.head_sha)?.byName
  if (!newest || stepSecs.length < 2) return null
  let best = null
  for (const [name, value] of newest) {
    const usual = median(stepSecs.map((x) => x.byName.get(name)).filter((v) => v !== undefined))
    const above = value - usual
    if (above > 0 && (!best || above > best.above)) best = { name, value, usual, above }
  }
  return best ? `${best.name} took ${secsText(best.value)} against a usual ${secsText(best.usual)}` : null
}

// The gate issue body. Its last line holds the state the next run reads back; nothing else is stored.
export function gateBody(state, lines) {
  return [
    `Delivery is over its limit since ${utcText(state.since)} (${state.count} in a row).`,
    '',
    ...lines.map((line) => `- ${line}`),
    '',
    'A diagnosis is written on this issue (AGENTS.md speed rule), then a fix PR follows.',
    '',
    FOOTER,
    '',
    `<!-- speed-gate ${JSON.stringify(state)} -->`,
  ].join('\n')
}
export function readGate(body) {
  const m = String(body || '').match(/<!-- speed-gate (\{.*\}) -->/)
  try {
    return m ? JSON.parse(m[1]) : null
  } catch {
    return null
  }
}

// The streak start and count. The window holds GATE_WINDOW merges: a streak that reaches it keeps the start and
// count already stored in the gate, so the reported start does not move forward.
export function streakFields(prev, streak) {
  const start = minDate(streak.map((r) => r.merged_at))
  // Keep the stored start only for the same streak: the gate is not clear, and the window ran out before the streak did.
  const same = prev?.active && !prev.clearSince && prev.since && streak.length >= GATE_WINDOW
  if (same) return { since: Date.parse(prev.since) < Date.parse(start) ? prev.since : start, count: Math.max(prev.count, streak.length) }
  return { since: start, count: streak.length }
}

// The per-merge gate, after a production merge with a streak over a limit (it sends once per streak).
// Opens or updates the gate issue. Closes it after 24 hours within the limits. Returns the message to send, or null.
export async function gateStep({ record, streak, recent, api, now, runUrl, docsUrl }) {
  const gate = await api.openGateIssue()
  const prev = gate ? readGate(gate.body) : null
  const state = prev ?? { active: false, since: null, count: 0, clearSince: null }
  const worst = worstOver(record)
  if (worst) {
    const cause = worst.stage === 'ci' ? await ciCause(record, recent, api) : null
    const sendNow = !state.active
    state.active = true
    state.clearSince = null
    Object.assign(state, streakFields(prev, streak))
    const lines = overLimit(record).map((o) => `${PLAIN_STAGE[o.stage]}: ${secsText(o.value)}, limit ${secsText(o.limit)}`)
    const body = gateBody(state, lines)
    const issue = gate ? await api.updateGateBody(gate.number, body) : await api.createGateIssue(body)
    const url = issue?.html_url ?? gate?.html_url ?? runUrl
    if (!sendNow) return null
    const names = plainList(overLimit(record).map((o) => PLAIN_STAGE[o.stage]))
    return buildMessage('speed', {
      headline: `Delivery is slower than its limit: ${names}`,
      url,
      numberLine: `This merge took ${secsText(worst.value)} in ${PLAIN_STAGE[worst.stage]}. The limit is ${secsText(worst.limit)} (${pct(worst.value, worst.limit)} % over), since ${utcText(state.since)} (${state.count} in a row).`,
      causeLine: cause ? `Likely cause: ${cause}.` : 'Likely cause: not known yet.',
      actionLine: 'Nothing needed. A diagnosis follows on the linked issue, then an agent opens the fix PR.',
      links: [['Speed table', runUrl], ['What the stages mean', docsUrl]],
    })
  }
  if (gate && state.active) {
    state.clearSince ??= new Date(now).toISOString()
    if (now - Date.parse(state.clearSince) >= DAY_MS) {
      await api.closeGate(gate.number, `Within the limits for 24 hours since ${utcText(state.clearSince)}. Closing this gate.\n\n${FOOTER}`)
    } else {
      await api.updateGateBody(gate.number, gateBody(state, [`Within the limits since ${utcText(state.clearSince)}.`]))
    }
  }
  return null
}

// The manual run (--last): one message for the stages over their p90 limit, from the summary.
function manualAlert(summary, prs, runUrl, docsUrl) {
  const first = ['code', 'docs'].flatMap((kind) => STAT_STAGES.map((stage) => ({ kind, stage, st: summary[kind][stage] }))).find((x) => x.st?.over)
  if (!first) return null
  const over = ['code', 'docs'].flatMap((kind) => STAT_STAGES.filter((stage) => summary[kind][stage]?.over).map((stage) => PLAIN_STAGE[stage]))
  const since = minDate(prs.map((pr) => pr.merged_at))
  return buildMessage('speed', {
    headline: `Delivery is slower than its limit: ${plainList([...new Set(over)])}`,
    url: runUrl,
    numberLine: `1 in 10 merges took ${secsText(first.st.p90)} or more in ${PLAIN_STAGE[first.stage]}. The limit is ${secsText(first.st.limit)} (${pct(first.st.p90, first.st.limit)} % over), in the last ${prs.length} merges since ${utcText(since)}.`,
    causeLine: 'Likely cause: not known yet.',
    actionLine: 'Nothing needed. The speed check only warns.',
    links: [['What the stages mean', docsUrl]],
  })
}

// Per-merge: warns in the log for each stage over its limit, then runs the gate.
// Manual (--last): sends one Telegram message when a stage's p90 is over its limit.
async function alert(opts, prs, summary, env, { log, notifyImpl, api, now }) {
  const server = env.GITHUB_SERVER_URL || 'https://github.com'
  const runUrl = `${server}/${env.GITHUB_REPOSITORY || ''}/actions/runs/${env.GITHUB_RUN_ID || ''}`
  const docsUrl = `${server}/${env.GITHUB_REPOSITORY || ''}/blob/main/${SPEED_DOC}`
  const send = (message) => (message ? notifyImpl({ token: env.TELEGRAM_BOT_TOKEN || '', chatId: env.TELEGRAM_CHAT_ID || '', ...message, log }) : null)
  if (opts.merge !== undefined) {
    for (const pr of prs) {
      for (const o of overLimit(pr)) {
        log(`::warning title=Speed budget::#${pr.number} ${STAGE_LABEL[o.stage]} ${o.value} s is over the limit of ${o.limit} s`)
      }
    }
    const record = prs[0]
    const recent = await measureAll(await api.recentMergedPulls({ count: GATE_WINDOW }), api)
    const streak = streakOf([record, ...recent.filter((r) => r.merge_sha !== record.merge_sha)], record)
    return send(await gateStep({ record, streak, recent, api, now, runUrl, docsUrl }))
  }
  await send(manualAlert(summary, prs, runUrl, docsUrl))
}

// Writes speed.json and speed.md, and the markdown to the job summary when GitHub gives one. Returns the markdown.
function writeOutputs(doc, out, env) {
  mkdirSync(out, { recursive: true })
  writeFileSync(join(out, 'speed.json'), stableJson(doc))
  const md = renderMarkdown(doc)
  writeFileSync(join(out, 'speed.md'), md)
  if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, md)
  return md
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
  const md = writeOutputs({ mode: found.mode, limits: LIMITS, summary, prs }, opts.out ?? 'speed-metrics', env)
  // By hand (--last) the table goes to the job log too, so the p90 numbers can be read without the artifact.
  if (opts.merge === undefined) log(md)
  await alert(opts, prs, summary, env, { log, notifyImpl, api: client, now })
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
