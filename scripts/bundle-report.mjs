#!/usr/bin/env node
// Walks dist/assets, computes raw + gzip + brotli sizes per chunk.
// Compares against bundle-baseline.json if present; prints a Markdown table.
// `--save` writes the current sizes back to bundle-baseline.json.

import { readdirSync, statSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { gzipSync, brotliCompressSync, constants } from 'node:zlib'
import { join, dirname, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const DIST = join(ROOT, 'dist', 'assets')
const BASELINE_PATH = join(ROOT, 'bundle-baseline.json')
const SAVE = process.argv.includes('--save')

if (!existsSync(DIST)) {
  console.error('No dist/assets directory. Run `npm run build` first.')
  process.exit(1)
}

function sizes(buf) {
  return {
    raw: buf.length,
    gzip: gzipSync(buf, { level: 9 }).length,
    brotli: brotliCompressSync(buf, {
      params: { [constants.BROTLI_PARAM_QUALITY]: 11 }
    }).length
  }
}

function fmtBytes(n) {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(2)} MB`
}

function fmtDelta(now, prev) {
  if (prev === undefined) return '(new)'
  const d = now - prev
  if (d === 0) return '—'
  const sign = d > 0 ? '+' : ''
  const pct = prev === 0 ? '∞' : `${((d / prev) * 100).toFixed(1)}%`
  return `${sign}${fmtBytes(d)} (${sign}${pct})`
}

function walk(dir) {
  const out = []
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    const st = statSync(full)
    if (st.isDirectory()) out.push(...walk(full))
    else if (/\.(js|css|html)$/.test(name)) out.push(full)
  }
  return out
}

const files = walk(DIST).sort()
const current = {}
let totals = { raw: 0, gzip: 0, brotli: 0 }
for (const path of files) {
  const buf = readFileSync(path)
  const s = sizes(buf)
  const rel = relative(ROOT, path)
  current[rel] = s
  totals.raw += s.raw
  totals.gzip += s.gzip
  totals.brotli += s.brotli
}

if (SAVE) {
  writeFileSync(BASELINE_PATH, JSON.stringify({ files: current, totals }, null, 2) + '\n')
  console.log(`Wrote baseline to ${relative(ROOT, BASELINE_PATH)} (${files.length} files, ${fmtBytes(totals.gzip)} gzip total).`)
  process.exit(0)
}

const baseline = existsSync(BASELINE_PATH)
  ? JSON.parse(readFileSync(BASELINE_PATH, 'utf8'))
  : null

let md = `# Bundle report\n\n`
md += baseline
  ? `Comparing against \`bundle-baseline.json\` (${Object.keys(baseline.files).length} files).\n\n`
  : `No \`bundle-baseline.json\` found. Run \`npm run bundle:baseline\` to lock in the current state.\n\n`

md += `| File | Raw | Gzip | Brotli | Δ Gzip |\n`
md += `|---|---:|---:|---:|---:|\n`
for (const [rel, s] of Object.entries(current).sort(([, a], [, b]) => b.gzip - a.gzip)) {
  const prev = baseline?.files?.[rel]
  md += `| ${rel} | ${fmtBytes(s.raw)} | ${fmtBytes(s.gzip)} | ${fmtBytes(s.brotli)} | ${fmtDelta(s.gzip, prev?.gzip)} |\n`
}

if (baseline) {
  for (const rel of Object.keys(baseline.files)) {
    if (!current[rel]) {
      md += `| ${rel} | — | — | — | (removed) |\n`
    }
  }
}

md += `\n**Totals**: ${fmtBytes(totals.raw)} raw, **${fmtBytes(totals.gzip)} gzip**, ${fmtBytes(totals.brotli)} brotli`
if (baseline) md += ` — Δ gzip ${fmtDelta(totals.gzip, baseline.totals.gzip)}`
md += `\n`

process.stdout.write(md)

// Soft fail on >10 KB gzip regression (Claude reads the exit code).
if (baseline && (totals.gzip - baseline.totals.gzip) > 10 * 1024) {
  console.error(`\nWARNING: total gzip grew by >10 KB. If this is intentional, run \`npm run bundle:baseline\` to update the baseline.`)
  process.exit(2)
}
