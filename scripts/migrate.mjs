// Applies db/migrations/*.sql to Neon, in filename order, each file once.
//
// Usage:
//   node scripts/migrate.mjs            # build step: warns and exits 0 if no DB URL is set
//   node scripts/migrate.mjs --strict   # `npm run db:migrate`: exits 1 if no DB URL is set
//
// The URL is DATABASE_URL_UNPOOLED (direct connection, fallback DATABASE_URL).

import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import pg from 'pg'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
export const MIGRATIONS_DIR = path.join(ROOT, 'db', 'migrations')

/**
 * Applies every migration not yet recorded in schema_migrations.
 * `queryFn(text, params?)` must resolve to `{ rows }`. Call it without `params`
 * for multi-statement SQL (node-postgres simple protocol).
 */
export async function applyMigrations(queryFn, dir = MIGRATIONS_DIR) {
  await queryFn(`
    create table if not exists schema_migrations (
      name text primary key,
      applied_at timestamptz not null default now()
    )
  `)

  const recorded = await queryFn('select name from schema_migrations')
  const done = new Set(recorded.rows.map((row) => row.name))
  const files = (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort()

  const applied = []
  const skipped = []
  for (const file of files) {
    if (done.has(file)) {
      skipped.push(file)
      continue
    }
    const sql = await readFile(path.join(dir, file), 'utf8')
    await queryFn('begin')
    try {
      await queryFn(sql)
      await queryFn('insert into schema_migrations (name) values ($1)', [file])
      await queryFn('commit')
    } catch (error) {
      await queryFn('rollback')
      throw new Error(`Migration ${file} failed: ${error.message}`)
    }
    applied.push(file)
  }
  return { applied, skipped }
}

async function main() {
  const strict = process.argv.includes('--strict')
  const url = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL

  if (!url) {
    const message = 'DATABASE_URL_UNPOOLED (or DATABASE_URL) is not set'
    if (strict) {
      console.error(`[migrate] ${message}`)
      process.exit(1)
    }
    console.warn(`[migrate] WARNING: ${message}; skipping migrations.`)
    return
  }

  const client = new pg.Client({ connectionString: url })
  await client.connect()
  try {
    const result = await applyMigrations((text, params) => client.query(text, params))
    console.log(`[migrate] applied: ${result.applied.join(', ') || '(none)'}`)
    console.log(`[migrate] skipped: ${result.skipped.join(', ') || '(none)'}`)
  } finally {
    await client.end()
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error) => {
    console.error(`[migrate] ${error.message}`)
    process.exit(1)
  })
}
