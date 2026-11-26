// scripts/ui-shot.mjs runs for real (ui-debug skill): signed in as a user and signed out, it writes shots and a report.
// Needs the built app and the local API, as every spec here. A normal user only, so no admin read budget is used.
import { expect, test } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

const BASE = process.env.XT_BASE_URL ?? 'http://127.0.0.1:4173'

function run(args: string[]) {
  const out = mkdtempSync(path.join(tmpdir(), 'ui-shot-'))
  const log = execFileSync('node', ['scripts/ui-shot.mjs', '--base', BASE, '--out', out, '--no-fail', ...args], { encoding: 'utf8', timeout: 120_000 })
  return { out, log, report: JSON.parse(readFileSync(path.join(out, 'report.json'), 'utf8')) }
}

test('signed in user: one shot per case and a clean report', () => {
  const { out, report } = run(['--user', 'user', '--routes', '/,/about', '--widths', '390', '--themes', 'light,dark'])
  expect(report.total).toBe(4)
  for (const c of report.cases) {
    expect(existsSync(path.join(out, c.file)), c.file).toBe(true)
    expect(c.problems, `${c.route} ${c.theme}`).toEqual([])
  }
})

test('signed out, right to left, stale tab: the report says what happened', () => {
  const rtl = run(['--user', 'out', '--routes', '/about', '--widths', '390', '--langs', 'he', '--allow', '401 /api/auth/me'])
  expect(rtl.report.cases[0]).toMatchObject({ lang: 'he', user: 'out' })
  expect(rtl.report.cases[0].problems).toEqual([])
  const stale = run(['--user', 'user', '--routes', '/about', '--widths', '390', '--stale-chunk'])
  expect(stale.report.total).toBe(1)
})
