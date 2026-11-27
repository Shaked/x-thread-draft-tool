// @vitest-environment node
import { beforeAll, describe, expect, it } from 'vitest'
import { setupTestDb } from './helpers/db.js'

// Admin plan A1: the schema the admin tools rely on. Runs on the migrated PGlite snapshot.
let db

beforeAll(async () => {
  db = await setupTestDb()
})

const query = (text, params) => db.pg.query(text, params)

async function foreignKeysPointingAt(table) {
  const { rows } = await query(
    `select tc.table_name as source_table, rc.delete_rule
     from information_schema.table_constraints tc
     join information_schema.referential_constraints rc
       on rc.constraint_name = tc.constraint_name and rc.constraint_schema = tc.table_schema
     join information_schema.constraint_column_usage ccu
       on ccu.constraint_name = tc.constraint_name and ccu.table_schema = tc.table_schema
     where tc.table_schema = 'public' and tc.constraint_type = 'FOREIGN KEY' and ccu.table_name = $1`,
    [table]
  )
  return rows
}

// Every table that reaches users through foreign keys, found by walking the schema from users.
async function tablesWithPathToUsers() {
  const reached = new Set(['users'])
  let grew = true
  while (grew) {
    grew = false
    for (const target of [...reached]) {
      for (const row of await foreignKeysPointingAt(target)) {
        if (!reached.has(row.source_table)) {
          reached.add(row.source_table)
          grew = true
        }
      }
    }
  }
  reached.delete('users')
  return [...reached].sort()
}

describe('009_admin.sql', () => {
  it('admin_audit has no foreign key, so an audit row survives the deletion of the user it names', async () => {
    const { rows } = await query(
      `select constraint_name from information_schema.table_constraints
       where table_schema = 'public' and table_name = 'admin_audit' and constraint_type = 'FOREIGN KEY'`
    )
    expect(rows).toEqual([])
  })

  it('every foreign key that points at users, drafts, api_tokens or oauth_grants cascades on delete', async () => {
    const offenders = []
    for (const target of ['users', 'drafts', 'api_tokens', 'oauth_grants']) {
      for (const row of await foreignKeysPointingAt(target)) {
        if (row.delete_rule !== 'CASCADE') offenders.push(`${row.source_table} -> ${target} (${row.delete_rule})`)
      }
    }
    expect(offenders).toEqual([])
  })

  it('the tables with a foreign key path to users are exactly the ones the A9 delete counts cover', async () => {
    // A new table that reaches users fails this test. Add it to the delete counts of A9 before you update this list.
    expect(await tablesWithPathToUsers()).toEqual([
      'api_token_cap_backup',
      'api_tokens',
      'drafts',
      'image_files',
      'mcp_rate_limits',
      'oauth_codes',
      'oauth_grants',
      'oauth_tokens',
      'share_tokens'
    ])
  })

  it('adds the suspension columns to users', async () => {
    const { rows } = await query(
      `select column_name, data_type, is_nullable from information_schema.columns
       where table_schema = 'public' and table_name = 'users' and column_name in ('suspended_at', 'suspended_reason')
       order by column_name`
    )
    expect(rows.map((r) => [r.column_name, r.data_type, r.is_nullable])).toEqual([
      ['suspended_at', 'timestamp with time zone', 'YES'],
      ['suspended_reason', 'text', 'YES']
    ])
  })
})
