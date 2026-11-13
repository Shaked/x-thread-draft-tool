// @vitest-environment node
import { readFile } from 'node:fs/promises'
import { describe, expect, inject, it } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { applyMigrations } from '../../scripts/migrate.mjs'
import { pgliteQuery } from './helpers/pglite-query.js'

describe('applyMigrations re-run', () => {
  it('is idempotent on re-run', async () => {
    // The shared snapshot is a database that already had every migration applied once
    // (tests/api/helpers/global-setup.js), so this file does not replay them first.
    const snapshot = await readFile(inject('pgliteSnapshot'))
    const pg = new PGlite({ loadDataDir: new Blob([snapshot]) })
    const query = pgliteQuery(pg)

    const recorded = await query('select name from schema_migrations order by name')
    const first = { applied: recorded.rows.map((r) => r.name) }
    expect(first.applied).toContain('001_init.sql')

    const second = await applyMigrations(query)
    expect(second.applied).toEqual([])
    expect(second.skipped).toEqual(first.applied)
    await pg.close()
  })
})
