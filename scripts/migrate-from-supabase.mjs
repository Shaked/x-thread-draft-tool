// One-time copy of data from the Supabase project into Neon and Vercel Blob.
//
//   node scripts/migrate-from-supabase.mjs            # dry run (default): reads Supabase, writes nothing
//   node scripts/migrate-from-supabase.mjs --apply    # writes to Neon and Blob
//
// Environment:
//   SUPABASE_DB_URL          source (Supabase Postgres, Session pooler)
//   DATABASE_URL_UNPOOLED    target (Neon direct connection); required with --apply
//   BLOB_READ_WRITE_TOKEN    target Blob store; required with --apply
//
// Idempotent: existing rows are left alone, image copies are recorded in url-map.json so a
// re-run never uploads the same image twice. Reports contain counts and ids only; no draft
// text and no emails are printed or written to the step summary.

import { appendFile, readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import pg from 'pg'
import { put } from '@vercel/blob'

const APPLY = process.argv.includes('--apply')
const URL_MAP_PATH = 'url-map.json'
const SUPABASE_IMAGE_MARKER = '/storage/v1/object/public/draft-images/'

function requireEnv(name) {
  const value = process.env[name]
  if (!value) {
    console.error(`[migrate-from-supabase] ${name} is not set`)
    process.exit(1)
  }
  return value
}

/** Maps a Supabase auth user to a GitHub profile, or null when there is no GitHub id. */
export function githubProfile(user) {
  const meta = user.raw_user_meta_data || {}
  const githubId = String(meta.provider_id || meta.sub || '')
  if (!/^\d+$/.test(githubId)) return null
  return {
    id: user.id,
    github_id: githubId,
    login: meta.user_name || meta.preferred_username || `user-${githubId}`,
    name: meta.full_name || meta.name || null,
    avatar_url: meta.avatar_url || null
  }
}

/** Returns the Supabase Storage image URLs referenced by a draft's posts. */
export function supabaseImageUrls(posts) {
  const urls = []
  for (const post of Array.isArray(posts) ? posts : []) {
    for (const img of Array.isArray(post?.images) ? post.images : []) {
      const url = typeof img === 'string' ? img : img?.url
      if (typeof url === 'string' && url.includes(SUPABASE_IMAGE_MARKER)) urls.push(url)
    }
  }
  return urls
}

/** Rewrites image URLs in posts using `urlMap`; string and `{ url }` entries are both handled. */
export function remapPosts(posts, urlMap) {
  if (!Array.isArray(posts)) return posts
  const remapImage = (img) => {
    if (typeof img === 'string') return urlMap.get(img) ?? img
    if (img && typeof img.url === 'string') return { ...img, url: urlMap.get(img.url) ?? img.url }
    return img
  }
  return posts.map((post) =>
    Array.isArray(post?.images) ? { ...post, images: post.images.map(remapImage) } : post
  )
}

/**
 * Source (Supabase) connection config. Matches the backup workflow's `sslmode=require`: the
 * connection is encrypted but the server certificate is not verified, because Supabase's pooler
 * chain is not in Node's trust store. Only this one-time read uses it; Neon keeps verification.
 */
export function sourceConfig(connectionString) {
  const url = new URL(connectionString)
  url.searchParams.delete('sslmode')
  return { connectionString: url.toString(), ssl: { rejectUnauthorized: false } }
}

async function copyImage(url, targetUserId, draftId) {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`download failed with HTTP ${response.status}`)
  const contentType = response.headers.get('content-type')?.split(';')[0] || 'application/octet-stream'
  const bytes = new Uint8Array(await response.arrayBuffer())
  const filename = decodeURIComponent(new URL(url).pathname.split('/').pop() || 'image')
  const blob = await put(`drafts/${targetUserId}/${draftId}/${filename}`, bytes, {
    access: 'public',
    contentType,
    addRandomSuffix: true,
    token: process.env.BLOB_READ_WRITE_TOKEN
  })
  return blob.url
}

async function loadUrlMap() {
  if (!existsSync(URL_MAP_PATH)) return new Map()
  return new Map(Object.entries(JSON.parse(await readFile(URL_MAP_PATH, 'utf8'))))
}

