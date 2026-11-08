// Vercel "Ignored Build Step": exit 0 skips the build, exit 1 builds. Fails toward building.
import { execFileSync } from 'node:child_process'

export const SKIP = [/^docs\//, /^\.github\//, /^tests\//, /^\.claude\//, /^\.githooks\//, /\.md$/]

export function shouldSkip(env, files) {
  if (env.VERCEL_ENV !== 'production') return false
  if (!Array.isArray(files) || files.length === 0) return false
  return files.every((f) => SKIP.some((re) => re.test(f)))
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const prev = process.env.VERCEL_GIT_PREVIOUS_SHA
  let files = []
  try {
    if (prev) files = execFileSync('git', ['diff', '--name-only', prev, 'HEAD'], { encoding: 'utf8' }).split('\n').filter(Boolean)
  } catch { files = [] } // slop-ok: no history means build, never skip
  const skip = shouldSkip(process.env, files)
  console.log(skip ? `[ignore] skipping: only ${files.length} docs/CI/test files changed` : '[ignore] building')
  process.exit(skip ? 0 : 1)
}
