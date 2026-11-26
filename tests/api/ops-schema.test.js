// @vitest-environment node
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { setupTestDb } from './helpers/db.js'

// Central metrics plan M1 (#439, task #447): migration 011_ops_events.sql, on the migrated PGlite snapshot.
let db

beforeAll(async () => {
  db = await setupTestDb()
})

beforeEach(async () => {
  await db.pg.exec('delete from ops_events; delete from ops_daily; delete from ops_cursor;')
})

const query = (text, params) => db.pg.query(text, params)
const insertEvent = (id, extra = {}) =>
  query(
    `insert into ops_events (repo_id, source, kind, id, at, name, status, ms, attrs, link)
     values (1136002672, 'ci', 'run', $1, '2026-11-25T11:00:00Z', 'Tests', 'success', 97000, $2::jsonb, $3)`,
    [id, JSON.stringify(extra.attrs ?? { event: 'pull_request' }), extra.link ?? 'https://github.com/Shaked/x-thread-draft-tool/actions/runs/1']
  )

describe('011_ops_events.sql', () => {
  it('runs twice without error (idempotent)', async () => {
    // The migrated snapshot already has 011 applied; run its statements again. Fresh-database replay is in migrate.test.js.
    const { readFile } = await import('node:fs/promises')
    const { fileURLToPath } = await import('node:url')
    const sql = await readFile(fileURLToPath(new URL('../../db/migrations/011_ops_events.sql', import.meta.url)), 'utf8')
    await expect(db.pg.exec(sql)).resolves.toBeDefined()
    await expect(db.pg.exec(sql)).resolves.toBeDefined()
  })

  it('creates the three ops tables', async () => {
    const { rows } = await query(
      `select table_name from information_schema.tables
       where table_schema = 'public' and table_name like 'ops\\_%' order by table_name`
    )
    expect(rows.map((r) => r.table_name)).toEqual(['ops_cursor', 'ops_daily', 'ops_events'])
  })

  it('stores an event once per (repo, source, kind, id)', async () => {
    await insertEvent('45713676980.1')
    await expect(insertEvent('45713676980.1')).rejects.toThrow()
    // The ingest insert ignores a known event, so it uses on conflict do nothing.
    await expect(
      query(
        `insert into ops_events (repo_id, source, kind, id, at, name, status)
         values (1136002672, 'ci', 'run', '45713676980.1', '2026-11-25T11:00:00Z', 'Tests', 'success')
         on conflict (repo_id, source, kind, id) do nothing`
      )
    ).resolves.toBeDefined()
    const { rows } = await query('select count(*)::int as n from ops_events')
    expect(rows[0].n).toBe(1)
  })

  it('keeps the same id for another repo or another kind', async () => {
    await insertEvent('1')
    await query(
      `insert into ops_events (repo_id, source, kind, id, at, name, status)
       values (1, 'ci', 'run', '1', '2026-11-25T11:00:00Z', 'Tests', 'success')`
    )
    await query(
      `insert into ops_events (repo_id, source, kind, id, at, name, status)
       values (1136002672, 'ci', 'attempt', '1', '2026-11-25T11:00:00Z', 'Tests', 'success')`
    )
    const { rows } = await query('select count(*)::int as n from ops_events')
    expect(rows[0].n).toBe(3)
  })

  it('holds no foreign key and no user column', async () => {
    const { rows } = await query(
      `select
         (select count(*)::int from information_schema.table_constraints
          where table_name in ('ops_events', 'ops_daily', 'ops_cursor') and constraint_type = 'FOREIGN KEY') as fks,
         (select count(*)::int from information_schema.columns
          where table_name in ('ops_events', 'ops_daily', 'ops_cursor') and column_name like '%user%') as user_cols`
    )
    expect(rows[0]).toEqual({ fks: 0, user_cols: 0 })
  })

  it('keeps one counter row per day and key, and replaces it', async () => {
    const counter = `insert into ops_daily (day, repo_id, source, kind, name, status, count)
      values ('2026-11-24', 1136002672, 'ci', 'run', 'Tests', 'cancelled', $1)
      on conflict (day, repo_id, source, kind, name, status) do update set count = excluded.count`
    await query(counter, [3])
    await query(counter, [5])
    const { rows } = await query('select count, (select count(*)::int from ops_daily) as rows from ops_daily')
    expect(rows).toEqual([{ count: 5, rows: 1 }])
  })

  it('keeps one cursor per repo', async () => {
    await query(`insert into ops_cursor (repo_id, completed_at) values (1136002672, '2026-11-25T10:00:00Z')`)
    await expect(
      query(`insert into ops_cursor (repo_id, completed_at) values (1136002672, '2026-11-25T11:00:00Z')`)
    ).rejects.toThrow()
  })

  it('measures the size of one event row with its index, in bytes', async () => {
    const size = async () => (await query(`select pg_total_relation_size('ops_events')::bigint as b`)).rows[0].b
    const before = Number(await size())
    await query(
      `insert into ops_events (repo_id, source, kind, id, at, name, status, ms, attrs, link)
       select 1136002672, 'ci', 'run', 'id-' || g, '2026-11-25T11:00:00Z', 'Tests', 'failure', 97000,
              '{"event":"pull_request","queue_ms":2000,"failed_job":"E2E tests (playwright)","failed_step":"Install Playwright browsers","pr":37}'::jsonb,
              'https://github.com/Shaked/x-thread-draft-tool/actions/runs/' || g
       from generate_series(1, 2000) as g`
    )
    const perRow = (Number(await size()) - before) / 2000
    // Printed so the PR body can quote it. The plan's estimate is about 500 bytes a row; this asserts a generous ceiling.
    console.log(`ops_events bytes per row, table and index: ${perRow.toFixed(1)}`)
    expect(perRow).toBeLessThan(1000)
  })
})
