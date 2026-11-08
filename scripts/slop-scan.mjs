#!/usr/bin/env node
// Slop scan: flags leftovers that should not reach main. Scans tracked source files under
// src/, server/, api/ and scripts/. Exits 1 when anything is found.
//
// Rules (each finding prints `file:line: rule`):
//   marker          a work-in-progress note or placeholder filler phrase (see MARKER below)
//   commented-code  three or more consecutive // lines that look like code (ending in ; { } or ))
//   empty-catch     a catch block with nothing inside
//
// A line ending in `// slop-ok: <reason of three or more words>` is skipped.

import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

export const SCAN_DIRS = ['src', 'server', 'api', 'scripts']
const SOURCE_EXTENSIONS = /\.(c|m)?jsx?$|\.tsx?$/
// Written with brackets so this file does not flag itself.
const MARKER = /\b(T[O]DO|FIX[M]E|XX[X]|HAC[K]|lo[r]em ipsum)\b/i
const SLOP_OK = /\/\/\s*slop-ok:\s*\S+(?:\s+\S+){2,}\s*$/
const CODE_COMMENT_RUN = 3
const CODE_LIKE_END = /[;{})]\s*$/
const EMPTY_CATCH = /catch\s*(?:\([^)]*\))?\s*\{\s*\}/g

function lineOf(text, index) {
  return text.slice(0, index).split('\n').length
}

/** Returns findings for one file's text: [{ file, line, rule }]. */
export function scan(text, file) {
  const findings = []
  const lines = text.split('\n')
  const skipped = (line) => SLOP_OK.test(line)

  lines.forEach((line, i) => {
    if (skipped(line)) return
    if (MARKER.test(line)) findings.push({ file, line: i + 1, rule: 'marker' })
  })

  let run = []
  const flushRun = () => {
    if (run.length >= CODE_COMMENT_RUN) {
      findings.push({ file, line: run[0] + 1, rule: 'commented-code' })
    }
    run = []
  }
  lines.forEach((line, i) => {
    const trimmed = line.trim()
    const isCodeComment = trimmed.startsWith('//') && !skipped(line) && CODE_LIKE_END.test(trimmed.slice(2))
    if (isCodeComment) {
      run.push(i)
    } else {
      flushRun()
    }
  })
  flushRun()

  for (const match of text.matchAll(EMPTY_CATCH)) {
    const line = lineOf(text, match.index)
    if (!skipped(lines[line - 1] || '')) findings.push({ file, line, rule: 'empty-catch' })
  }

  return findings.sort((a, b) => a.line - b.line)
}

function trackedSourceFiles() {
  const out = execFileSync('git', ['ls-files', ...SCAN_DIRS], { encoding: 'utf8' })
  return out.split('\n').filter((file) => file && SOURCE_EXTENSIONS.test(file))
}

function main() {
  const findings = trackedSourceFiles().flatMap((file) => scan(readFileSync(file, 'utf8'), file))
  for (const f of findings) console.log(`${f.file}:${f.line}: ${f.rule}`)
  if (findings.length > 0) {
    console.error(`slop-scan: ${findings.length} finding(s)`)
    process.exit(1)
  }
  console.log('slop-scan: clean')
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
}
