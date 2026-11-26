#!/usr/bin/env node
// Stop hook for sessions that report to the owner. Claude Code runs it when a turn ends and passes JSON on stdin
// with `last_assistant_message` and `stop_hook_active` (https://code.claude.com/docs/en/hooks).
// A session opts in with the environment variable REPLY_STYLE=owner, set in the shell that starts `claude`
// (a hook inherits that environment). Any other session is not checked.
// When the reply fails the reply lint with the template checks on, the hook prints {"decision":"block","reason":...}
// and exits 0, so the agent rewrites the reply before the turn ends. It never blocks twice in a row
// (`stop_hook_active`), so a reply that cannot pass does not loop.
// A broken .claude/agent-kit.json does not block: the hook warns on stderr and exits 0 (exit 2 would keep the turn open).
import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { ConfigError, loadConfig } from './config.mjs'
import { DEFAULT_CONFIG, lint } from './reply-lint.mjs'

/** Returns null (let the turn end) or { decision: 'block', reason }. Pure: the tests call it without a model. */
export function decide(input, env = process.env, config = DEFAULT_CONFIG) {
  if (env.REPLY_STYLE !== 'owner') return null
  if (!input || input.stop_hook_active) return null
  const text = String(input.last_assistant_message || '').trim()
  if (!text) return null
  const findings = lint(text, { template: true }, config)
  if (!findings.length) return null
  const list = findings.map((f) => `line ${f.line}: ${f.rule}: ${f.message}`).join('\n')
  return {
    decision: 'block',
    reason: `Your reply to ${config.owner} breaks the reply-style rules (the reply-style skill). Rewrite it with the template for its kind and send it again:\n${list}`,
  }
}

/** Reads the hook input from stdin and prints the block decision, if any. */
export function main() {
  let input = null
  try {
    input = JSON.parse(readFileSync(0, 'utf8'))
  } catch {
    return // not JSON: let the turn end
  }
  if (!input || input.stop_hook_active || process.env.REPLY_STYLE !== 'owner') return
  let config
  try {
    config = loadConfig({ env: process.env })
  } catch (error) {
    if (!(error instanceof ConfigError)) throw error
    process.stderr.write(`reply-style: config ignored: ${error.message}\n`)
    return
  }
  const result = decide(input, process.env, config)
  if (result) console.log(JSON.stringify(result))
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main()
