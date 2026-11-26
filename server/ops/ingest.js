// Central metrics plan M2 (#439, task #448): the ingest of one batch from metrics-daily.yml.
// The shape checks are in events.js (M1). This file does the caps, the row guard, the insert that
// ignores known events, the counter replace and the cursor, all in one transaction.
import { transaction } from '../db.js'
import { HttpError } from '../http.js'
import { SOURCES } from './sources.js'
import { isPlainText, parseAt, validateBatch } from './events.js'

const DAILY_EVENT_CAP = 5000
const DAILY_COUNTER_CAP = 200
const ROW_GUARD = 100000
const COUNTER_MAX = 1_000_000
const STRING_MAX = 120
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/
const DAY_MS = 24 * 60 * 60 * 1000
const COUNTER_DAYS_KEPT = 400
const COUNTER_ROWS_PER_BATCH = 1000

function refuse(status, reason) {
  return new HttpError(status, `Ops batch refused: ${reason}`)
}

const utcDay = (ms) => new Date(ms).toISOString().slice(0, 10)

/** The optional `cursor` of the batch: the time the collector has read up to. Absent is null. */
function cursorOf(body, now) {
  if (body.cursor === undefined) return null
  const at = parseAt(body.cursor, now)
  if (!at) throw refuse(400, 'cursor')
  return at
}

function isText(value) {
  return typeof value === 'string' && value !== '' && Array.from(value).length <= STRING_MAX && isPlainText(value)
}

/** Checks the counter rows: finished UTC days only, fixed text, whole counts, no repeated key, the per-day cap. */
function countersOf(raw, now) {
  if (raw === undefined) return []
  if (!Array.isArray(raw)) throw refuse(400, 'counters')
  const today = utcDay(now)
  const keys = new Set()
  const perDay = new Map()
  if (raw.length > COUNTER_ROWS_PER_BATCH) throw new HttpError(429, 'Ops batch refused: too many counter rows')
  return raw.map((row) => {
    if (!row || typeof row !== 'object' || Array.isArray(row)) throw refuse(400, 'counter')
    const { day, source, kind, name, status, count } = row
    if (typeof day !== 'string' || !DAY_RE.test(day) || Number.isNaN(Date.parse(`${day}T00:00:00Z`))) {
      throw refuse(400, 'counter day')
    }
    if (utcDay(Date.parse(`${day}T00:00:00Z`)) !== day || day >= today) throw refuse(400, 'counter day is not a finished UTC day')
    if (Date.parse(`${day}T00:00:00Z`) < Date.parse(`${today}T00:00:00Z`) - COUNTER_DAYS_KEPT * DAY_MS) throw refuse(400, 'counter day is older than the retention')
    if (![source, kind, name, status].every(isText)) throw refuse(400, 'counter text')
    if (!Number.isInteger(count) || count < 0 || count > COUNTER_MAX) throw refuse(400, 'counter count')
    const key = [day, source, kind, name, status].join('\u0001')
    if (keys.has(key)) throw refuse(400, 'counter repeated')
    keys.add(key)
    const days = (perDay.get(day) ?? 0) + 1
    perDay.set(day, days)
    if (days > DAILY_COUNTER_CAP) throw new HttpError(429, 'Ops batch refused: too many counter rows for one day')
    return { day, source, kind, name, status, count }
  })
}

/** Events of the batch by UTC day of their `at`, for the daily cap. */
function countByDay(events) {
  const counts = new Map()
  for (const e of events) counts.set(e.at.slice(0, 10), (counts.get(e.at.slice(0, 10)) ?? 0) + 1)
  return counts
}

async function storedOnDay(q, repoId, day) {
  const start = `${day}T00:00:00.000Z`
  const end = new Date(Date.parse(start) + DAY_MS).toISOString()
  const { rows } = await q(
    'select count(*)::int as n from ops_events where repo_id = $1 and at >= $2::timestamptz and at < $3::timestamptz',
    [repoId, start, end]
  )
  return rows[0].n
}

