#!/usr/bin/env node
// Checks the body of a finding issue against templates/finding-issue.md, bare or under "## Details" of a reply template. Node 20, no dependencies.
// Usage: node finding-check.mjs <file>   Exit 0 when it passes, 1 with one finding per line, 2 for wrong usage or an unreadable file.
import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

export const HEADINGS = ['What is over', 'The numbers', 'Likely cause', 'What was done', 'Links']
export const CAUSES = ['slow setup step', 'flaky test', 'real failure', 'slow external service', 'more traffic', 'unknown']
const NUMBER_LABELS = ['Now', 'Limit', 'Last week', 'Over since']

/** Findings as { rule, message }. Rules: headings, numbers, cause, limit, links. */
export function check(raw) {
  // A project that requires reply templates puts the five sections under "## Details" as "### " headings.
  const details = raw.match(/^## Details\s*$/m)
  const text = details ? raw.slice(details.index + details[0].length).replace(/^### /gm, '## ') : raw
  const findings = []
  const add = (rule, message) => findings.push({ rule, message })
  const found = [...text.matchAll(/^## (.+?)\s*$/gm)].map((m) => m[1])
  if (found.join('|') !== HEADINGS.join('|')) add('headings', `headings must be exactly: ${HEADINGS.join(', ')}`)
  const section = (name) => text.split(new RegExp(`^## ${name}\\s*$`, 'm'))[1]?.split(/^## /m)[0] ?? ''
  const numbers = section('The numbers')
  for (const label of NUMBER_LABELS) {
    if (!new RegExp(`^- ${label}: \\S`, 'm').test(numbers)) add('numbers', `"The numbers" needs a line "- ${label}: ..."`)
  }
  if (/^- Now: .*\(.*\bchecked\b/m.test(numbers) === false) add('numbers', 'the "Now" line must say "checked" or "not checked"')
  const cause = section('Likely cause').trim()
  if (!CAUSES.some((c) => cause.startsWith(`${c}:`))) add('cause', `"Likely cause" must start with one of: ${CAUSES.join(', ')}, then a colon`)
  if (!/^No limit was changed\.$/m.test(section('What was done'))) add('limit', '"What was done" must say "No limit was changed."')
  if (!/https:\/\/\S+/.test(section('Links'))) add('links', '"Links" needs at least one https link')
  return findings
}

export function main(argv = process.argv.slice(2)) {
  if (argv.length !== 1) {
    console.error('usage: finding-check.mjs <file>')
    return 2
  }
  let text
  try {
    text = readFileSync(argv[0], 'utf8')
  } catch (error) {
    console.error(`finding-check: cannot read ${argv[0]} (${error.code || error.message})`)
    return 2
  }
  const findings = check(text)
  for (const f of findings) console.log(`${f.rule}: ${f.message}`)
  console.log(findings.length ? `finding-check: ${findings.length} finding(s)` : 'finding-check: OK')
  return findings.length ? 1 : 0
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) process.exit(main())
