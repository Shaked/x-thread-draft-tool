#!/usr/bin/env node
// Daily cleanup review, deterministic part (epic #255, task C1). Node 20, no dependencies, no model.
//
// planCleanupReview() decides what the daily workflow does:
//   nochange        the tag already points at HEAD: nothing to do
//   changelog-only  the only changes are under docs/changelogs/: move the tag, create nothing
//   still-open      changes exist but a cleanup issue is still open: create nothing, keep the tag
//   create          changes exist: open one cleanup issue, then move the tag
// It takes a git runner as a parameter, so the tests run without a repository or GitHub.
//
// CLI (the workflow passes every value through environment variables):
//   node scripts/cleanup-review-check.mjs           plan; writes GITHUB_OUTPUT and the issue body file
//   node scripts/cleanup-review-check.mjs notify    one Telegram line after the issue is opened
// Env for the plan: LAST_SHA (empty on the first run), HEAD_SHA, OPEN_CLEANUP (count),
// BODY_FILE (where the issue body is written), DRY_RUN ('true' prints only), GITHUB_OUTPUT.
// Env for notify: TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID, ISSUE_TITLE, ISSUE_URL.

import { execFileSync } from 'node:child_process'
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { notify } from './notify-telegram.mjs'

export const TAG = 'cleanup-review-last'
export const CHANGELOG = /^docs\/changelogs\//
export const MAX_COMMITS = 30
export const MAX_FILES = 100
// First run (no tag yet): look at the last 20 commits. Opus chose this default in the epic.
export const FIRST_RUN_BACK = 20
// Git's empty tree: diffs a repository with fewer than 21 commits against nothing.
export const EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904'
export const TEMPLATE = '.github/cleanup-review-issue.md'

// Files that count as a change: everything except the changelog entries.
export function relevantFiles(files) {
  return files.filter((f) => f && !CHANGELOG.test(f))
}

// The first `max` items, then one line "and N more" when the list was cut.
export function clipList(items, max) {
  if (items.length <= max) return items
  return [...items.slice(0, max), `and ${items.length - max} more`]
}

// Lines in a fenced block. Backticks become apostrophes, so text in a commit title can never close
// the block or render as a link or mention.
export function fence(lines) {
  const safe = lines.map((l) => String(l).replace(/`/g, "'"))
  return ['```text', ...safe, '```'].join('\n')
}

// Parses `git log --format=%h%x09%s` output into { sha, title } objects.
export function parseCommits(text) {
  return String(text)
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [sha, ...rest] = line.split('\t')
      return { sha, title: rest.join('\t') }
    })
}

// The issue body: the template (when C2 has written it), the commit list and the changed files.
export function buildBody({ commits, totalCommits, files, totalFiles, template = '' }) {
  const parts = []
  if (template.trim()) parts.push(template.trim())
  const shown = Math.min(commits.length, MAX_COMMITS)
  const commitHead = `Commits since the last review: ${totalCommits}` + (totalCommits > shown ? ` (first ${shown} shown)` : '')
  parts.push(commitHead)
  parts.push(fence(clipList(commits.map((c) => `${c.sha} ${c.title}`), MAX_COMMITS)))
  parts.push(`Changed files (docs/changelogs/ not counted): ${totalFiles}`)
  parts.push(fence(clipList(files, MAX_FILES)))
  parts.push('Rules: docs/operations/cleanup-review.md')
  return parts.join('\n\n') + '\n'
}

// Runs a git query; a failing query (for example a missing ref) gives an empty string.
function tryGit(git, args) {
  try {
    return git(args)
  } catch {
    return ''
  }
}

// Decides the action for one daily run. `git(args)` returns stdout text and throws on failure.
export function planCleanupReview({ last = '', head, openCleanupIssues = 0, git, date = '', template = '' }) {
  if (!head) throw new Error('head is required')
  if (last && last === head) return { action: 'nochange', moveTag: false, message: 'no changes: nothing to do' }

  // The commit range: since the tag, or on the first run the last FIRST_RUN_BACK commits.
  let logArgs
  let diffArgs
  if (last) {
    logArgs = [`${last}..${head}`]
    diffArgs = [last, head]
  } else {
    const base = tryGit(git, ['rev-parse', '-q', '--verify', `${head}~${FIRST_RUN_BACK}`]).trim()
    if (base) {
      logArgs = [`${base}..${head}`]
      diffArgs = [base, head]
    } else {
      logArgs = ['-n', String(FIRST_RUN_BACK), head]
      diffArgs = [EMPTY_TREE, head]
    }
  }

  const commits = parseCommits(git(['log', '--format=%h%x09%s', ...logArgs]))
  const allFiles = git(['diff', '--name-only', '--no-renames', ...diffArgs]).split('\n').filter(Boolean)
  const files = relevantFiles(allFiles)

  if (files.length === 0) {
    return { action: 'changelog-only', moveTag: true, message: 'only changelog changes: nothing to do', commits, files }
  }
  if (openCleanupIssues > 0) {
    return { action: 'still-open', moveTag: false, message: 'previous cleanup review still open', commits, files }
  }
  const body = buildBody({ commits, totalCommits: commits.length, files, totalFiles: files.length, template })
  return {
    action: 'create',
    moveTag: true,
    message: `changes: ${commits.length} commit(s), ${files.length} file(s)`,
    title: `Cleanup review ${date}`.trim(),
    body,
    commits,
    files,
  }
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
  const git = (args) => execFileSync('git', args, { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 })
  const template = existsSync(TEMPLATE) ? readFileSync(TEMPLATE, 'utf8') : ''
  const plan = planCleanupReview({
    last: env.LAST_SHA || '',
    head: env.HEAD_SHA || '',
    openCleanupIssues: Number(env.OPEN_CLEANUP || 0),
    git,
    date: utcDate(),
    template,
  })
  const dry = env.DRY_RUN === 'true'
  if (plan.action === 'create') {
    if (env.BODY_FILE) writeFileSync(env.BODY_FILE, plan.body)
    console.log(`${plan.message}`)
    console.log(plan.body)
  } else {
    console.log(plan.message)
  }
  if (dry) console.log(`dry run: would ${plan.action === 'create' ? 'open one issue' : plan.action}${plan.moveTag ? ' and move the tag' : ''}; nothing written`)
  writeOutputs({
    action: plan.action,
    move_tag: plan.moveTag ? 'true' : 'false',
    title: plan.title || '',
  })
}

async function notifyMain(env) {
  const plain = `🧹 ${env.ISSUE_TITLE || 'Cleanup review'}: one issue opened\n${env.ISSUE_URL || ''}`.trim()
  await notify({ token: env.TELEGRAM_BOT_TOKEN || '', chatId: env.TELEGRAM_CHAT_ID || '', plain })
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const mode = process.argv[2] || 'plan'
  const run = mode === 'notify' ? notifyMain(process.env) : planMain(process.env)
  // A planning error fails the job (someone must look). A Telegram error never does.
  run.catch((err) => {
    console.log(`cleanup-review failed: ${err?.name || 'error'}`)
    if (mode !== 'notify') process.exitCode = 1
  })
}