async function main() {
  const source = new pg.Client(sourceConfig(requireEnv('SUPABASE_DB_URL')))
  const target = APPLY ? new pg.Client({ connectionString: requireEnv('DATABASE_URL_UNPOOLED') }) : null
  if (APPLY) requireEnv('BLOB_READ_WRITE_TOKEN')

  await source.connect()
  if (target) await target.connect()

  const stats = {
    users: { migrated: 0, skippedNoGithub: 0 },
    drafts: { migrated: 0, alreadyPresent: 0, skippedOrphan: 0, skippedNoUser: [] },
    images: { moved: 0, reused: 0, failed: [] },
    tokens: { migrated: 0, skipped: 0 }
  }
  const failures = []
  const urlMap = await loadUrlMap()
  const userIdMap = new Map() // Supabase user id -> target user id

  try {
    // 1. Users
    const { rows: authUsers } = await source.query('select id, raw_user_meta_data from auth.users')
    for (const user of authUsers) {
      const profile = githubProfile(user)
      if (!profile) {
        stats.users.skippedNoGithub += 1
        continue
      }
      if (!target) {
        userIdMap.set(user.id, user.id)
        stats.users.migrated += 1
        continue
      }
      const { rows } = await target.query(
        `insert into users (id, github_id, login, name, avatar_url)
         values ($1, $2, $3, $4, $5)
         on conflict (github_id) do update set github_id = excluded.github_id
         returning id`,
        [profile.id, profile.github_id, profile.login, profile.name, profile.avatar_url]
      )
      userIdMap.set(user.id, rows[0].id)
      stats.users.migrated += 1
    }

    // 2. Drafts (images are rewritten before the row is written)
    const { rows: drafts } = await source.query(
      `select id, user_id, title, posts, coalesce(is_published, false) as is_published,
              published_at, created_at, updated_at
         from public.drafts
        order by created_at`
    )
    for (const draft of drafts) {
      const targetUserId = userIdMap.get(draft.user_id)
      if (!targetUserId) {
        if (stats.drafts.skippedNoUser.length < 50) stats.drafts.skippedNoUser.push(draft.id)
        stats.drafts.skippedOrphan += 1
        continue
      }

      const posts = draft.posts
      const sourceUrls = [...new Set(supabaseImageUrls(posts))]
      for (const url of sourceUrls) {
        if (urlMap.has(url)) {
          stats.images.reused += 1
          continue
        }
        if (!target) {
          stats.images.moved += 1
          continue
        }
        try {
          urlMap.set(url, await copyImage(url, targetUserId, draft.id))
          stats.images.moved += 1
        } catch (error) {
          stats.images.failed.push(draft.id)
          failures.push(`image in draft ${draft.id}: ${error.message}`)
        }
      }
      const finalPosts = remapPosts(posts, urlMap)

      if (!target) {
        stats.drafts.migrated += 1
        continue
      }
      const inserted = await target.query(
        `insert into drafts (id, user_id, title, posts, is_published, published_at, created_at, updated_at)
         values ($1, $2, $3, $4::jsonb, $5, $6, $7, $8)
         on conflict (id) do update set posts = excluded.posts
           where drafts.posts::text like '%/storage/v1/object/public/draft-images/%'`,
        [
          draft.id,
          targetUserId,
          draft.title,
          JSON.stringify(finalPosts),
          draft.is_published,
          draft.published_at,
          draft.created_at,
          draft.updated_at
        ]
      )
      if (inserted.rowCount > 0) stats.drafts.migrated += 1
      else stats.drafts.alreadyPresent += 1
    }

    // 3. Share tokens that were never used
    const { rows: tokens } = await source.query(
      'select token, draft_id, created_by, created_at from public.share_tokens where used = false'
    )
    for (const token of tokens) {
      const targetUserId = userIdMap.get(token.created_by)
      if (!targetUserId) {
        stats.tokens.skipped += 1
        continue
      }
      if (!target) {
        stats.tokens.migrated += 1
        continue
      }
      const result = await target.query(
        `insert into share_tokens (token, draft_id, created_by, created_at)
         select $1::uuid, $2::uuid, $3::uuid, $4::timestamptz
          where exists (select 1 from drafts where id = $2::uuid)
            and exists (select 1 from users where id = $3::uuid)
         on conflict (token) do nothing`,
        [token.token, token.draft_id, targetUserId, token.created_at]
      )
      if (result.rowCount > 0) stats.tokens.migrated += 1
      else stats.tokens.skipped += 1
    }
  } finally {
    await source.end()
    if (target) await target.end()
    if (APPLY) await writeFile(URL_MAP_PATH, JSON.stringify(Object.fromEntries(urlMap), null, 2))
  }

  report(stats, failures)
}

async function report(stats, failures) {
  const mode = APPLY ? 'APPLY' : 'DRY RUN (nothing written)'
  const lines = [
    `Mode: ${mode}`,
    `Users: ${stats.users.migrated} migrated, ${stats.users.skippedNoGithub} skipped (no GitHub id)`,
    `Drafts: ${stats.drafts.migrated} migrated, ${stats.drafts.alreadyPresent} already present, ${stats.drafts.skippedOrphan} skipped (no user)`,
    `Images: ${stats.images.moved} moved, ${stats.images.reused} reused from url-map, ${stats.images.failed.length} failed`,
    `Share tokens (unused): ${stats.tokens.migrated} copied, ${stats.tokens.skipped} skipped`
  ]
  for (const line of lines) console.log(`[migrate-from-supabase] ${line}`)
  for (const failure of failures) console.log(`[migrate-from-supabase] FAILED ${failure}`)
  if (stats.drafts.skippedNoUser.length) {
    console.log(`[migrate-from-supabase] drafts without a migrated user: ${stats.drafts.skippedNoUser.join(', ')}`)
  }

  if (process.env.GITHUB_STEP_SUMMARY) {
    const summary = [
      `## Data migration (${APPLY ? 'applied' : 'dry run'})`,
      '',
      ...lines.map((line) => `- ${line}`),
      '',
      failures.length ? '### Failures (ids only)' : '',
      ...failures.map((failure) => `- ${failure.replace(/\s+/g, ' ')}`),
      ''
    ].join('\n')
    await appendFile(process.env.GITHUB_STEP_SUMMARY, summary)
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error) => {
    console.error(`[migrate-from-supabase] ${error.message}`)
    process.exit(1)
  })
}
