// Task 23 (docs/plans/hardening-finish.md): production skips builds for docs, CI and test-only merges.
import { describe, expect, it } from 'vitest'
import { shouldSkip } from '../../scripts/vercel-ignore.mjs'

const PROD = { VERCEL_ENV: 'production' }
const PREVIEW = { VERCEL_ENV: 'preview' }

describe('shouldSkip (Vercel ignored build step)', () => {
  it('never skips a preview build', () => {
    expect(shouldSkip(PREVIEW, ['docs/a.md'])).toBe(false)
  })

  it('skips production when only docs and CI files changed', () => {
    expect(shouldSkip(PROD, ['docs/a.md', '.github/x.yml'])).toBe(true)
  })

  it('builds production when a src file changed', () => {
    expect(shouldSkip(PROD, ['docs/a.md', 'src/App.jsx'])).toBe(false)
  })

  it('builds production for scripts/migrate.mjs (it runs in the build)', () => {
    expect(shouldSkip(PROD, ['scripts/migrate.mjs'])).toBe(false)
  })

  it('builds production when the file list is empty (no history)', () => {
    expect(shouldSkip(PROD, [])).toBe(false)
    expect(shouldSkip(PROD, undefined)).toBe(false)
  })

  it('builds production when vercel.json changed', () => {
    expect(shouldSkip(PROD, ['vercel.json'])).toBe(false)
  })
})

// Codex P2 on #62: moving a deployed file into docs/ must still build (rename source path listed).
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawnSync, execFileSync } from 'node:child_process'

describe('vercel-ignore script on a real git diff', () => {
  it('builds when a production file is moved into docs/', () => {
    const dir = mkdtempSync(join(tmpdir(), 'xt-ignore-'))
    try {
      const git = (...args) => execFileSync('git', args, { cwd: dir, stdio: 'pipe' }).toString().trim()
      git('init', '-q')
      git('config', 'user.email', 't@example.com')
      git('config', 'user.name', 't')
      mkdirSync(join(dir, 'public'))
      writeFileSync(join(dir, 'public', 'llms.txt'), 'hi\n')
      git('add', '-A')
      git('commit', '-qm', 'one')
      const prev = git('rev-parse', 'HEAD')
      mkdirSync(join(dir, 'docs'))
      git('mv', 'public/llms.txt', 'docs/llms.txt')
      git('commit', '-qm', 'move')
      const run = spawnSync(process.execPath, [resolve('scripts/vercel-ignore.mjs')], {
        cwd: dir,
        env: { ...process.env, VERCEL_ENV: 'production', VERCEL_GIT_PREVIOUS_SHA: prev },
        encoding: 'utf8',
      })
      expect(run.status).toBe(1)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
