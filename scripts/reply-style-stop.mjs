#!/usr/bin/env node
// This repo's Stop hook entry: the reply-style plugin's hook, run with this repo's `.claude/agent-kit.json`.
// `.claude/settings.json` runs the plugin script directly; this wrapper keeps `decide(input, env)` for the tests and old callers.
import { pathToFileURL } from 'node:url'
import { decide as pluginDecide, main as pluginMain } from '../plugins/reply-style/scripts/reply-style-stop.mjs'
import { config } from './reply-lint.mjs'

export const decide = (input, env = process.env) => pluginDecide(input, env, config)

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  pluginMain()
}
