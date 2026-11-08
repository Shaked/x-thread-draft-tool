// Vitest global setup for the API project. Applies the migrations once to a PGlite database,
// saves it as a compressed data dir, and hands the file path to every API test file. Each file
// then loads that snapshot instead of replaying all migrations. The snapshot is cached under
// node_modules/.cache and keyed by a hash of db/migrations/*.sql, so a new migration rebuilds it.
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PGlite } from '@electric-sql/pglite'
import { applyMigrations } from '../../../scripts/migrate.mjs'

const ROOT = fileURLToPath(new URL('../../../', import.meta.url))
const MIGRATIONS_DIR = join(ROOT, 'db/migrations')
const CACHE_DIR = join(ROOT, 'node_modules/.cache/xt-test')

export function migrationsHash() {
  const hash = createHash('sha256')
  const files = readdirSync(MIGRATIONS_DIR).filter((name) => name.endsWith('.sql')).sort()
  for (const name of files) {
    hash.update(name).update('\0').update(readFileSync(join(MIGRATIONS_DIR, name))).update('\0')
  }
  return hash.digest('hex')
}

export default async function setup(project) {
  const path = join(CACHE_DIR, `pglite-${migrationsHash()}.tgz`)
  if (!existsSync(path)) {
    const pg = new PGlite()
    await applyMigrations((text, params) =>
      params === undefined
        ? pg.exec(text).then((results) => ({ rows: results.at(-1)?.rows ?? [] }))
        : pg.query(text, params)
    )
    const dump = await pg.dumpDataDir('gzip')
    mkdirSync(CACHE_DIR, { recursive: true })
    writeFileSync(path, Buffer.from(await dump.arrayBuffer()))
    await pg.close()
  }
  project.provide('pgliteSnapshot', path)
}
