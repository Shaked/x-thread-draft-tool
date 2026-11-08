// Task 22 (docs/plans/hardening-finish.md): only main and the stable preview branch deploy.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const config = JSON.parse(readFileSync('vercel.json', 'utf8'))

// Copied from main so a change to the build or routing shows up here.
const MAIN_BUILD_COMMAND =
  'node scripts/migrate.mjs && VITE_DEPLOYED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)" VITE_DEPLOY_COMMIT_SHA="${VERCEL_GIT_COMMIT_SHA:-unknown}" npm run build'
const MAIN_REWRITES = [
  { source: '/api/:path*', destination: '/api/handler?__path=:path*' },
  { source: '/((?!api/).*)', destination: '/index.html' },
]

describe('vercel.json deployment rules', () => {
  it('deploys only the stable preview branch among claude/* and codex/* branches', () => {
    expect(config.git).toEqual({
      deploymentEnabled: {
        'claude/**': false,
        'codex/**': false,
        'claude/lucid-sagan-bbciuo': true,
      },
    })
  })

  it('keeps the build command and rewrites unchanged from main', () => {
    expect(config.buildCommand).toBe(MAIN_BUILD_COMMAND)
    expect(config.rewrites).toEqual(MAIN_REWRITES)
  })
})
