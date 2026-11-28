#!/usr/bin/env node
// Rebuilds tests/shard-timings.json from what CI measured (#634). The unit shards print one `test-budget-file: <ms> <file>`
// line per test file (scripts/test-budget.mjs). This reads those lines from the job logs of the last N Tests workflow
// runs through `gh api`, keeps each file's median, and writes the table plus a balanced assignment
// (tests/shard-assignment.json; files stay in their shard unless moving them lowers the heaviest shard).
// Usage: npm run shard-timings:ci -- [--runs=20] [--shards=4] [--branch=main] [--event=push] [--dry-run]
//        npm run shard-timings:ci -- --logs=<dir>   (job logs already downloaded, one .log file per job)
import { spawnSync } from 'node:child_process'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { currentShardCount, currentTimings, saveTables } from './shard-tables.mjs'

const REPO = process.env.GITHUB_REPOSITORY ?? 'Shaked/x-thread-draft-tool'
const ANSI = new RegExp(String.fromCharCode(27) + '\\[[0-9;]*m', 'g')
const LINE = /test-budget-file: (\d+) (\S+)/
const TOTAL = /test-budget: total (\d+) ms over (\d+) files/

export const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)]
}

/** The per-file worker times and the wall time of one unit shard job log; null when the log has neither. */
export function parseJobLog(text) {
  const clean = text.replace(ANSI, '')
  const files = {}
  for (const line of clean.split('\n')) {
    const match = LINE.exec(line)
    if (match) files[match[2]] = Number(match[1])
  }
  const total = TOTAL.exec(clean)
  if (Object.keys(files).length === 0) return null
  return { files, totalMs: total ? Number(total[1]) : null }
}

/** Median per file over the jobs. A file seen in fewer than `minSeen` jobs keeps its old time. */
export function medianTimings(jobs, previous = {}, minSeen = 1) {
  const seen = {}
  for (const job of jobs) for (const [key, ms] of Object.entries(job.files)) (seen[key] ??= []).push(ms)
  const next = { ...previous }
  for (const [key, values] of Object.entries(seen)) if (values.length >= minSeen) next[key] = Math.round(median(values))
  return next
}

const gh = (path) => {
  const run = spawnSync('gh', ['api', path], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 })
  if (run.status !== 0) throw new Error(`gh api ${path} failed: ${run.stderr.trim()}`)
  return run.stdout
}

function fetchJobLogs({ runs, branch, event }) {
  const query = new URLSearchParams({ per_page: '100', status: 'completed' })
  if (branch) query.set('branch', branch)
  if (event) query.set('event', event)
  const list = JSON.parse(gh(`repos/${REPO}/actions/workflows/tests.yml/runs?${query}`)).workflow_runs
  const logs = []
  for (const run of list) {
    if (logs.length >= runs * 4) break
    for (let attempt = 1; attempt <= run.run_attempt; attempt++) {
      const jobs = JSON.parse(gh(`repos/${REPO}/actions/runs/${run.id}/attempts/${attempt}/jobs?per_page=100`)).jobs
      for (const job of jobs.filter((j) => /^Unit tests shard /.test(j.name))) {
        try {
          logs.push(gh(`repos/${REPO}/actions/jobs/${job.id}/logs`))
        } catch {
          // a job whose logs expired or were cancelled is skipped
        }
      }
    }
  }
  return logs
}

function main() {
  const args = Object.fromEntries(process.argv.slice(2).map((arg) => arg.replace(/^--/, '').split('=')))
  const runs = Number(args.runs ?? 20)
  const shards = Number(args.shards ?? currentShardCount())
  const texts = args.logs
    ? readdirSync(args.logs).filter((name) => name.endsWith('.log')).map((name) => readFileSync(join(args.logs, name), 'utf8'))
    : fetchJobLogs({ runs, branch: args.branch, event: args.event })
  const jobs = texts.map(parseJobLog).filter(Boolean)
  if (jobs.length < shards) throw new Error(`ci-shard-timings: only ${jobs.length} job log(s) with test-budget-file lines; need at least ${shards}`)
  const totals = jobs.map((job) => job.totalMs).filter((ms) => ms !== null)
  console.log(`ci-shard-timings: ${jobs.length} shard job logs; shard wall time min ${Math.min(...totals)} median ${median(totals)} max ${Math.max(...totals)} ms`)
  const previous = currentTimings()
  const next = medianTimings(jobs, previous, Math.min(3, Math.floor(jobs.length / shards)))
  const changed = Object.keys(next).filter((key) => previous[key] !== next[key]).length
  if (args['dry-run'] !== undefined) {
    console.log(`ci-shard-timings: dry run, ${changed} of ${Object.keys(next).length} times would change`)
    return
  }
  const saved = saveTables(next, shards)
  console.log(`ci-shard-timings: ${saved.files} files, ${changed} times changed, ${saved.moved} files moved between shards; shard totals ${saved.totals.join(' / ')} ms`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main()
