#!/usr/bin/env node
// This repo's Stop hook entry: the reply-style plugin's hook, run with this repo's `.claude/agent-kit.json`.
// `.claude/settings.json` runs the plugin script directly; this wrapper keeps `decide(input, env)` for the tests and old callers.
// A broken settings file never blocks a turn (exit 2 would): the check is skipped with a warning on stderr.
import { pathToFileURL } from 'node:url'
import { decide as pluginDecide, main as pluginMain } from '../plugins/reply-style/scripts/reply-style-stop.mjs'

let config = null
try {
  config = (await import('./reply-lint.mjs')).config
} catch (error) {
  process.stderr.write(`reply-style: check skipped, config broken: ${error.message}\n`)
}

export const decide = (input, env = process.env) => (config ? pluginDecide(input, env, config) : null)

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) pluginMain()
