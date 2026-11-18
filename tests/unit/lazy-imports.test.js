// @vitest-environment node
// Cold start: the Blob SDK and undici must load only when an image route needs them (docs/plans/performance.md P3).
import { execFile } from 'node:child_process'
import { readdirSync, readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { describe, expect, it } from 'vitest'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const LAZY_ONLY = /^import\b[^'"]*?\bfrom\s*['"](@vercel\/blob|undici)['"]/gm
const LAZY_ONLY_SIDE_EFFECT = /^import\s*['"](@vercel\/blob|undici)['"]/gm

function jsFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return jsFiles(path)
    return entry.name.endsWith('.js') ? [path] : []
  })
}

function topLevelImports(source) {
  return [...source.matchAll(LAZY_ONLY), ...source.matchAll(LAZY_ONLY_SIDE_EFFECT)].map((match) => match[1])
}

describe('lazy image-only packages', () => {
  it('detects a top-level import of the lazy packages (the check itself works)', () => {
    expect(topLevelImports("import { put, del } from '@vercel/blob'\n")).toEqual(['@vercel/blob'])
    expect(topLevelImports("import {\n  Agent\n} from 'undici'\n")).toEqual(['undici'])
    expect(topLevelImports("const { Agent } = await import('undici')\n")).toEqual([])
  })

  it('no file under server/ imports @vercel/blob or undici at the top level', () => {
    const offenders = jsFiles(join(ROOT, 'server')).filter((file) => topLevelImports(readFileSync(file, 'utf8')).length > 0)
    expect(offenders.map((file) => file.slice(ROOT.length + 1))).toEqual([])
  })

  it('importing the API handler runs and prints the import time (timing is not asserted)', async () => {
    const script = "const t = performance.now(); await import('./api/handler.js'); console.log(performance.now() - t)"
    const { stdout } = await promisify(execFile)(process.execPath, ['--input-type=module', '-e', script], {
      cwd: ROOT,
      timeout: 20_000
    })
    const ms = Number(stdout.trim())
    expect(Number.isFinite(ms)).toBe(true)
    console.log(`[lazy-imports] api/handler.js import: ${ms.toFixed(1)} ms`)
  }, 25_000)
})
