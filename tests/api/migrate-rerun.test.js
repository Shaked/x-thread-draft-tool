// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { applyMigrations } from '../../scripts/migrate.mjs'
import { pgliteQuery } from './helpers/pglite-query.js'

describe('applyMigrations re-run', () => {
  it('is idempotent on re-run', async () => {
    const pg = new PGlite()
    const query = pgliteQuery(pg)

    const first = await applyMigrations(query)
    const second = await applyMigrations(query)
    expect(second.applied).toEqual([])
    expect(second.skipped).toEqual(first.applied)
    await pg.close()
  })
})
