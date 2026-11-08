// @vitest-environment node
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { beforeAll, afterAll, describe, expect, it } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { applyMigrations, MIGRATIONS_DIR } from '../../scripts/migrate.mjs'

// Same destructive patterns as the "Lint database migrations" step in .github/workflows/tests.yml.
const DESTRUCTIVE = [
  /drop\s+table/i,
  /drop\s+schema/i,
  /drop\s+database/i,
  /drop\s+column/i,
  /drop\s+role/i,
  /drop\s+policy/i,
  /truncate\s/i,
  /alter\s+table\s+[^;]*drop\s/i,
  /delete\s+from/i
]

function pgliteQuery(pg) {
  return async (text, params) => {
    if (params === undefined) {
      const results = await pg.exec(text)
      return { rows: results.at(-1)?.rows ?? [] }
    }
    return pg.query(text, params)
  }
}

const OAUTH_TABLES = ['oauth_clients', 'oauth_grants', 'oauth_codes', 'oauth_tokens']

async function columnsOf(query, table) {
  const { rows } = await query(
    `select column_name, data_type, is_nullable from information_schema.columns
     where table_schema = 'public' and table_name = $1 order by ordinal_position`,
    [table]
  )
  return rows.map((r) => [r.column_name, r.data_type, r.is_nullable])
}

async function primaryKeyOf(query, table) {
  const { rows } = await query(
    `select kcu.column_name from information_schema.table_constraints tc
     join information_schema.key_column_usage kcu
       on kcu.constraint_name = tc.constraint_name and kcu.table_schema = tc.table_schema
     where tc.table_schema = 'public' and tc.table_name = $1 and tc.constraint_type = 'PRIMARY KEY'
     order by kcu.ordinal_position`,
    [table]
  )
  return rows.map((r) => r.column_name)
}

async function uniqueColumnsOf(query, table) {
  const { rows } = await query(
    `select tc.constraint_name, kcu.column_name from information_schema.table_constraints tc
     join information_schema.key_column_usage kcu
       on kcu.constraint_name = tc.constraint_name and kcu.table_schema = tc.table_schema
     where tc.table_schema = 'public' and tc.table_name = $1 and tc.constraint_type = 'UNIQUE'
     order by tc.constraint_name, kcu.ordinal_position`,
    [table]
  )
  const groups = new Map()
  for (const r of rows) {
    groups.set(r.constraint_name, [...(groups.get(r.constraint_name) ?? []), r.column_name])
  }
  return [...groups.values()]
}

async function foreignKeysOf(query, table) {
  const { rows } = await query(
    `select kcu.column_name, ccu.table_name as ref_table, ccu.column_name as ref_column, rc.delete_rule
     from information_schema.table_constraints tc
     join information_schema.key_column_usage kcu
       on kcu.constraint_name = tc.constraint_name and kcu.table_schema = tc.table_schema
     join information_schema.constraint_column_usage ccu
       on ccu.constraint_name = tc.constraint_name and ccu.table_schema = tc.table_schema
     join information_schema.referential_constraints rc
       on rc.constraint_name = tc.constraint_name and rc.constraint_schema = tc.table_schema
     where tc.table_schema = 'public' and tc.table_name = $1 and tc.constraint_type = 'FOREIGN KEY'`,
    [table]
  )
  return rows.map((r) => [r.column_name, r.ref_table, r.ref_column, r.delete_rule])
}