/** Inserts the events; a known event (same repo, source, kind, id) is ignored. Returns the ones inserted. */
async function insertEvents(q, events) {
  if (events.length === 0) return []
  const column = (pick) => events.map(pick)
  const { rows } = await q(
    `insert into ops_events (repo_id, source, kind, id, at, name, status, ms, attrs, link)
     select repo_id, source, kind, id, at, name, status, ms, attrs::jsonb, link
     from unnest($1::bigint[], $2::text[], $3::text[], $4::text[], $5::timestamptz[], $6::text[], $7::text[], $8::integer[], $9::text[], $10::text[])
       as e(repo_id, source, kind, id, at, name, status, ms, attrs, link)
     on conflict (repo_id, source, kind, id) do nothing
     returning source, kind, id`,
    [
      column((e) => e.repo_id),
      column((e) => e.source),
      column((e) => e.kind),
      column((e) => e.id),
      column((e) => e.at),
      column((e) => e.name),
      column((e) => e.status),
      column((e) => e.ms),
      column((e) => JSON.stringify(e.attrs)),
      column((e) => e.link)
    ]
  )
  return rows
}

/** Replaces the counter rows of each day in the batch: the day's old rows go, the batch's rows come. */
async function replaceCounters(q, repoId, counters) {
  if (counters.length === 0) return
  const days = [...new Set(counters.map((c) => c.day))]
  await q('delete from ops_daily where repo_id = $1 and day = any($2::date[])', [repoId, days])
  await q(
    `insert into ops_daily (day, repo_id, source, kind, name, status, count)
     select d, $1::bigint, s, k, n, st, c
     from unnest($2::date[], $3::text[], $4::text[], $5::text[], $6::text[], $7::integer[]) as t(d, s, k, n, st, c)`,
    [
      repoId,
      counters.map((c) => c.day),
      counters.map((c) => c.source),
      counters.map((c) => c.kind),
      counters.map((c) => c.name),
      counters.map((c) => c.status),
      counters.map((c) => c.count)
    ]
  )
}

/**
 * One batch, all or nothing. Answers { accepted, duplicates, refused, cursor }; `cursor` is the stored
 * time for the repo (null before the first one). Refusals: 400 bad body, 403 repo not listed,
 * 413 batch over 500 events, 429 daily caps (nothing stored), 503 row guard (nothing stored).
 * The limits are parameters so the tests can reach them without 100 000 rows.
 */
export async function ingestBatch(body, { now = Date.now(), sources = SOURCES, rowGuard = ROW_GUARD, dailyEventCap = DAILY_EVENT_CAP } = {}) {
  const checked = validateBatch(body, { sources, now })
  if (!checked.ok) throw refuse(checked.status, checked.reason)
  const cursor = cursorOf(body, now)
  const counters = countersOf(body.counters, now)
  const { repo_id: repoId, events } = checked

  return transaction(async (q) => {
    if (events.length > 0) {
      const { rows } = await q('select count(*)::int as n from ops_events')
      if (rows[0].n > rowGuard) {
        console.warn('[ops] ingest refused: ops_events is over the row guard')
        throw new HttpError(503, 'Ops events are full')
      }
    }

    const before = new Map()
    const counts = countByDay(events)
    for (const day of counts.keys()) before.set(day, await storedOnDay(q, repoId, day))

    const inserted = await insertEvents(q, events)
    const insertedKeys = new Set(inserted.map((r) => `${r.source}/${r.kind}/${r.id}`))
    const insertedPerDay = new Map()
    const counted = new Set()
    for (const e of events) {
      const key = `${e.source}/${e.kind}/${e.id}`
      if (insertedKeys.has(key) && !counted.has(key)) {
        counted.add(key)
        const day = e.at.slice(0, 10)
        insertedPerDay.set(day, (insertedPerDay.get(day) ?? 0) + 1)
      }
    }
    for (const [day, added] of insertedPerDay) {
      if (before.get(day) + added > dailyEventCap) throw new HttpError(429, 'Ops batch refused: daily event cap')
    }

    await replaceCounters(q, repoId, counters)
    if (cursor) {
      await q(
        `insert into ops_cursor (repo_id, completed_at) values ($1, $2::timestamptz)
         on conflict (repo_id) do update set completed_at = excluded.completed_at`,
        [repoId, cursor]
      )
    }
    const stored = await q('select completed_at from ops_cursor where repo_id = $1', [repoId])
    const at = stored.rows[0]?.completed_at
    return {
      accepted: inserted.length,
      duplicates: events.length - inserted.length,
      refused: checked.refused.length,
      cursor: at ? new Date(at).toISOString() : null
    }
  })
}
