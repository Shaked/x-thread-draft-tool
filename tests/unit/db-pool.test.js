// @vitest-environment node
import pg from 'pg'
import { attachDatabasePool } from '@vercel/functions'
import { describe, expect, it } from 'vitest'
import { poolOptions } from '../../server/db.js'

describe('database pool options', () => {
  it('keeps one connection, idle for 60 s, and leaves the two timeouts unchanged', () => {
    const options = poolOptions()
    expect(options.max).toBe(1)
    expect(options.idleTimeoutMillis).toBe(60000)
    expect(options.connectionTimeoutMillis).toBe(8000)
    expect(options.query_timeout).toBe(15000)
  })

  it('is accepted by attachDatabasePool on a real pg pool (no connection is opened)', async () => {
    const pool = new pg.Pool(poolOptions())
    expect(() => attachDatabasePool(pool)).not.toThrow()
    await pool.end()
  })
})