describe('003_oauth.sql', () => {
  // One PGlite instance for the whole file: migrations run once in beforeAll, which keeps the file under 3 s.
  let pg
  let query
  let firstRun
  beforeAll(async () => {
    pg = new PGlite()
    query = pgliteQuery(pg)
    firstRun = await applyMigrations(query)
  })
  afterAll(async () => {
  })

  it('is additive and passes the destructive-statement lint', async () => {
    const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith('.sql')).sort()
    expect(files).toEqual(['001_init.sql', '002_api_tokens.sql', '003_oauth.sql', '004_token_cap.sql'])

    for (const file of files) {
      const sql = await readFile(path.join(MIGRATIONS_DIR, file), 'utf8')
      for (const pattern of DESTRUCTIVE) expect(sql, file).not.toMatch(pattern)
    }
  })

  it('applies cleanly on PGlite, is idempotent, and creates the OAuth tables', async () => {
    expect(firstRun.applied).toEqual(['001_init.sql', '002_api_tokens.sql', '003_oauth.sql', '004_token_cap.sql'])

    const second = await applyMigrations(query)
    expect(second.applied).toEqual([])
    expect(second.skipped).toEqual(firstRun.applied)

    const { rows } = await query(
      `select table_name from information_schema.tables where table_schema = 'public' and table_name like 'oauth\\_%'`
    )
    expect(rows.map((r) => r.table_name).sort()).toEqual([...OAUTH_TABLES].sort())
  })

  it('creates the columns the plan names', async () => {
    expect(await columnsOf(query, 'oauth_clients')).toEqual([
      ['client_id', 'text', 'NO'],
      ['kind', 'text', 'NO'],
      ['client_name', 'text', 'NO'],
      ['redirect_uris', 'ARRAY', 'NO'],
      ['metadata_fetched_at', 'timestamp with time zone', 'YES'],
      ['created_at', 'timestamp with time zone', 'NO']
    ])
    expect(await columnsOf(query, 'oauth_grants')).toEqual([
      ['id', 'uuid', 'NO'],
      ['user_id', 'uuid', 'NO'],
      ['client_id', 'text', 'NO'],
      ['scope', 'text', 'NO'],
      ['resource', 'text', 'NO'],
      ['created_at', 'timestamp with time zone', 'NO'],
      ['last_used_at', 'timestamp with time zone', 'YES'],
      ['revoked_at', 'timestamp with time zone', 'YES']
    ])
    expect(await columnsOf(query, 'oauth_codes')).toEqual([
      ['code_hash', 'text', 'NO'],
      ['grant_id', 'uuid', 'NO'],
      ['redirect_uri', 'text', 'NO'],
      ['code_challenge', 'text', 'NO'],
      ['expires_at', 'timestamp with time zone', 'NO'],
      ['used_at', 'timestamp with time zone', 'YES']
    ])
    expect(await columnsOf(query, 'oauth_tokens')).toEqual([
      ['token_hash', 'text', 'NO'],
      ['grant_id', 'uuid', 'NO'],
      ['kind', 'text', 'NO'],
      ['expires_at', 'timestamp with time zone', 'NO'],
      ['used_at', 'timestamp with time zone', 'YES'],
      ['created_at', 'timestamp with time zone', 'NO']
    ])
  })

  it('creates the primary keys, unique constraint and foreign keys the plan names', async () => {
    expect(await primaryKeyOf(query, 'oauth_clients')).toEqual(['client_id'])
    expect(await primaryKeyOf(query, 'oauth_grants')).toEqual(['id'])
    expect(await primaryKeyOf(query, 'oauth_codes')).toEqual(['code_hash'])
    expect(await primaryKeyOf(query, 'oauth_tokens')).toEqual(['token_hash'])

    expect(await uniqueColumnsOf(query, 'oauth_grants')).toEqual([['user_id', 'client_id', 'resource']])

    expect(await foreignKeysOf(query, 'oauth_grants')).toEqual(
      expect.arrayContaining([
        ['user_id', 'users', 'id', 'CASCADE'],
        ['client_id', 'oauth_clients', 'client_id', 'CASCADE']
      ])
    )
    expect(await foreignKeysOf(query, 'oauth_codes')).toEqual([['grant_id', 'oauth_grants', 'id', 'CASCADE']])
    expect(await foreignKeysOf(query, 'oauth_tokens')).toEqual([['grant_id', 'oauth_grants', 'id', 'CASCADE']])
  })

  it('enforces one grant per user, client and resource, and cascades deletes from the user', async () => {
    const { rows: [user] } = await query(`insert into users (github_id, login) values (4242, 'oauth-test') returning id`)
    await query(`insert into oauth_clients (client_id, kind, client_name) values ('device:cli', 'device', 'CLI')`)
    const grantSql = `insert into oauth_grants (user_id, client_id, scope, resource)
                      values ($1, 'device:cli', 'drafts', 'https://app.test/api')`
    await query(grantSql, [user.id])
    await expect(query(grantSql, [user.id])).rejects.toThrow(/unique/i)

    const { rows: [grant] } = await query(`select id from oauth_grants where user_id = $1`, [user.id])
    await query(
      `insert into oauth_tokens (token_hash, grant_id, kind, expires_at)
       values ('h1', $1, 'access', now() + interval '1 hour')`,
      [grant.id]
    )
    await query(`delete from users where id = $1`, [user.id])
    const { rows: remaining } = await query(`select count(*)::int as n from oauth_tokens`)
    expect(remaining[0].n).toBe(0)
  })
})
