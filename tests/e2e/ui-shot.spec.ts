// scripts/ui-shot.mjs runs for real (ui-debug skill): signed in as a user and signed out, it writes shots and a report.
// Needs the built app and the local API, as every spec here. One run signs in as the admin, but the stale tab case never reaches an admin API call.
import { expect, test } from '@playwright/test'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

const BASE = process.env.XT_BASE_URL ?? 'http://127.0.0.1:4173'

const execFileAsync = promisify(execFile)

async function run(args: string[]) {
  const out = mkdtempSync(path.join(tmpdir(), 'ui-shot-'))
  await execFileAsync('node', ['scripts/ui-shot.mjs', '--base', BASE, '--out', out, '--no-fail', ...args], { timeout: 120_000 })
  return { out, report: JSON.parse(readFileSync(path.join(out, 'report.json'), 'utf8')) }
}

test.setTimeout(120_000)

test('signed in user: one shot per case and a clean report', async () => {
  const { out, report } = await run(['--user', 'user', '--routes', '/,/about', '--widths', '390', '--themes', 'light,dark'])
  expect(report.total).toBe(4)
  for (const c of report.cases) {
    expect(existsSync(path.join(out, c.file)), c.file).toBe(true)
    expect(c.problems, `${c.route} ${c.theme}`).toEqual([])
  }
})

test('signed out and right to left: the language is recorded and the page is clean', async () => {
  const rtl = await run(['--user', 'out', '--routes', '/about', '--widths', '390', '--langs', 'he', '--allow', '401 /api/auth/me'])
  expect(rtl.report.cases[0]).toMatchObject({ lang: 'he', user: 'out' })
  expect(rtl.report.cases[0].problems).toEqual([])
})

test('stale tab: the admin page (a lazy file) shows a message and a reload button, not a blank page', async () => {
  const stale = await run(['--user', 'admin', '--routes', '/admin/flags', '--widths', '390', '--stale-chunk'])
  expect(stale.report.cases[0]).toMatchObject({ stale: true, recovery: true, blank: false })
  expect(stale.report.cases[0].problems).toEqual([])
})

test('a failed request fails the case and the exit code; --allow names it away', async () => {
  // A draft that does not exist: the page asks for it and the API answers 404.
  const args = ['--user', 'user', '--routes', '/draft/does-not-exist', '--widths', '390']
  const failing = await run(args)
  expect(failing.report.cases[0].ok).toBe(false)
  expect(failing.report.cases[0].problems.join('\n')).toMatch(/request 404 GET \/api\/drafts\//)
  const out = mkdtempSync(path.join(tmpdir(), 'ui-shot-'))
  await expect(execFileAsync('node', ['scripts/ui-shot.mjs', '--base', BASE, '--out', out, ...args], { timeout: 120_000 })).rejects.toMatchObject({ code: 1 })
  const allowed = await run([...args, '--allow', '404 /api/drafts/does-not-exist'])
  expect(allowed.report.cases[0].problems.join('\n')).not.toMatch(/request 404/)
})
