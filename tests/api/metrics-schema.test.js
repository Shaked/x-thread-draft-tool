// @vitest-environment node
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { setupTestDb } from './helpers/db.js'
import { bucketOf, oneHot } from '../../server/metrics/histogram.js'

// Observability plan O1 (#332): migration 010_metrics.sql. Runs on the migrated PGlite snapshot.
let db

beforeAll(async () => {
  db = await setupTestDb()
})

beforeEach(async () => {
  await db.pg.exec('delete from metrics_hourly; delete from metrics_daily; delete from metrics_product_daily; delete from metrics_alert_state;')
})

const query = (text, params) => db.pg.query(text, params)
const pgArray = (values) => `{${values.join(',')}}`
const zeros = () => new Array(65).fill(0)

const upsertHourly = `
  insert into metrics_hourly (hour, route, op, caller, n, sum_ms, max_ms, buckets)
  values ($1, $2, '-', 'web', 1, $3, $3, $4::int[])
  on conflict (hour, route, op, caller) do update set
    n = metrics_hourly.n + excluded.n,
    sum_ms = metrics_hourly.sum_ms + excluded.sum_ms,
    max_ms = greatest(metrics_hourly.max_ms, excluded.max_ms),
    buckets = array(
      select a + b from unnest(metrics_hourly.buckets, excluded.buckets) with ordinality as t(a, b, i) order by i
    )`

describe('010_metrics.sql', () => {
  it('runs twice without error (idempotent)', async () => {
    const sql = await readFile(fileURLToPath(new URL('../../db/migrations/010_metrics.sql', import.meta.url)), 'utf8')
    // The migrated snapshot already has 010 applied, so two more runs prove it can be repeated. A first run on an
    // empty database is covered by migrate.test.js, which replays every migration. Booting a second PGlite here
    // cost about 2 s and pushed this file over the 5 s per-file budget (#456).
    await expect(db.pg.exec(sql)).resolves.toBeDefined()
    await expect(db.pg.exec(sql)).resolves.toBeDefined()
  })

  it('creates the four tables', async () => {
    const { rows } = await query(
      `select table_name from information_schema.tables
       where table_schema = 'public' and table_name like 'metrics\\_%' order by table_name`
    )
    expect(rows.map((r) => r.table_name)).toEqual(['metrics_alert_state', 'metrics_daily', 'metrics_hourly', 'metrics_product_daily'])
  })

  it('refuses a histogram of 64 or 66 counters', async () => {
    const hour = '2026-11-25T10:00:00Z'
    await expect(
      query(`insert into metrics_hourly (hour, route, op, caller, buckets) values ($1, 'r', '-', 'web', $2::int[])`, [
        hour,
        pgArray(new Array(64).fill(0))
      ])
    ).rejects.toThrow()
    await expect(
      query(`insert into metrics_hourly (hour, route, op, caller, buckets) values ($1, 'r', '-', 'web', $2::int[])`, [
        hour,
        pgArray(new Array(66).fill(0))
      ])
    ).rejects.toThrow()
  })

  it('refuses a histogram whose array starts at index 0', async () => {
    const literal = `[0:64]=${pgArray(zeros())}`
    await expect(
      query(`insert into metrics_daily (day, route, op, caller, buckets) values ('2026-11-25', 'r', '-', 'web', $1::int[])`, [
        literal
      ])
    ).rejects.toThrow()
  })

  it('accepts a 65-counter histogram starting at position 1', async () => {
    await expect(
      query(`insert into metrics_daily (day, route, op, caller, buckets) values ('2026-11-25', 'r', '-', 'web', $1::int[])`, [
        pgArray(oneHot(5))
      ])
    ).resolves.toBeDefined()
  })

  it('the upsert with qualified right-hand sides adds counts and buckets in order', async () => {
    const hour = '2026-11-25T10:00:00Z'
    await query(upsertHourly, [hour, 'GET /x', 5, pgArray(oneHot(5))])
    await query(upsertHourly, [hour, 'GET /x', 5, pgArray(oneHot(5))])
    await query(upsertHourly, [hour, 'GET /x', 900, pgArray(oneHot(900))])

    const { rows } = await query(`select n, sum_ms, max_ms, buckets from metrics_hourly where route = 'GET /x'`)
    expect(rows).toHaveLength(1)
    const row = rows[0]
    expect(row.n).toBe(3)
    expect(row.sum_ms).toBe(910)
    expect(row.max_ms).toBe(900)
    expect(row.buckets).toHaveLength(65)
    expect(row.buckets.reduce((a, b) => a + b, 0)).toBe(3)
    // JS index k is counter k, which is Postgres position k + 1.
    expect(row.buckets[bucketOf(5)]).toBe(2)
    expect(row.buckets[bucketOf(900)]).toBe(1)
  })

  it('has no foreign keys and no user id column on any metrics table', async () => {
    const { rows: fks } = await query(
      `select table_name from information_schema.table_constraints
       where table_schema = 'public' and constraint_type = 'FOREIGN KEY' and table_name like 'metrics\\_%'`
    )
    expect(fks).toEqual([])
    const { rows: userCols } = await query(
      `select table_name, column_name from information_schema.columns
       where table_schema = 'public' and table_name like 'metrics\\_%' and column_name ~ '(^|_)user(_|$)'`
    )
    expect(userCols).toEqual([])
  })
})
