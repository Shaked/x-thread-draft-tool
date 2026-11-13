// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { applyMigrations } from '../../scripts/migrate.mjs'
import { pgliteQuery } from './helpers/pglite-query.js'

describe('applyMigrations', () => {
  it('applies every migration once and creates the tables', async () => {
    const pg = new PGlite()
    const query = pgliteQuery(pg)

    const first = await applyMigrations(query)
    expect(first.applied).toContain('001_init.sql')
    expect(first.skipped).toEqual([])

    const tables = await query(
      "select table_name from information_schema.tables where table_schema = 'public' order by table_name"
    )
    const names = tables.rows.map((r) => r.table_name)
    expect(names).toEqual(expect.arrayContaining(['users', 'drafts', 'share_tokens', 'schema_migrations']))
    await pg.close()
    // Boots a fresh PGlite and replays every migration (4 now). The file budget (5000 ms, D-8) still
    // applies; this only stops vitest's 5 s default test timeout from failing the run under load.
  }, 20000)
})
