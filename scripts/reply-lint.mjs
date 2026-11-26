#!/usr/bin/env node
// This repo's reply lint: the reply-style plugin's lint with this repo's `.claude/agent-kit.json` applied.
// The rules live in plugins/reply-style/scripts/reply-lint.mjs; edit them there, with a version bump (docs/operations/reply-style.md).
// Importers (janitor, changelog check, tests) get `lint(text, options)` already bound to this repo's settings.
// Usage: node scripts/reply-lint.mjs [--template] [--kind=changelog|telegram] [--config <file>] <file>
import { fileURLToPath, pathToFileURL } from 'node:url'
import { ConfigError, loadConfig } from '../plugins/reply-style/scripts/config.mjs'
import { lint as pluginLint, main as pluginMain, HEADINGS, EMPTY_SECTION, RULES } from '../plugins/reply-style/scripts/reply-lint.mjs'

export { HEADINGS, EMPTY_SECTION, RULES }

export const CONFIG_FILE = fileURLToPath(new URL('../.claude/agent-kit.json', import.meta.url))
const running = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href

// A broken settings file stops the command line with exit 2 and a message; an importer gets the error itself.
export let config
try {
  config = loadConfig({ file: CONFIG_FILE })
} catch (error) {
  if (!(error instanceof ConfigError) || !running) throw error
  console.error(error.message)
  process.exit(2)
}
/** The one word of `Area:` in a changelog entry. Changing the list changes the page groups. */
export const AREAS = config.replyStyle.changelogAreas

export const lint = (text, options = {}) => pluginLint(text, options, config)

if (running) {
  const argv = process.argv.slice(2)
  pluginMain(argv.includes('--config') ? argv : [...argv, '--config', CONFIG_FILE])
}
