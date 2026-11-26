#!/usr/bin/env node
// This repo's comment lint: the reply-style plugin's comment lint with this repo's `.claude/agent-kit.json`.
// Used by .github/workflows/reply-lint-comments.yml. Rules: plugins/reply-style/scripts/reply-lint-comment.mjs.
// Usage: COMMENT_BODY=... node scripts/reply-lint-comment.mjs   (or the body on stdin)
// A broken settings file is reported by the plugin's main() (exit 2) only for an agent comment; other comments are skipped.
import { fileURLToPath, pathToFileURL } from 'node:url'
import { agentCommentKind, lintComment as pluginLintComment, main as pluginMain } from '../plugins/reply-style/scripts/reply-lint-comment.mjs'

export { agentCommentKind }

const CONFIG_FILE = fileURLToPath(new URL('../.claude/agent-kit.json', import.meta.url))
let config = null
let configError = null
try {
  config = (await import('./reply-lint.mjs')).config
} catch (error) {
  configError = error
}

export const lintComment = (body) => {
  if (configError) throw configError
  return pluginLintComment(body, config)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const argv = process.argv
  pluginMain(argv.includes('--config') ? argv : [...argv, '--config', CONFIG_FILE])
}
