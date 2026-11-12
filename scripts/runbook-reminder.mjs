#!/usr/bin/env node
// Prints the rules card of the active runbook, so a session sees it again at start and after a
// context summary. With --short it prints one line (used on every prompt). It prints nothing when
// the plan file or its RULES-CARD block is missing, and it never fails a session.
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const PLAN = 'docs/plans/mcp-clients.md'
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

function rulesCard() {
  try {
    const text = readFileSync(resolve(root, PLAN), 'utf8')
    return text.match(/<!-- RULES-CARD:START -->\n([\s\S]*?)\n<!-- RULES-CARD:END -->/)?.[1] ?? null
  } catch {
    return null
  }
}

const card = rulesCard()
if (card) {
  console.log(
    process.argv.includes('--short')
      ? `If you are executing ${PLAN}: run its Checkpoint (section 2) before you act. ` +
          'Codex answers in 3 minutes, in a PR comment. Never sleep-poll.'
      : card
  )
}
