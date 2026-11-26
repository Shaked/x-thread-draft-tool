#!/usr/bin/env node
// This repo's Stop hook entry: the reply-style plugin's hook, run with this repo's `.claude/agent-kit.json`.
// `.claude/settings.json` runs the plugin script directly; this wrapper keeps `decide(input, env)` for the tests and old callers.
// A broken settings file never blocks a turn (exit 2 would): the check is skipped with a warning on stderr.
import { pathToFileURL } from 'node:url'
import { decide as pluginDecide, main as pluginMain } from '../plugins/reply-style/scripts/reply-style-stop.mjs'

let config = null
let configError = null
try {
  config = (await import('./reply-lint.mjs')).config
} catch (error) {
  configError = error
}

export function decide(input, env = process.env) {
  if (configError) {
    if (env.REPLY_STYLE === 'owner') process.stderr.write(`reply-style: check skipped, config broken: ${configError.message}\n`)
    return null
  }
  return pluginDecide(input, env, config)
}

// Run directly, the plugin's main reads the hook input and the settings itself (and warns once on a broken file).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) pluginMain()
