#!/usr/bin/env node
// This repo's comment lint: the reply-style plugin's comment lint with this repo's `.claude/agent-kit.json`.
// Used by .github/workflows/reply-lint-comments.yml. Rules: plugins/reply-style/scripts/reply-lint-comment.mjs.
// Usage: COMMENT_BODY=... node scripts/reply-lint-comment.mjs   (or the body on stdin)
import { pathToFileURL } from 'node:url'
import { agentCommentKind, lintComment as pluginLintComment, main as pluginMain } from '../plugins/reply-style/scripts/reply-lint-comment.mjs'
import { CONFIG_FILE, config } from './reply-lint.mjs'

export { agentCommentKind }

export const lintComment = (body) => pluginLintComment(body, config)

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const argv = process.argv
  pluginMain(argv.includes('--config') ? argv : [...argv, '--config', CONFIG_FILE])
}
